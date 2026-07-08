import express from 'express';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  type ClientMessage,
  DEFAULT_SPACE_ID,
  type JoinSpaceMessage,
  type PacketTarget,
  type Participant,
  type RelayPacketMessage,
  type ServerMessage,
  type SpacePacketMessage,
  normalizeGuestId,
  normalizeSpaceId
} from './shared.js';
import { validateDisplayName } from './validation.js';
import { RELAY_VERSION } from './version.js';

type ParticipantSession = {
  spaceId: string;
  participant: Participant;
};

type ConnectionRecord = {
  connectionId: string;
};

type HealthResponse = {
  ok: true;
  version: string;
  participants: number;
  activeSpaces: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createRelayServer() {
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<WebSocket, ConnectionRecord>();
  const sessions = new Map<WebSocket, ParticipantSession>();
  const spaces = new Map<string, Set<WebSocket>>();

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  function sendError(socket: WebSocket, message: string) {
    send(socket, {
      type: 'error:notice',
      message
    });
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

    if (
      'target' in message
      && message.target !== undefined
      && message.target !== 'space'
      && message.target !== 'others'
    ) {
      sendError(socket, 'Packet target must be "space" or "others".');
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
      connectionId: nanoid()
    });

    socket.on('message', (data) => {
      handleMessage(socket, data);
    });

    socket.on('close', () => {
      leaveCurrentSpace(socket);
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
