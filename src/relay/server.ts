import express from 'express';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  type AuthenticatedPrincipal,
  type ClientMessage,
  DEFAULT_SPACE_ID,
  type JoinSpaceMessage,
  type PacketTarget,
  type Participant,
  type RelayPacketMessage,
  type ServerMessage,
  type SpacePacketMessage,
  isNamespace,
  normalizeGuestId,
  normalizeSpaceId
} from './shared.js';
import {
  AUTH_TOKEN_MAX_LENGTH,
  type RelayAuthenticator,
  validateAuthenticatedPrincipal
} from './auth.js';
import { validateDisplayName } from './validation.js';
import { RELAY_VERSION } from './version.js';
import { createTrafficLogger } from './trafficLog.js';

type ParticipantSession = {
  spaceId: string;
  participant: Participant;
};

type ConnectionRecord = {
  connectionId: string;
  authenticating: boolean;
  ownerPrincipal?: AuthenticatedPrincipal;
};

type HealthResponse = {
  ok: true;
  version: string;
  participants: number;
  activeSpaces: number;
};

export type RelayServerOptions = {
  authenticateOwner?: RelayAuthenticator;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createRelayServer(options: RelayServerOptions = {}) {
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<WebSocket, ConnectionRecord>();
  const sessions = new Map<WebSocket, ParticipantSession>();
  const spaces = new Map<string, Set<WebSocket>>();
  const namespaceOwners = new Map<string, WebSocket>();
  const ownerNamespaces = new Map<WebSocket, Set<string>>();
  const traffic = createTrafficLogger();
  const authenticateOwner = options.authenticateOwner ?? (() => null);

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const serialized = JSON.stringify(message);
    socket.send(serialized);
    if (traffic.enabled) {
      const recipient = sessions.get(socket);
      traffic.log({
        event: 'send',
        messageType: message.type,
        topic: message.type === 'space:packet' ? message.topic : undefined,
        spaceId: 'spaceId' in message ? message.spaceId : recipient?.spaceId,
        toConnectionId: recipient?.participant.connectionId ?? connections.get(socket)?.connectionId,
        fromConnectionId: message.type === 'space:packet' ? message.from.connectionId : undefined,
        bytes: Buffer.byteLength(serialized),
        bufferedBytes: socket.bufferedAmount
      }, message.type === 'space:packet' ? message.payload : undefined);
    }
  }

  function sendError(socket: WebSocket, message: string) {
    send(socket, {
      type: 'error:notice',
      message
    });
  }

  async function handleOwnerAuthentication(socket: WebSocket, message: ClientMessage) {
    const connection = connections.get(socket);
    if (!connection) return;

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
      const authenticated = await authenticateOwner(message.token);
      principal = authenticated === null ? null : validateAuthenticatedPrincipal(authenticated);
    } catch {
      principal = null;
    }

    if (!connections.has(socket)) return;
    if (!principal) {
      sendError(socket, 'Authentication failed.');
      socket.close(4401, 'Authentication failed');
      return;
    }

    connection.authenticating = false;
    connection.ownerPrincipal = principal;
    send(socket, {
      type: 'auth:state',
      principal: {
        id: principal.id,
        ...(principal.name !== undefined ? { name: principal.name } : {})
      }
    });
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
    const existing = namespaceOwners.get(namespace);
    if (existing && existing !== socket) {
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

  function releaseNamespace(socket: WebSocket, namespace: string, notifyOwner: boolean) {
    if (namespaceOwners.get(namespace) !== socket) {
      if (notifyOwner) sendError(socket, 'This connection does not own that namespace.');
      return;
    }
    namespaceOwners.delete(namespace);
    ownerNamespaces.get(socket)?.delete(namespace);
    if (notifyOwner) send(socket, { type: 'namespace:released', namespace });
  }

  function getSpaceSockets(spaceId: string) {
    return spaces.get(spaceId) ?? new Set<WebSocket>();
  }

  function getParticipants(spaceId: string) {
    return [...getSpaceSockets(spaceId)]
      .map((socket) => sessions.get(socket)?.participant)
      .filter((participant): participant is Participant => Boolean(participant))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function broadcast(spaceId: string, message: ServerMessage, options: { except?: WebSocket } = {}) {
    for (const socket of getSpaceSockets(spaceId)) {
      if (socket === options.except) {
        continue;
      }

      send(socket, message);
    }
  }

  function findSpaceSocket(spaceId: string, connectionId: string) {
    return [...getSpaceSockets(spaceId)].find(
      (candidate) => sessions.get(candidate)?.participant.connectionId === connectionId
    );
  }

  function emitSpaceState(spaceId: string) {
    broadcast(spaceId, {
      type: 'space:state',
      spaceId,
      participants: getParticipants(spaceId)
    });
  }

  function leaveCurrentSpace(socket: WebSocket, notifyParticipant = true) {
    const session = sessions.get(socket);

    if (!session) {
      return;
    }

    const members = spaces.get(session.spaceId);
    sessions.delete(socket);
    members?.delete(socket);

    if (members?.size === 0) {
      spaces.delete(session.spaceId);
    }

    if (!notifyParticipant) {
      return;
    }

    broadcast(session.spaceId, {
      type: 'participant:left',
      spaceId: session.spaceId,
      participant: session.participant,
      createdAt: new Date().toISOString()
    });
    emitSpaceState(session.spaceId);
  }

  function handleJoin(socket: WebSocket, message: JoinSpaceMessage) {
    const result = validateDisplayName(message.name);

    if (!result.ok) {
      sendError(socket, result.error);
      return;
    }

    const connection = connections.get(socket);

    if (!connection) {
      sendError(socket, 'Connection is not registered.');
      return;
    }

    const spaceId = normalizeSpaceId(message.spaceId ?? DEFAULT_SPACE_ID);
    const previousSession = sessions.get(socket);

    if (previousSession && previousSession.spaceId !== spaceId) {
      leaveCurrentSpace(socket);
    }

    const participant: Participant = {
      id: normalizeGuestId(message.guestId, connection.connectionId),
      connectionId: connection.connectionId,
      name: result.value
    };
    const isNewSpaceMember = !previousSession || previousSession.spaceId !== spaceId;

    sessions.set(socket, {
      spaceId,
      participant
    });

    let members = spaces.get(spaceId);

    if (!members) {
      members = new Set<WebSocket>();
      spaces.set(spaceId, members);
    }

    members.add(socket);

    if (isNewSpaceMember) {
      broadcast(spaceId, {
        type: 'participant:joined',
        spaceId,
        participant,
        createdAt: new Date().toISOString()
      }, { except: socket });
    }

    emitSpaceState(spaceId);
  }

  function handlePacket(socket: WebSocket, message: SpacePacketMessage) {
    const session = sessions.get(socket);

    if (!session) {
      sendError(socket, 'Join a space before sending packets.');
      return;
    }

    const requestedTarget = message.target;
    const validConnectionTarget = isRecord(requestedTarget)
      && typeof requestedTarget.connectionId === 'string'
      && requestedTarget.connectionId.length > 0
      && requestedTarget.connectionId.length <= 128;
    if (
      requestedTarget !== undefined
      && requestedTarget !== 'space'
      && requestedTarget !== 'others'
      && !validConnectionTarget
    ) {
      sendError(socket, 'Packet target must be "space", "others", or a connection target.');
      return;
    }

    if ('topic' in message && typeof message.topic !== 'string') {
      sendError(socket, 'Packet topic must be a string.');
      return;
    }

    const target: PacketTarget = message.target ?? 'space';
    const outbound: RelayPacketMessage = {
      type: 'space:packet',
      spaceId: session.spaceId,
      from: session.participant,
      createdAt: new Date().toISOString()
    };

    if ('payload' in message) {
      outbound.payload = message.payload;
    }

    if ('topic' in message) {
      outbound.topic = message.topic;
    }

    if (typeof target === 'object') {
      const recipient = findSpaceSocket(session.spaceId, target.connectionId);
      if (!recipient) {
        sendError(socket, 'Packet target is not connected to this space.');
        return;
      }
      send(recipient, outbound);
      return;
    }

    broadcast(session.spaceId, outbound, target === 'others' ? { except: socket } : undefined);
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

    if (!message) {
      return;
    }

    if (traffic.enabled) {
      const session = sessions.get(socket);
      traffic.log({
        event: 'receive',
        messageType: message.type,
        topic: message.type === 'space:packet' ? message.topic : undefined,
        spaceId: message.type === 'space:join' ? message.spaceId : session?.spaceId,
        fromConnectionId: session?.participant.connectionId ?? connections.get(socket)?.connectionId,
        target: message.type === 'space:packet'
          ? typeof message.target === 'object' ? 'connection' : message.target ?? 'space'
          : undefined,
        targetConnectionId: message.type === 'space:packet' && typeof message.target === 'object'
          ? message.target.connectionId
          : undefined,
        bytes: Buffer.byteLength(data.toString()),
        bufferedBytes: socket.bufferedAmount
      }, message.type === 'space:packet' ? message.payload : undefined);
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

    if (message.type === 'space:join') {
      handleJoin(socket, message);
      return;
    }

    if (message.type === 'space:packet') {
      handlePacket(socket, message);
      return;
    }

    if (message.type === 'space:leave') {
      leaveCurrentSpace(socket);
      return;
    }

    sendError(socket, 'Unknown message type.');
  }

  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      version: RELAY_VERSION,
      participants: sessions.size,
      activeSpaces: spaces.size
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
    connections.set(socket, {
      connectionId: nanoid(),
      authenticating: false
    });
    if (traffic.enabled) traffic.log({
      event: 'socket-open',
      connectionId: connections.get(socket)?.connectionId
    });

    socket.on('message', (data) => {
      handleMessage(socket, data);
    });

    socket.on('close', () => {
      if (traffic.enabled) traffic.log({
        event: 'socket-close',
        connectionId: sessions.get(socket)?.participant.connectionId ?? connections.get(socket)?.connectionId,
        spaceId: sessions.get(socket)?.spaceId
      });
      leaveCurrentSpace(socket);
      for (const namespace of [...(ownerNamespaces.get(socket) ?? [])]) {
        releaseNamespace(socket, namespace, false);
      }
      ownerNamespaces.delete(socket);
      sessions.delete(socket);
      connections.delete(socket);
    });
  });

  return {
    app,
    httpServer,
    wss
  };
}
