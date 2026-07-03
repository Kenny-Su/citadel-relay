import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as Client, type Socket } from 'socket.io-client';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import { createCitadelServer } from '../../src/server/citadelServer.js';
import type { AppEventEnvelope, AppId, AppManifest, PlatformErrorPayload, SpaceState } from '@citadel/platform/app';

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
  let server: ReturnType<typeof createCitadelServer>;
  let tempDir: string;
  let dbPath: string;
  let database: CitadelDatabase;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-platform-socket-'));
    dbPath = join(tempDir, 'chat.sqlite');
    await startServer();
  });

  afterEach(async () => {
    await stopServer();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function startServer(options: { enabledAppIds?: AppId[] } = {}) {
    database = openCitadelDatabase(dbPath);
    server = createCitadelServer({
      clientOrigin: '*',
      database,
      enabledAppIds: options.enabledAppIds
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  }

  async function stopServer() {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    database.close();
  }

  async function restartServer(options: { enabledAppIds?: AppId[] } = {}) {
    await stopServer();
    await startServer(options);
  }

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
    await restartServer({ enabledAppIds: ['chat', 'snake'] });

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
    await restartServer({ enabledAppIds: ['chat'] });

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

  it('routes installed app events through the platform socket', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'chat', 'design');
    await joinSpace(grace, 'Grace', 'chat', 'design');

    const messageForGrace = onceAppEvent<{ body: string }>(grace, 'chat:message:new');
    ada.emit('app:event', {
      appId: 'chat',
      type: 'chat:message:send',
      payload: { body: '  hello platform  ' }
    });

    expect(await messageForGrace).toMatchObject({ body: 'hello platform' });
  });
});
