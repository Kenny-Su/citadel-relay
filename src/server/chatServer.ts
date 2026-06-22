import express from 'express';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import {
  type ChatMessage,
  type JoinPayload,
  MESSAGE_HISTORY_LIMIT,
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

  const users = new Map<string, User>();

  function getRoomState(): RoomState {
    return {
      users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name)),
      messages: messageStore.listRecentMessages(MESSAGE_HISTORY_LIMIT)
    };
  }

  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      users: users.size,
      messages: messageStore.countMessages()
    });
  });

  io.on('connection', (socket) => {
    socket.emit('room:state', getRoomState());

    socket.on('join', (payload: JoinPayload = { name: '' }) => {
      const result = validateDisplayName(payload.name);

      if (!result.ok) {
        socket.emit('error:notice', { message: result.error });
        return;
      }

      const previousUser = users.get(socket.id);
      const user: User = { id: socket.id, name: result.value };
      users.set(socket.id, user);

      socket.emit('room:state', getRoomState());

      if (!previousUser) {
        socket.broadcast.emit('user:joined', {
          id: nanoid(),
          type: 'user:joined',
          user,
          createdAt: new Date().toISOString()
        });
      } else {
        io.emit('room:state', getRoomState());
      }
    });

    socket.on('message:send', (payload: SendMessagePayload = { body: '' }) => {
      const user = users.get(socket.id);

      if (!user) {
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
        userId: user.id,
        userName: user.name,
        body: result.value,
        createdAt: new Date().toISOString()
      };

      messageStore.saveMessage(message);
      io.emit('message:new', message);
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);

      if (!user) {
        return;
      }

      users.delete(socket.id);
      socket.broadcast.emit('user:left', {
        id: nanoid(),
        type: 'user:left',
        user,
        createdAt: new Date().toISOString()
      });
      io.emit('room:state', getRoomState());
    });
  });

  return { app, httpServer, io, messageStore };
}
