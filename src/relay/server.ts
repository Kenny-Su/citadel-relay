import express from 'express';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  type AuthenticatedPrincipal,
  type ClientMessage,
  type ClientState,
  type PublicPrincipal,
  type ServerMessage,
  isNamespace
} from './shared.js';
import {
  AUTH_TOKEN_MAX_LENGTH,
  type RelayAuthenticator,
  validateAuthenticatedPrincipal
} from './auth.js';
import { RELAY_VERSION } from './version.js';
import { createTrafficLogger } from './trafficLog.js';

const DEFAULT_ADMISSION_TIMEOUT_MS = 60_000;
const OWNER_MESSAGE_MAX_LENGTH = 256;

type ConnectionRecord = {
  connectionId: string;
  authenticating: boolean;
  ownerPrincipal?: AuthenticatedPrincipal;
};

type ClientSession = {
  namespace: string;
  owner: WebSocket;
  requestId: string;
  state: ClientState;
  admissionTimer: ReturnType<typeof setTimeout>;
};

type HealthResponse = {
  ok: true;
  version: string;
  connections: number;
  clients: number;
  pendingClients: number;
  claimedNamespaces: number;
};

export type RelayServerOptions = {
  authenticateOwner: RelayAuthenticator;
  admissionTimeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicPrincipal(principal: AuthenticatedPrincipal): PublicPrincipal {
  return {
    id: principal.id,
    ...(principal.name !== undefined ? { name: principal.name } : {})
  };
}

export function createRelayServer(options: RelayServerOptions) {
  if (!options || typeof options.authenticateOwner !== 'function') {
    throw new Error('createRelayServer requires an authenticateOwner function.');
  }

  const admissionTimeoutMs = options.admissionTimeoutMs ?? DEFAULT_ADMISSION_TIMEOUT_MS;
  if (!Number.isFinite(admissionTimeoutMs) || admissionTimeoutMs <= 0) {
    throw new Error('admissionTimeoutMs must be a positive number.');
  }

  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<WebSocket, ConnectionRecord>();
  const socketsByConnectionId = new Map<string, WebSocket>();
  const clientSessions = new Map<WebSocket, ClientSession>();
  const pendingRequests = new Map<string, WebSocket>();
  const namespaceOwners = new Map<string, WebSocket>();
  const ownerNamespaces = new Map<WebSocket, Set<string>>();
  const namespaceClients = new Map<string, Set<WebSocket>>();
  const traffic = createTrafficLogger();

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;

    const serialized = JSON.stringify(message);
    socket.send(serialized);

    if (traffic.enabled) {
      traffic.log({
        event: 'send',
        messageType: message.type,
        namespace: 'namespace' in message ? message.namespace : undefined,
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

  function sendClientState(
    socket: WebSocket,
    namespace: string,
    state: 'pending' | 'admitted' | 'rejected' | 'closed',
    message?: string
  ) {
    const connectionId = connections.get(socket)?.connectionId;
    if (!connectionId) return;

    send(socket, {
      type: 'namespace:state',
      namespace,
      state,
      connectionId,
      ...(message !== undefined ? { message } : {})
    });
  }

  function removeClientSession(
    socket: WebSocket,
    options: {
      notifyOwner: boolean;
      reason: 'client-closed' | 'client-disconnected' | 'admission-timeout';
    }
  ) {
    const session = clientSessions.get(socket);
    const connection = connections.get(socket);
    if (!session || !connection) return;

    clearTimeout(session.admissionTimer);
    pendingRequests.delete(session.requestId);
    clientSessions.delete(socket);
    const clients = namespaceClients.get(session.namespace);
    clients?.delete(socket);
    if (clients?.size === 0) namespaceClients.delete(session.namespace);

    if (options.notifyOwner) {
      send(session.owner, {
        type: 'namespace:disconnect',
        namespace: session.namespace,
        connectionId: connection.connectionId,
        admitted: session.state === 'admitted',
        reason: options.reason
      });
    }
  }

  function releaseNamespace(owner: WebSocket, namespace: string, notifyOwner: boolean) {
    if (namespaceOwners.get(namespace) !== owner) {
      if (notifyOwner) sendError(owner, 'This connection does not own that namespace.');
      return;
    }

    namespaceOwners.delete(namespace);
    ownerNamespaces.get(owner)?.delete(namespace);

    for (const client of [...(namespaceClients.get(namespace) ?? [])]) {
      sendClientState(client, namespace, 'closed', 'The namespace owner is unavailable.');
      removeClientSession(client, { notifyOwner: false, reason: 'client-closed' });
    }

    if (notifyOwner) send(owner, { type: 'namespace:released', namespace });
  }

  async function handleOwnerAuthentication(socket: WebSocket, message: ClientMessage) {
    const connection = connections.get(socket);
    if (!connection) return;

    if (clientSessions.has(socket)) {
      sendError(socket, 'A namespace client cannot authenticate as an owner.');
      return;
    }

    if (connection.ownerPrincipal || connection.authenticating) {
      sendError(socket, 'This connection has already attempted owner authentication.');
      return;
    }

    if (
      message.type !== 'auth:authenticate'
      || typeof message.token !== 'string'
      || message.token.length === 0
      || message.token.length > AUTH_TOKEN_MAX_LENGTH
    ) {
      sendError(socket, 'Owner authentication requires a valid token.');
      return;
    }

    connection.authenticating = true;
    let principal: AuthenticatedPrincipal | null = null;

    try {
      const authenticated = await options.authenticateOwner(message.token);
      principal = authenticated === null ? null : validateAuthenticatedPrincipal(authenticated);
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

    if (!principal) {
      sendError(socket, 'Authentication failed.');
      socket.close(4401, 'Authentication failed');
      return;
    }

    connection.authenticating = false;
    connection.ownerPrincipal = principal;
    send(socket, { type: 'auth:state', principal: publicPrincipal(principal) });
  }

  function handleNamespaceClaim(socket: WebSocket, namespace: unknown) {
    const principal = connections.get(socket)?.ownerPrincipal;
    if (!principal) {
      sendError(socket, 'Only an authenticated app owner can claim a namespace.');
      return;
    }

    if (!isNamespace(namespace)) {
      sendError(socket, 'Namespace must be a first-level lowercase path such as "/chat".');
      return;
    }

    if (!principal.namespaceClaims?.includes(namespace)) {
      sendError(socket, 'This app owner is not authorized for that namespace.');
      return;
    }

    const existingOwner = namespaceOwners.get(namespace);
    if (existingOwner && existingOwner !== socket) {
      sendError(socket, 'Namespace is already claimed.');
      return;
    }

    namespaceOwners.set(namespace, socket);
    let namespaces = ownerNamespaces.get(socket);
    if (!namespaces) {
      namespaces = new Set<string>();
      ownerNamespaces.set(socket, namespaces);
    }
    namespaces.add(namespace);
    send(socket, { type: 'namespace:claimed', namespace });
  }

  function handleNamespaceOpen(socket: WebSocket, message: ClientMessage) {
    if (message.type !== 'namespace:open') return;

    const connection = connections.get(socket);
    if (!connection) return;

    if (connection.ownerPrincipal) {
      sendError(socket, 'An app owner connection cannot open as a namespace client.');
      return;
    }

    if (connection.authenticating) {
      sendError(socket, 'Owner authentication is still in progress.');
      return;
    }

    if (clientSessions.has(socket)) {
      sendError(socket, 'This client already has an open namespace.');
      return;
    }

    if (!isNamespace(message.namespace)) {
      sendError(socket, 'Namespace must be a first-level lowercase path such as "/chat".');
      return;
    }

    const owner = namespaceOwners.get(message.namespace);
    if (!owner) {
      sendError(socket, 'Namespace is not available.');
      return;
    }

    const requestId = nanoid();
    const admissionTimer = setTimeout(() => {
      const session = clientSessions.get(socket);
      if (!session || session.requestId !== requestId || session.state !== 'pending') return;

      sendClientState(socket, session.namespace, 'rejected', 'Namespace admission timed out.');
      removeClientSession(socket, { notifyOwner: true, reason: 'admission-timeout' });
    }, admissionTimeoutMs);
    const session: ClientSession = {
      namespace: message.namespace,
      owner,
      requestId,
      state: 'pending',
      admissionTimer
    };

    clientSessions.set(socket, session);
    pendingRequests.set(requestId, socket);
    let clients = namespaceClients.get(message.namespace);
    if (!clients) {
      clients = new Set<WebSocket>();
      namespaceClients.set(message.namespace, clients);
    }
    clients.add(socket);

    sendClientState(socket, message.namespace, 'pending');
    send(owner, {
      type: 'namespace:connect',
      requestId,
      namespace: message.namespace,
      connectionId: connection.connectionId,
      ...('hello' in message ? { hello: message.hello } : {})
    });
  }

  function getPendingSession(owner: WebSocket, requestId: unknown) {
    if (typeof requestId !== 'string') {
      sendError(owner, 'Namespace admission requires a request id.');
      return undefined;
    }

    const client = pendingRequests.get(requestId);
    const session = client ? clientSessions.get(client) : undefined;
    if (!client || !session || session.owner !== owner || session.state !== 'pending') {
      sendError(owner, 'Pending namespace request was not found for this owner.');
      return undefined;
    }

    return { client, session };
  }

  function handleNamespaceAccept(owner: WebSocket, requestId: unknown) {
    const pending = getPendingSession(owner, requestId);
    if (!pending) return;

    clearTimeout(pending.session.admissionTimer);
    pendingRequests.delete(pending.session.requestId);
    pending.session.state = 'admitted';
    sendClientState(pending.client, pending.session.namespace, 'admitted');
  }

  function validateOwnerMessage(socket: WebSocket, message: unknown) {
    if (message === undefined) return true;
    if (typeof message !== 'string' || message.length > OWNER_MESSAGE_MAX_LENGTH) {
      sendError(socket, `Owner messages must be ${OWNER_MESSAGE_MAX_LENGTH} characters or fewer.`);
      return false;
    }
    return true;
  }

  function handleNamespaceReject(owner: WebSocket, requestId: unknown, message: unknown) {
    if (!validateOwnerMessage(owner, message)) return;
    const pending = getPendingSession(owner, requestId);
    if (!pending) return;

    sendClientState(
      pending.client,
      pending.session.namespace,
      'rejected',
      typeof message === 'string' ? message : undefined
    );
    removeClientSession(pending.client, { notifyOwner: false, reason: 'client-closed' });
  }

  function handleNamespaceRevoke(owner: WebSocket, connectionId: unknown, message: unknown) {
    if (!validateOwnerMessage(owner, message)) return;
    if (typeof connectionId !== 'string') {
      sendError(owner, 'Namespace revocation requires a connection id.');
      return;
    }

    const client = socketsByConnectionId.get(connectionId);
    const session = client ? clientSessions.get(client) : undefined;
    if (!client || !session || session.owner !== owner) {
      sendError(owner, 'Namespace client was not found for this owner.');
      return;
    }

    sendClientState(
      client,
      session.namespace,
      'rejected',
      typeof message === 'string' ? message : undefined
    );
    removeClientSession(client, { notifyOwner: false, reason: 'client-closed' });
  }

  function handleClientPacket(socket: WebSocket, message: ClientMessage) {
    if (message.type !== 'client:packet') return;
    if ('target' in message || 'namespace' in message) {
      sendError(socket, 'Client packets cannot specify a namespace or target.');
      return;
    }
    const session = clientSessions.get(socket);
    const connection = connections.get(socket);
    if (!session || !connection) {
      sendError(socket, 'Only an open namespace client can send client packets.');
      return;
    }

    send(session.owner, {
      type: 'client:packet',
      namespace: session.namespace,
      from: {
        connectionId: connection.connectionId,
        state: session.state
      },
      ...('payload' in message ? { payload: message.payload } : {})
    });
  }

  function handleServerPacket(owner: WebSocket, message: ClientMessage) {
    if (message.type !== 'server:packet') return;
    if (!connections.get(owner)?.ownerPrincipal) {
      sendError(owner, 'Only an authenticated namespace owner can send server packets.');
      return;
    }

    if (!isNamespace(message.namespace) || namespaceOwners.get(message.namespace) !== owner) {
      sendError(owner, 'This connection does not own the packet namespace.');
      return;
    }

    const sendPacket = (client: WebSocket) => send(client, {
      type: 'server:packet',
      namespace: message.namespace,
      ...('payload' in message ? { payload: message.payload } : {})
    });

    if (message.target === 'all') {
      for (const client of namespaceClients.get(message.namespace) ?? []) {
        if (clientSessions.get(client)?.state === 'admitted') sendPacket(client);
      }
      return;
    }

    if (!isRecord(message.target) || typeof message.target.connectionId !== 'string') {
      sendError(owner, 'Server packet target must be "all" or a connection target.');
      return;
    }

    const client = socketsByConnectionId.get(message.target.connectionId);
    const session = client ? clientSessions.get(client) : undefined;
    if (!client || !session || session.owner !== owner || session.namespace !== message.namespace) {
      sendError(owner, 'Packet target is not a client of this namespace owner.');
      return;
    }

    sendPacket(client);
  }

  function parseMessage(socket: WebSocket, data: RawData): ClientMessage | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      sendError(socket, 'Messages must be valid JSON.');
      return null;
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      sendError(socket, 'Messages must be JSON objects with a string type.');
      return null;
    }
    return parsed as ClientMessage;
  }

  function handleMessage(socket: WebSocket, data: RawData) {
    const message = parseMessage(socket, data);
    if (!message) return;

    if (traffic.enabled) {
      traffic.log({
        event: 'receive',
        messageType: message.type,
        namespace: 'namespace' in message ? message.namespace : clientSessions.get(socket)?.namespace,
        fromConnectionId: connections.get(socket)?.connectionId,
        target: message.type === 'server:packet'
          ? typeof message.target === 'object' ? 'connection' : message.target
          : undefined,
        targetConnectionId: message.type === 'server:packet' && typeof message.target === 'object'
          ? message.target.connectionId
          : undefined,
        bytes: Buffer.byteLength(data.toString()),
        bufferedBytes: socket.bufferedAmount
      }, message.type === 'client:packet' || message.type === 'server:packet'
        ? message.payload
        : undefined);
    }

    if (message.type === 'auth:authenticate') {
      void handleOwnerAuthentication(socket, message);
      return;
    }
    if (message.type === 'namespace:claim') {
      handleNamespaceClaim(socket, message.namespace);
      return;
    }
    if (message.type === 'namespace:release') {
      if (!isNamespace(message.namespace)) {
        sendError(socket, 'Namespace must be a first-level lowercase path such as "/chat".');
        return;
      }
      releaseNamespace(socket, message.namespace, true);
      return;
    }
    if (message.type === 'namespace:open') {
      handleNamespaceOpen(socket, message);
      return;
    }
    if (message.type === 'namespace:close') {
      const session = clientSessions.get(socket);
      if (!session) {
        sendError(socket, 'This client does not have an open namespace.');
        return;
      }
      sendClientState(socket, session.namespace, 'closed');
      removeClientSession(socket, { notifyOwner: true, reason: 'client-closed' });
      return;
    }
    if (message.type === 'namespace:accept') {
      handleNamespaceAccept(socket, message.requestId);
      return;
    }
    if (message.type === 'namespace:reject') {
      handleNamespaceReject(socket, message.requestId, message.message);
      return;
    }
    if (message.type === 'namespace:revoke') {
      handleNamespaceRevoke(socket, message.connectionId, message.message);
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
      claimedNamespaces: namespaceOwners.size
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
    connections.set(socket, { connectionId, authenticating: false });
    socketsByConnectionId.set(connectionId, socket);
    if (traffic.enabled) traffic.log({ event: 'socket-open', connectionId });

    socket.on('message', (data) => handleMessage(socket, data));

    socket.on('close', () => {
      const connection = connections.get(socket);
      const clientSession = clientSessions.get(socket);
      if (traffic.enabled) traffic.log({
        event: 'socket-close',
        connectionId: connection?.connectionId,
        namespace: clientSession?.namespace
      });

      if (clientSession) {
        removeClientSession(socket, { notifyOwner: true, reason: 'client-disconnected' });
      }
      for (const namespace of [...(ownerNamespaces.get(socket) ?? [])]) {
        releaseNamespace(socket, namespace, false);
      }

      if (connection) socketsByConnectionId.delete(connection.connectionId);
      ownerNamespaces.delete(socket);
      connections.delete(socket);
    });
  });

  return { app, httpServer, wss };
}
