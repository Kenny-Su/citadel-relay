import express from 'express';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  type AppClientState,
  type AuthenticatedAppServer,
  type RelayInboundMessage,
  type RelayOutboundMessage,
  type VerifiedClientIdentity,
  isAppId
} from './shared.js';
import {
  AUTH_TOKEN_MAX_LENGTH,
  type RelayAppServerAuthenticator,
  type RelayClientAuthenticator,
  validateAuthenticatedAppServer,
  validateVerifiedClientIdentity
} from './auth.js';
import { RELAY_VERSION } from './version.js';
import { createTrafficLogger } from './trafficLog.js';

const DEFAULT_ADMISSION_TIMEOUT_MS = 60_000;
const DEFAULT_AUTHENTICATION_TIMEOUT_MS = 5_000;
const WEBSOCKET_MAX_PAYLOAD_BYTES = 64 * 1_024;
const APP_SERVER_MESSAGE_MAX_LENGTH = 256;

type ConnectionRecord = {
  connectionId: string;
  authenticating: boolean;
  openingApp: boolean;
  authenticationTimer?: ReturnType<typeof setTimeout>;
  clientIdentity?: VerifiedClientIdentity;
  appServer?: AuthenticatedAppServer;
};

type ClientSession = {
  appId: string;
  appServer: WebSocket;
  requestId: string;
  state: AppClientState;
  admissionTimer: ReturnType<typeof setTimeout>;
  identity: VerifiedClientIdentity;
};

type HealthResponse = {
  ok: true;
  version: string;
  connections: number;
  clients: number;
  pendingClients: number;
  connectedApps: number;
};

export type RelayServerOptions = {
  authenticateAppServer: RelayAppServerAuthenticator;
  authenticateClient: RelayClientAuthenticator;
  admissionTimeoutMs?: number;
  authenticationTimeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createRelayServer(options: RelayServerOptions) {
  if (!options || typeof options.authenticateAppServer !== 'function') {
    throw new Error('createRelayServer requires an authenticateAppServer function.');
  }
  if (typeof options.authenticateClient !== 'function') {
    throw new Error('createRelayServer requires an authenticateClient function.');
  }

  const admissionTimeoutMs = options.admissionTimeoutMs ?? DEFAULT_ADMISSION_TIMEOUT_MS;
  if (!Number.isFinite(admissionTimeoutMs) || admissionTimeoutMs <= 0) {
    throw new Error('admissionTimeoutMs must be a positive number.');
  }
  const authenticationTimeoutMs = options.authenticationTimeoutMs
    ?? DEFAULT_AUTHENTICATION_TIMEOUT_MS;
  if (!Number.isFinite(authenticationTimeoutMs) || authenticationTimeoutMs <= 0) {
    throw new Error('authenticationTimeoutMs must be a positive number.');
  }

  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES
  });
  const connections = new Map<WebSocket, ConnectionRecord>();
  const socketsByConnectionId = new Map<string, WebSocket>();
  const clientSessions = new Map<WebSocket, ClientSession>();
  const pendingRequests = new Map<string, WebSocket>();
  const appServers = new Map<string, WebSocket>();
  const appClients = new Map<string, Set<WebSocket>>();
  const traffic = createTrafficLogger();

  function send(socket: WebSocket, message: RelayOutboundMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;

    const serialized = JSON.stringify(message);
    socket.send(serialized);

    if (traffic.enabled) {
      traffic.log({
        event: 'send',
        messageType: message.type,
        appId: clientSessions.get(socket)?.appId ?? connections.get(socket)?.appServer?.appId,
        toConnectionId: connections.get(socket)?.connectionId,
        fromConnectionId: message.type === 'client:packet' ? message.from.connectionId : undefined,
        bytes: Buffer.byteLength(serialized),
        bufferedBytes: socket.bufferedAmount
      }, message.type === 'client:packet' || message.type === 'server:packet'
        ? message.payload
        : undefined);
    }
  }

  function sendError(socket: WebSocket, message: string) {
    send(socket, { type: 'error:notice', message });
  }

  function clearAuthenticationTimer(socket: WebSocket) {
    const connection = connections.get(socket);
    if (!connection?.authenticationTimer) return;

    clearTimeout(connection.authenticationTimer);
    delete connection.authenticationTimer;
  }

  function closeUnauthenticated(socket: WebSocket, message: string) {
    sendError(socket, message);
    socket.close(4401, message);
  }

  function isAuthenticatedConnection(socket: WebSocket) {
    const connection = connections.get(socket);
    return connection?.appServer !== undefined
      || connection?.clientIdentity !== undefined
      || clientSessions.has(socket);
  }

  function sendClientState(
    socket: WebSocket,
    state: 'pending' | 'admitted' | 'rejected' | 'closed',
    message?: string
  ) {
    const connectionId = connections.get(socket)?.connectionId;
    if (!connectionId) return;

    send(socket, {
      type: 'app:state',
      state,
      connectionId,
      ...(message !== undefined ? { message } : {})
    });
  }

  function removeClientSession(
    socket: WebSocket,
    options: {
      notifyAppServer: boolean;
      reason: 'client-closed' | 'client-disconnected' | 'admission-timeout';
    }
  ) {
    const session = clientSessions.get(socket);
    const connection = connections.get(socket);
    if (!session || !connection) return;

    clearTimeout(session.admissionTimer);
    pendingRequests.delete(session.requestId);
    clientSessions.delete(socket);
    const clients = appClients.get(session.appId);
    clients?.delete(socket);
    if (clients?.size === 0) appClients.delete(session.appId);

    if (options.notifyAppServer) {
      send(session.appServer, {
        type: 'app:disconnect',
        connectionId: connection.connectionId,
        admitted: session.state === 'admitted',
        reason: options.reason,
        identity: session.identity
      });
    }
  }

  function disconnectAppServer(appServer: WebSocket, appId: string) {
    if (appServers.get(appId) !== appServer) return;
    appServers.delete(appId);
    for (const client of [...(appClients.get(appId) ?? [])]) {
      sendClientState(client, 'closed', 'The app server is unavailable.');
      removeClientSession(client, { notifyAppServer: false, reason: 'client-closed' });
    }
  }

  async function handleAppServerAuthentication(
    socket: WebSocket,
    message: RelayInboundMessage
  ) {
    const connection = connections.get(socket);
    if (!connection) return;

    if (connection.clientIdentity || clientSessions.has(socket)) {
      sendError(socket, 'An app client cannot authenticate as an app server.');
      return;
    }

    if (connection.openingApp) {
      sendError(socket, 'An app client cannot authenticate as an app server.');
      return;
    }

    if (connection.appServer || connection.authenticating) {
      sendError(socket, 'This connection has already attempted app-server authentication.');
      return;
    }

    if (
      message.type !== 'app:authenticate'
      || typeof message.token !== 'string'
      || message.token.length === 0
      || message.token.length > AUTH_TOKEN_MAX_LENGTH
    ) {
      sendError(socket, 'App server authentication requires a valid token.');
      return;
    }

    connection.authenticating = true;
    let authenticatedAppServer: AuthenticatedAppServer | null = null;

    try {
      const authenticated = await options.authenticateAppServer(message.token);
      authenticatedAppServer = authenticated === null
        ? null
        : validateAuthenticatedAppServer(authenticated);
    } catch (error) {
      if (traffic.enabled) {
        traffic.log({
          event: 'authentication-error',
          connectionId: connection.connectionId,
          error: error instanceof Error ? error.message : 'Unknown authentication error'
        });
      }
    }

    if (!connections.has(socket)) return;

    if (!authenticatedAppServer) {
      sendError(socket, 'Authentication failed.');
      socket.close(4401, 'Authentication failed');
      return;
    }

    const existingAppServer = appServers.get(authenticatedAppServer.appId);
    if (existingAppServer && existingAppServer !== socket) {
      sendError(socket, 'App already has a connected server.');
      socket.close(4401, 'App already has a connected server');
      return;
    }

    connection.authenticating = false;
    connection.appServer = authenticatedAppServer;
    appServers.set(authenticatedAppServer.appId, socket);
    clearAuthenticationTimer(socket);
    send(socket, { type: 'app:ready', appId: authenticatedAppServer.appId });
  }

  async function handleAppOpen(socket: WebSocket, message: RelayInboundMessage) {
    if (message.type !== 'app:open') return;

    const connection = connections.get(socket);
    if (!connection) return;

    if (connection.appServer) {
      sendError(socket, 'An app server connection cannot open as an app client.');
      return;
    }

    if (connection.authenticating) {
      sendError(socket, 'App server authentication is still in progress.');
      return;
    }

    if (clientSessions.has(socket) || connection.openingApp) {
      sendError(socket, 'This client already has an open app connection.');
      return;
    }

    const credential = message.credential;
    if (
      !isRecord(credential)
      || credential.type !== 'jwt'
      || typeof credential.token !== 'string'
      || credential.token.length === 0
      || credential.token.length > AUTH_TOKEN_MAX_LENGTH
    ) {
      sendError(socket, 'Client authentication failed.');
      socket.close(4401, 'Client authentication failed');
      return;
    }

    connection.openingApp = true;
    let identity: VerifiedClientIdentity | null = null;
    try {
      const authenticated = await options.authenticateClient(credential.token);
      identity = authenticated === null
        ? null
        : validateVerifiedClientIdentity(authenticated);
    } catch (error) {
      if (traffic.enabled) {
        traffic.log({
          event: 'client-authentication-error',
          connectionId: connection.connectionId,
          error: error instanceof Error ? error.message : 'Unknown authentication error'
        });
      }
    }

    const authenticatedConnection = connections.get(socket);
    if (!authenticatedConnection) return;
    authenticatedConnection.openingApp = false;

    if (!identity) {
      sendError(socket, 'Client authentication failed.');
      socket.close(4401, 'Client authentication failed');
      return;
    }

    authenticatedConnection.clientIdentity = identity;
    clearAuthenticationTimer(socket);

    if (!isAppId(message.appId)) {
      sendError(socket, 'App ID must be a lowercase identifier such as "chat".');
      return;
    }

    const currentConnection = connections.get(socket);
    if (!currentConnection) return;
    const appServer = appServers.get(message.appId);
    if (!appServer) {
      currentConnection.openingApp = false;
      sendError(socket, 'App is not available.');
      return;
    }

    const requestId = nanoid();
    const admissionTimer = setTimeout(() => {
      const session = clientSessions.get(socket);
      if (!session || session.requestId !== requestId || session.state !== 'pending') return;

      sendClientState(socket, 'rejected', 'App admission timed out.');
      removeClientSession(socket, { notifyAppServer: true, reason: 'admission-timeout' });
    }, admissionTimeoutMs);
    const session: ClientSession = {
      appId: message.appId,
      appServer,
      requestId,
      state: 'pending',
      admissionTimer,
      identity
    };

    clientSessions.set(socket, session);
    pendingRequests.set(requestId, socket);
    let clients = appClients.get(message.appId);
    if (!clients) {
      clients = new Set<WebSocket>();
      appClients.set(message.appId, clients);
    }
    clients.add(socket);

    sendClientState(socket, 'pending');
    send(appServer, {
      type: 'app:connect',
      requestId,
      connectionId: connection.connectionId,
      identity,
      ...('hello' in message ? { hello: message.hello } : {})
    });
  }

  function getPendingSession(appServer: WebSocket, requestId: unknown) {
    if (typeof requestId !== 'string') {
      sendError(appServer, 'App admission requires a request id.');
      return undefined;
    }

    const client = pendingRequests.get(requestId);
    const session = client ? clientSessions.get(client) : undefined;
    if (!client || !session || session.appServer !== appServer || session.state !== 'pending') {
      sendError(appServer, 'Pending app request was not found for this server.');
      return undefined;
    }

    return { client, session };
  }

  function handleAppAccept(appServer: WebSocket, requestId: unknown) {
    const pending = getPendingSession(appServer, requestId);
    if (!pending) return;

    clearTimeout(pending.session.admissionTimer);
    pendingRequests.delete(pending.session.requestId);
    pending.session.state = 'admitted';
    sendClientState(pending.client, 'admitted');
  }

  function validateAppServerMessage(socket: WebSocket, message: unknown) {
    if (message === undefined) return true;
    if (typeof message !== 'string' || message.length > APP_SERVER_MESSAGE_MAX_LENGTH) {
      sendError(socket, `App server messages must be ${APP_SERVER_MESSAGE_MAX_LENGTH} characters or fewer.`);
      return false;
    }
    return true;
  }

  function handleAppReject(appServer: WebSocket, requestId: unknown, message: unknown) {
    if (!validateAppServerMessage(appServer, message)) return;
    const pending = getPendingSession(appServer, requestId);
    if (!pending) return;

    sendClientState(
      pending.client,
      'rejected',
      typeof message === 'string' ? message : undefined
    );
    removeClientSession(pending.client, { notifyAppServer: false, reason: 'client-closed' });
  }

  function handleAppRevoke(appServer: WebSocket, connectionId: unknown, message: unknown) {
    if (!validateAppServerMessage(appServer, message)) return;
    if (typeof connectionId !== 'string') {
      sendError(appServer, 'App revocation requires a connection id.');
      return;
    }

    const client = socketsByConnectionId.get(connectionId);
    const session = client ? clientSessions.get(client) : undefined;
    if (!client || !session || session.appServer !== appServer) {
      sendError(appServer, 'App client was not found for this app server.');
      return;
    }

    sendClientState(
      client,
      'rejected',
      typeof message === 'string' ? message : undefined
    );
    removeClientSession(client, { notifyAppServer: false, reason: 'client-closed' });
  }

  function handleClientPacket(socket: WebSocket, message: RelayInboundMessage) {
    if (message.type !== 'client:packet') return;
    if ('target' in message) {
      sendError(socket, 'Client packets cannot specify a target.');
      return;
    }
    const session = clientSessions.get(socket);
    const connection = connections.get(socket);
    if (!session || !connection) {
      sendError(socket, 'Only a connected app client can send client packets.');
      return;
    }

    send(session.appServer, {
      type: 'client:packet',
      from: {
        connectionId: connection.connectionId,
        state: session.state,
        identity: session.identity
      },
      ...('payload' in message ? { payload: message.payload } : {})
    });
  }

  function handleServerPacket(appServer: WebSocket, message: RelayInboundMessage) {
    if (message.type !== 'server:packet') return;
    const connection = connections.get(appServer);
    if (!connection?.appServer) {
      sendError(appServer, 'Only an authenticated app server can send server packets.');
      return;
    }

    const sendPacket = (client: WebSocket) => send(client, {
      type: 'server:packet',
      ...('payload' in message ? { payload: message.payload } : {})
    });

    if (message.target === 'all') {
      for (const client of appClients.get(connection.appServer.appId) ?? []) {
        if (clientSessions.get(client)?.state === 'admitted') sendPacket(client);
      }
      return;
    }

    if (!isRecord(message.target) || typeof message.target.connectionId !== 'string') {
      sendError(appServer, 'Server packet target must be "all" or a connection target.');
      return;
    }

    const client = socketsByConnectionId.get(message.target.connectionId);
    const session = client ? clientSessions.get(client) : undefined;
    if (!client || !session || session.appServer !== appServer) {
      sendError(appServer, 'Packet target is not a client of this app server.');
      return;
    }

    sendPacket(client);
  }

  function parseMessage(socket: WebSocket, data: RawData): RelayInboundMessage | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      if (isAuthenticatedConnection(socket)) {
        sendError(socket, 'Messages must be valid JSON.');
      } else {
        closeUnauthenticated(socket, 'Authentication is required.');
      }
      return null;
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      if (isAuthenticatedConnection(socket)) {
        sendError(socket, 'Messages must be JSON objects with a string type.');
      } else {
        closeUnauthenticated(socket, 'Authentication is required.');
      }
      return null;
    }
    return parsed as RelayInboundMessage;
  }

  function handleMessage(socket: WebSocket, data: RawData) {
    const message = parseMessage(socket, data);
    if (!message) return;

    const connection = connections.get(socket);
    if (!connection) return;
    const authenticated = isAuthenticatedConnection(socket);

    if (traffic.enabled) {
      traffic.log({
        event: 'receive',
        messageType: message.type,
        appId: message.type === 'app:open'
          ? message.appId
          : clientSessions.get(socket)?.appId ?? connection.appServer?.appId,
        fromConnectionId: connections.get(socket)?.connectionId,
        target: message.type === 'server:packet'
          ? typeof message.target === 'object' ? 'connection' : message.target
          : undefined,
        targetConnectionId: message.type === 'server:packet' && typeof message.target === 'object'
          ? message.target.connectionId
          : undefined,
        bytes: Buffer.byteLength(data.toString()),
        bufferedBytes: socket.bufferedAmount
      }, authenticated
        && (message.type === 'client:packet' || message.type === 'server:packet')
        ? message.payload
        : undefined);
    }

    if (!authenticated) {
      if (connection.authenticating || connection.openingApp) {
        closeUnauthenticated(socket, 'Authentication is already in progress.');
        return;
      }
      if (message.type === 'app:authenticate') {
        void handleAppServerAuthentication(socket, message);
        return;
      }
      if (message.type === 'app:open') {
        void handleAppOpen(socket, message);
        return;
      }

      closeUnauthenticated(socket, 'Authentication is required.');
      return;
    }

    if (message.type === 'app:authenticate') {
      void handleAppServerAuthentication(socket, message);
      return;
    }
    if (message.type === 'app:open') {
      void handleAppOpen(socket, message);
      return;
    }
    if (message.type === 'app:close') {
      const session = clientSessions.get(socket);
      if (!session) {
        sendError(socket, 'This client does not have an open app connection.');
        return;
      }
      sendClientState(socket, 'closed');
      removeClientSession(socket, { notifyAppServer: true, reason: 'client-closed' });
      return;
    }
    if (message.type === 'app:accept') {
      handleAppAccept(socket, message.requestId);
      return;
    }
    if (message.type === 'app:reject') {
      handleAppReject(socket, message.requestId, message.message);
      return;
    }
    if (message.type === 'app:revoke') {
      handleAppRevoke(socket, message.connectionId, message.message);
      return;
    }
    if (message.type === 'client:packet') {
      handleClientPacket(socket, message);
      return;
    }
    if (message.type === 'server:packet') {
      handleServerPacket(socket, message);
      return;
    }

    sendError(socket, 'Unknown message type.');
  }

  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      version: RELAY_VERSION,
      connections: connections.size,
      clients: clientSessions.size,
      pendingClients: [...clientSessions.values()].filter(({ state }) => state === 'pending').length,
      connectedApps: appServers.size
    } satisfies HealthResponse);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request);
    });
  });

  wss.on('connection', (socket) => {
    const connectionId = nanoid();
    const connection: ConnectionRecord = {
      connectionId,
      authenticating: false,
      openingApp: false
    };
    connections.set(socket, connection);
    socketsByConnectionId.set(connectionId, socket);
    if (traffic.enabled) traffic.log({ event: 'socket-open', connectionId });

    connection.authenticationTimer = setTimeout(() => {
      if (!connections.has(socket)) return;
      closeUnauthenticated(socket, 'Authentication timed out.');
    }, authenticationTimeoutMs);

    socket.on('message', (data) => handleMessage(socket, data));
    socket.on('error', (error) => {
      if (traffic.enabled) {
        traffic.log({
          event: 'socket-error',
          connectionId,
          error: error.message
        });
      }
    });

    socket.on('close', () => {
      const connection = connections.get(socket);
      const clientSession = clientSessions.get(socket);
      if (traffic.enabled) traffic.log({
        event: 'socket-close',
        connectionId: connection?.connectionId,
        appId: clientSession?.appId ?? connection?.appServer?.appId
      });

      if (clientSession) {
        removeClientSession(socket, { notifyAppServer: true, reason: 'client-disconnected' });
      }
      clearAuthenticationTimer(socket);
      if (connection?.appServer) {
        disconnectAppServer(socket, connection.appServer.appId);
      }

      if (connection) socketsByConnectionId.delete(connection.connectionId);
      connections.delete(socket);
    });
  });

  return { app, httpServer, wss };
}
