import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as Client, type Socket } from 'socket.io-client';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel-platform/platform/persistence';
import { createCitadelServer } from '../../src/server/citadelServer.js';
import { createPlatformServer } from '@citadel-platform/platform/server';
import type {
  AppEventEnvelope,
  AppId,
  AppManifest,
  Participant,
  PlatformErrorPayload,
  SpaceState
} from '@citadel-platform/platform/app';
import type { ServerAppModule } from '@citadel-platform/platform/server-app';

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

const fixtureApp: ServerAppModule = {
  appId: 'fixture',
  getInitialState(context) {
    return context.getAppState() ?? { messages: [] };
  },
  handleEvent(context, event) {
    if (event.type !== 'fixture:message') {
      return;
    }

    const state = context.getAppState<{ messages: string[] }>() ?? { messages: [] };
    const message = String(event.payload ?? '').trim();
    context.setAppState({ messages: [...state.messages, message] });
    context.emitToSpace('fixture:message:new', { body: message });
    context.emitSpaceState();
  }
};

const fixtureManifest: AppManifest = {
  appId: 'fixture',
  label: 'Fixture',
  defaultSpaceId: 'general',
  persistence: 'none',
  version: '0.1.0'
};

describe('host socket with empty app catalog', () => {
  let server: ReturnType<typeof createCitadelServer>;
  let tempDir: string;
  let database: CitadelDatabase;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-host-socket-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
    server = createCitadelServer({
      clientOrigin: '*',
      database
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

  it('exposes empty apps through health and config', async () => {
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    const config = await fetch(`${url}/config`).then((response) => response.json()) as PlatformMetadataResponse;

    expect(health).toMatchObject({
      ok: true,
      apps: [],
      appCount: 0,
      appManifests: [],
      version: '0.1.0'
    });
    expect(config).toEqual({
      apps: [],
      appManifests: []
    });
  });

  it('rejects joins when no apps are installed', async () => {
    const ada = await connectClient();
    const error = once<PlatformErrorPayload>(ada, 'error:notice');

    ada.emit('space:join', {
      appId: 'fixture',
      guestId: 'stable-ada',
      name: 'Ada',
      spaceId: 'general'
    });

    expect(await error).toEqual({ message: 'Unknown app.' });
  });
});

describe('platform socket with generic in-test apps', () => {
  let server: ReturnType<typeof createPlatformServer>;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    server = createPlatformServer({
      clientOrigin: '*',
      appManifests: [fixtureManifest],
      apps: [fixtureApp]
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

  it('joins participants and isolates presence by app and space', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'fixture', 'general');
    const adaSawPresence = once<SpaceState>(ada, 'space:state');
    await joinSpace(grace, 'Grace', 'fixture', 'general');

    expect((await adaSawPresence).participants.map((participant: Participant) => participant.name)).toEqual([
      'Ada',
      'Grace'
    ]);
  });

  it('routes generic installed app events through the platform socket', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'fixture', 'design');
    await joinSpace(grace, 'Grace', 'fixture', 'design');

    const messageForGrace = onceAppEvent<{ body: string }>(grace, 'fixture:message:new');
    ada.emit('app:event', {
      appId: 'fixture',
      type: 'fixture:message',
      payload: '  hello platform  '
    });

    expect(await messageForGrace).toEqual({ body: 'hello platform' });
  });
});
