import express from 'express';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import {
  type ChatMessage,
  DEFAULT_ROOM_ID,
  type JoinPayload,
  MESSAGE_HISTORY_LIMIT,
  normalizeRoomId,
  type RoomState,
  type SendMessagePayload,
  type User
} from '../shared/chat.js';
import { createSqliteMessageStore, type MessageStore } from './messageStore.js';
import { validateDisplayName, validateMessageBody } from './validation.js';

export type ChatServerOptions = {
  clientOrigin?: string;
  messageStore?: MessageStore;
};

const DEFAULT_DB_PATH = 'data/chat.sqlite';

type UserSession = {
  roomId: string;
  user: User;
};

export function createChatServer(options: ChatServerOptions | string = {}) {
  const clientOrigin =
    typeof options === 'string' ? options : (options.clientOrigin ?? 'http://localhost:5173');
  const messageStore =
    typeof options === 'string'
      ? createSqliteMessageStore(process.env.CHAT_DB_PATH ?? DEFAULT_DB_PATH)
      : (options.messageStore ??
        createSqliteMessageStore(process.env.CHAT_DB_PATH ?? DEFAULT_DB_PATH));

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: clientOrigin,
      methods: ['GET', 'POST']
    }
  });

  const sessions = new Map<string, UserSession>();

  function getRoomState(roomId: string): RoomState {
    return {
      roomId,
      users: [...sessions.values()]
        .filter((session) => session.roomId === roomId)
        .map((session) => session.user)
        .sort((a, b) => a.name.localeCompare(b.name)),
      messages: messageStore.listRecentMessages(roomId, MESSAGE_HISTORY_LIMIT)
    };
  }

  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      users: sessions.size,
      messages: messageStore.countMessages()
    });
  });

  io.on('connection', (socket) => {
    socket.emit('room:state', getRoomState(DEFAULT_ROOM_ID));

    socket.on('join', (payload: JoinPayload = { name: '' }) => {
      const result = validateDisplayName(payload.name);
      const roomId = normalizeRoomId(payload.roomId);

      if (!result.ok) {
        socket.emit('error:notice', { message: result.error });
        return;
      }

      const previousSession = sessions.get(socket.id);
      const user: User = { id: socket.id, name: result.value };
      sessions.set(socket.id, { roomId, user });

      if (previousSession && previousSession.roomId !== roomId) {
        socket.leave(previousSession.roomId);
        socket.to(previousSession.roomId).emit('user:left', {
          id: nanoid(),
          type: 'user:left',
          user: previousSession.user,
          createdAt: new Date().toISOString()
        });
        io.to(previousSession.roomId).emit('room:state', getRoomState(previousSession.roomId));
      }

      socket.join(roomId);
      socket.emit('room:state', getRoomState(roomId));

      if (!previousSession || previousSession.roomId !== roomId) {
        socket.to(roomId).emit('user:joined', {
          id: nanoid(),
          type: 'user:joined',
          user,
          createdAt: new Date().toISOString()
        });
      } else {
        io.to(roomId).emit('room:state', getRoomState(roomId));
      }
    });

    socket.on('message:send', (payload: SendMessagePayload = { body: '' }) => {
      const session = sessions.get(socket.id);

      if (!session) {
        socket.emit('error:notice', { message: 'Join the room before sending messages.' });
        return;
      }

      const result = validateMessageBody(payload.body);

      if (!result.ok) {
        socket.emit('error:notice', { message: result.error });
        return;
      }

      const message: ChatMessage = {
        id: nanoid(),
        roomId: session.roomId,
        userId: session.user.id,
        userName: session.user.name,
        body: result.value,
        createdAt: new Date().toISOString()
      };

      messageStore.saveMessage(message);
      io.to(session.roomId).emit('message:new', message);
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket.id);

      if (!session) {
        return;
      }

      sessions.delete(socket.id);
      socket.to(session.roomId).emit('user:left', {
        id: nanoid(),
        type: 'user:left',
        user: session.user,
        createdAt: new Date().toISOString()
      });
      io.to(session.roomId).emit('room:state', getRoomState(session.roomId));
    });
  });

  return { app, httpServer, io, messageStore };
}
