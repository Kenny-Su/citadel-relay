import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as Client, type Socket } from 'socket.io-client';
import { createChatServer } from '../../src/server/chatServer.js';
import { createChatRepository } from '../../src/apps/chat/messageStore.js';
import { createChessRepository } from '../../src/apps/chess/repository.js';
import { openCitadelDatabase, type CitadelDatabase } from '../../src/persistence/sqlite.js';
import type { ChatMessage, TypingUpdatePayload } from '../../src/apps/chat/shared.js';
import type { ChessState } from '../../src/apps/chess/shared.js';
import type { SnakeState } from '../../src/apps/snake/shared.js';
import type { AppEventEnvelope, AppId, PlatformErrorPayload, SpaceState } from '../../src/shared/platform.js';
import type { AppManifest } from '../../src/platform/appContract.js';

function once<T>(socket: Socket, event: string) {
  return new Promise<T>((resolve) => {
    socket.once(event, resolve);
  });
}

function onceAppEvent<T>(socket: Socket, type: string) {
  return new Promise<T>((resolve) => {
    function handler(event: AppEventEnvelope<T>) {
      if (event.type === type) {
        socket.off('app:event', handler);
        resolve(event.payload as T);
      }
    }

    socket.on('app:event', handler);
  });
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type PlatformMetadataResponse = {
  apps: AppId[];
  appManifests: AppManifest[];
};

type HealthResponse = PlatformMetadataResponse & {
  ok: boolean;
  appCount: number;
  participants: number;
  version: string;
};

describe('platform socket', () => {
  let server: ReturnType<typeof createChatServer>;
  let tempDir: string;
  let dbPath: string;
  let database: CitadelDatabase;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-platform-socket-'));
    dbPath = join(tempDir, 'chat.sqlite');
    database = openCitadelDatabase(dbPath);
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      messageRateLimit: {
        maxMessages: 5,
        windowMs: 80
      }
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function connectClient() {
    const client = Client(url, { autoConnect: false, transports: ['websocket'] });
    clients.push(client);
    const connected = once(client, 'connect');
    client.connect();
    await connected;
    return client;
  }

  async function joinSpace(client: Socket, name: string, appId: AppId, spaceId: string, guestId = `guest-${name.toLowerCase()}`) {
    const state = once<SpaceState>(client, 'space:state');
    client.emit('space:join', { appId, guestId, name, spaceId });
    return state;
  }

  it('exposes enabled apps through health and config', async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();

    database = openCitadelDatabase(dbPath);
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      enabledAppIds: ['chat', 'snake'],
      messageRateLimit: {
        maxMessages: 5,
        windowMs: 80
      }
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;

    const expectedAppManifests = [
      {
        appId: 'chat',
        label: 'Chat',
        defaultSpaceId: 'general',
        persistence: 'sqlite',
        version: '0.1.0'
      },
      {
        appId: 'snake',
        label: 'Snake',
        defaultSpaceId: 'general',
        persistence: 'none',
        version: '0.1.0'
      }
    ];
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    const config = await fetch(`${url}/config`).then((response) => response.json()) as PlatformMetadataResponse;

    expect(health).toMatchObject({
      ok: true,
      apps: ['chat', 'snake'],
      appCount: 2,
      appManifests: expectedAppManifests,
      version: '0.1.0'
    });
    expect(config).toEqual({
      apps: health.apps,
      appManifests: health.appManifests
    });
  });

  it('rejects joins for disabled apps', async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();

    database = openCitadelDatabase(dbPath);
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      enabledAppIds: ['chat'],
      messageRateLimit: {
        maxMessages: 5,
        windowMs: 80
      }
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;

    const ada = await connectClient();
    const error = once<PlatformErrorPayload>(ada, 'error:notice');
    ada.emit('space:join', {
      appId: 'chess',
      guestId: 'stable-ada',
      name: 'Ada',
      spaceId: 'board'
    });

    expect(await error).toEqual({ message: 'Unknown app.' });

    const state = await joinSpace(ada, 'Ada', 'chat', 'general', 'stable-ada');
    expect(state.appId).toBe('chat');
  });

  it('joins participants and isolates presence by app and space', async () => {
    const ada = await connectClient();
    const grace = await connectClient();
    const linus = await connectClient();

    await joinSpace(ada, 'Ada', 'chat', 'general');
    const adaSawChatPresence = once<SpaceState>(ada, 'space:state');
    await joinSpace(grace, 'Grace', 'chat', 'general');
    await joinSpace(linus, 'Linus', 'chess', 'general');

    expect((await adaSawChatPresence).participants.map((participant) => participant.name)).toEqual([
      'Ada',
      'Grace'
    ]);

    const chessState = await joinSpace(linus, 'Linus', 'chess', 'general');
    expect(chessState.appId).toBe('chess');
    expect(chessState.participants.map((participant) => participant.name)).toEqual(['Linus']);
  });

  it('routes chat messages, typing, and persistence through app events', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'chat', 'design');
    await joinSpace(grace, 'Grace', 'chat', 'design');

    const typingForGrace = onceAppEvent<TypingUpdatePayload>(grace, 'chat:typing:update');
    ada.emit('app:event', { appId: 'chat', type: 'chat:typing:start' });
    expect((await typingForGrace).participants.map((participant) => participant.name)).toEqual(['Ada']);

    const messageForGrace = onceAppEvent<ChatMessage>(grace, 'chat:message:new');
    ada.emit('app:event', {
      appId: 'chat',
      type: 'chat:message:send',
      payload: { body: '  hello platform  ' }
    });

    expect(await messageForGrace).toMatchObject({
      spaceId: 'design',
      participantName: 'Ada',
      body: 'hello platform'
    });
    expect(server.messageStore.listRecentMessages('design')).toHaveLength(1);
  });

  it('loads persisted chat messages after a server restart', async () => {
    const ada = await connectClient();
    await joinSpace(ada, 'Ada', 'chat', 'design');

    const sentMessage = onceAppEvent<ChatMessage>(ada, 'chat:message:new');
    ada.emit('app:event', {
      appId: 'chat',
      type: 'chat:message:send',
      payload: { body: 'still here after restart' }
    });
    expect(await sentMessage).toMatchObject({ body: 'still here after restart' });

    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();

    database = openCitadelDatabase(dbPath);
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      messageRateLimit: {
        maxMessages: 5,
        windowMs: 80
      }
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;

    const grace = await connectClient();
    const state = await joinSpace(grace, 'Grace', 'chat', 'design');

    expect((state.appState as { messages: ChatMessage[] }).messages[0]).toMatchObject({
      spaceId: 'design',
      participantName: 'Ada',
      body: 'still here after restart'
    });
  });

  it('rejects rapid chat messages without saving or broadcasting them', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'chat', 'general');
    await joinSpace(grace, 'Grace', 'chat', 'general');

    for (let index = 1; index <= 5; index += 1) {
      const messageForAda = onceAppEvent<ChatMessage>(ada, 'chat:message:new');
      ada.emit('app:event', {
        appId: 'chat',
        type: 'chat:message:send',
        payload: { body: `message ${index}` }
      });
      expect(await messageForAda).toMatchObject({ body: `message ${index}` });
    }

    let graceReceivedRejectedMessage = false;
    grace.on('app:event', (event: AppEventEnvelope<ChatMessage>) => {
      if (event.type === 'chat:message:new' && event.payload?.body === 'message 6') {
        graceReceivedRejectedMessage = true;
      }
    });

    const errorForAda = onceAppEvent<PlatformErrorPayload>(ada, 'chat:notice');
    ada.emit('app:event', {
      appId: 'chat',
      type: 'chat:message:send',
      payload: { body: 'message 6' }
    });

    expect(await errorForAda).toEqual({ message: 'Slow down before sending another message.' });
    await wait(40);
    expect(graceReceivedRejectedMessage).toBe(false);
    expect(server.messageStore.listRecentMessages('general')).toHaveLength(5);
  });

  it('assigns chess players and validates moves authoritatively', async () => {
    const ada = await connectClient();
    const grace = await connectClient();
    const linus = await connectClient();

    const adaState = await joinSpace(ada, 'Ada', 'chess', 'board');
    await joinSpace(grace, 'Grace', 'chess', 'board');
    await joinSpace(linus, 'Linus', 'chess', 'board');

    expect((adaState.appState as ChessState).players.white).toBe('guest-ada');

    const spectatorNotice = onceAppEvent<PlatformErrorPayload>(linus, 'chess:notice');
    linus.emit('app:event', {
      appId: 'chess',
      type: 'chess:move',
      payload: { from: 'e2', to: 'e4' }
    });
    expect(await spectatorNotice).toEqual({ message: 'Spectators cannot move pieces.' });

    const chessUpdate = onceAppEvent<ChessState>(grace, 'chess:state');
    ada.emit('app:event', {
      appId: 'chess',
      type: 'chess:move',
      payload: { from: 'e2', to: 'e4' }
    });
    expect((await chessUpdate).fen).toContain(' b ');

    const turnNotice = onceAppEvent<PlatformErrorPayload>(ada, 'chess:notice');
    ada.emit('app:event', {
      appId: 'chess',
      type: 'chess:move',
      payload: { from: 'd2', to: 'd4' }
    });
    expect(await turnNotice).toEqual({ message: 'Wait for your turn.' });
  });

  it('preserves chess player roles and moves across reconnects and restarts', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'chess', 'board', 'stable-ada');
    await joinSpace(grace, 'Grace', 'chess', 'board', 'stable-grace');

    const chessUpdate = onceAppEvent<ChessState>(grace, 'chess:state');
    ada.emit('app:event', {
      appId: 'chess',
      type: 'chess:move',
      payload: { from: 'e2', to: 'e4' }
    });
    expect((await chessUpdate).fen).toContain(' b ');

    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();

    database = openCitadelDatabase(dbPath);
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      messageRateLimit: {
        maxMessages: 5,
        windowMs: 80
      }
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;

    const reconnectedAda = await connectClient();
    const state = await joinSpace(reconnectedAda, 'Ada', 'chess', 'board', 'stable-ada');
    const chessState = state.appState as ChessState;

    expect(chessState.players.white).toBe('stable-ada');
    expect(chessState.players.black).toBe('stable-grace');
    expect(chessState.fen).toContain(' b ');
  });

  it('creates snake state, accepts directions, and removes snakes on disconnect', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    const initialState = await joinSpace(ada, 'Ada', 'snake', 'arena');
    expect((initialState.appState as SnakeState).snakes).toHaveLength(1);

    await joinSpace(grace, 'Grace', 'snake', 'arena');
    const snakeUpdate = onceAppEvent<SnakeState>(ada, 'snake:state');
    grace.emit('app:event', {
      appId: 'snake',
      type: 'snake:direction',
      payload: { direction: 'down' }
    });
    expect((await snakeUpdate).snakes).toHaveLength(2);

    grace.close();
    await wait(40);
    const state = server.apps.get('snake');
    expect(state).toBeDefined();
  });

  it('keeps snake state ephemeral across server restarts', async () => {
    const ada = await connectClient();
    const initialState = await joinSpace(ada, 'Ada', 'snake', 'arena');
    expect((initialState.appState as SnakeState).snakes).toHaveLength(1);

    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();

    database = openCitadelDatabase(dbPath);
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      messageRateLimit: {
        maxMessages: 5,
        windowMs: 80
      }
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;

    const reconnectedAda = await connectClient();
    const state = await joinSpace(reconnectedAda, 'Ada', 'snake', 'arena');
    expect((state.appState as SnakeState).tick).toBe(0);
    expect((state.appState as SnakeState).snakes).toHaveLength(1);
  });
});
