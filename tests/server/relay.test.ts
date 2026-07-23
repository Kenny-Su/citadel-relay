import { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RelayClientAuthenticator } from '../../src/relay/auth.js';
import { createRelayServer } from '../../src/relay/server.js';
import type {
  AppClientStateMessage,
  AppConnectMessage,
  AppDisconnectMessage,
  AppServerReadyMessage,
  RelayClientPacketMessage,
  RelayErrorMessage,
  RelayOutboundMessage,
  RelayServerPacketMessage,
  VerifiedClientIdentity
} from '../../src/relay/app.js';

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForMessage<T extends RelayOutboundMessage>(socket: WebSocket, type?: T['type']) {
  return new Promise<T>((resolve) => {
    function handleMessage(data: WebSocket.RawData) {
      const message = JSON.parse(data.toString()) as RelayOutboundMessage;
      if (type && message.type !== type) return;
      socket.off('message', handleMessage);
      resolve(message as T);
    }
    socket.on('message', handleMessage);
  });
}

function expectNoMessage<T extends RelayOutboundMessage>(
  socket: WebSocket,
  type: T['type'],
  timeoutMs = 50
) {
  return Promise.race([
    waitForMessage<T>(socket, type),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

function sendJson(socket: WebSocket, message: unknown) {
  socket.send(JSON.stringify(message));
}

function listen(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      server.off('error', handleError);
    }
    function handleError(error: Error) {
      cleanup();
      reject(error);
    }
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      cleanup();
      resolve();
    });
  });
}

type HealthResponse = {
  ok: boolean;
  version: string;
  connections: number;
  clients: number;
  pendingClients: number;
  connectedApps: number;
};

describe('citadel app relay', () => {
  let server: ReturnType<typeof createRelayServer>;
  let url: string;
  let authenticateClient: RelayClientAuthenticator;
  const sockets: WebSocket[] = [];
  const clientIdentity: VerifiedClientIdentity = {
    subject: 'client-42'
  };

  beforeEach(async () => {
    authenticateClient = (token) => token === 'valid-client-jwt' ? clientIdentity : null;
    server = createRelayServer({
      authenticateAppServer(token) {
        if (token === 'chat-server-key') {
          return { appId: 'chat' };
        }
        if (token === 'files-server-key') {
          return { appId: 'files' };
        }
        return null;
      },
      authenticateClient(token) {
        return authenticateClient(token);
      },
      admissionTimeoutMs: 1_000
    });
    await listen(server.httpServer);
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.close());
    sockets.length = 0;
    await new Promise<void>((resolve) => server.wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });

  async function connectSocket() {
    const socket = new WebSocket(`${url.replace('http:', 'ws:')}/ws`);
    sockets.push(socket);
    await waitForOpen(socket);
    return socket;
  }

  async function connectAppServer(token = 'chat-server-key') {
    const socket = await connectSocket();
    const ready = waitForMessage<AppServerReadyMessage>(socket, 'app:ready');
    sendJson(socket, { type: 'app:authenticate', token });
    await ready;
    return socket;
  }

  async function openPending(
    client: WebSocket,
    appServer: WebSocket,
    appId = 'chat',
    hello: unknown = { resumeToken: null },
    credential: { type: 'jwt'; token: string } | null = {
      type: 'jwt',
      token: 'valid-client-jwt'
    }
  ) {
    const pendingState = waitForMessage<AppClientStateMessage>(client, 'app:state');
    const connect = waitForMessage<AppConnectMessage>(appServer, 'app:connect');
    sendJson(client, {
      type: 'app:open',
      appId,
      ...(credential !== null ? { credential } : {}),
      hello
    });
    const [state, request] = await Promise.all([pendingState, connect]);
    expect(state).toMatchObject({ type: 'app:state', state: 'pending' });
    expect(request).toMatchObject({
      type: 'app:connect',
      connectionId: state.connectionId,
      hello
    });
    return request;
  }

  async function acceptPending(client: WebSocket, appServer: WebSocket, requestId: string) {
    const admitted = waitForMessage<AppClientStateMessage>(client, 'app:state');
    sendJson(appServer, { type: 'app:accept', requestId });
    const state = await admitted;
    expect(state.state).toBe('admitted');
    return state;
  }

  async function openAndAccept(client: WebSocket, appServer: WebSocket, appId = 'chat') {
    const request = await openPending(client, appServer, appId);
    return acceptPending(client, appServer, request.requestId);
  }

  it('reports app-router health', async () => {
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    expect(health).toEqual({
      ok: true,
      version: '0.8.0',
      connections: 0,
      clients: 0,
      pendingClients: 0,
      connectedApps: 0
    });
  });

  it('requires a client authenticator at server construction', () => {
    expect(() => createRelayServer({
      authenticateAppServer: () => null
    } as unknown as Parameters<typeof createRelayServer>[0])).toThrow(
      'requires an authenticateClient function'
    );
    expect(() => createRelayServer({
      authenticateAppServer: () => null,
      authenticateClient: () => null,
      authenticationTimeoutMs: 0
    })).toThrow('authenticationTimeoutMs must be a positive number');
  });

  it('registers exactly one configured app when its server authenticates', async () => {
    const invalidAppServer = await connectSocket();
    const invalid = waitForMessage<RelayErrorMessage>(invalidAppServer, 'error:notice');
    sendJson(invalidAppServer, { type: 'app:authenticate', token: 'wrong-key' });
    expect((await invalid).message).toBe('Authentication failed.');

    const appServer = await connectSocket();
    const ready = waitForMessage<AppServerReadyMessage>(appServer, 'app:ready');
    sendJson(appServer, { type: 'app:authenticate', token: 'chat-server-key' });
    expect(await ready).toEqual({ type: 'app:ready', appId: 'chat' });

    const secondAppServer = await connectSocket();
    const duplicate = waitForMessage<RelayErrorMessage>(secondAppServer, 'error:notice');
    sendJson(secondAppServer, { type: 'app:authenticate', token: 'chat-server-key' });
    expect((await duplicate).message).toBe('App already has a connected server.');
  });

  it('opens an identified pending tunnel for an app-owned handshake', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    const request = await openPending(browser, appServer, 'chat', { mode: 'member' });
    expect(request.identity).toEqual(clientIdentity);

    const credentials = waitForMessage<RelayClientPacketMessage<{ token: string }>>(appServer, 'client:packet');
    sendJson(browser, { type: 'client:packet', payload: { token: 'app-owned-token' } });
    const credentialsMessage = await credentials;
    expect(credentialsMessage).toMatchObject({
      type: 'client:packet',
      from: {
        connectionId: request.connectionId,
        state: 'pending',
        identity: clientIdentity
      },
      payload: { token: 'app-owned-token' }
    });

    const challenge = waitForMessage<RelayServerPacketMessage<{ challenge: string }>>(browser, 'server:packet');
    sendJson(appServer, {
      type: 'server:packet',
      target: { connectionId: request.connectionId },
      payload: { challenge: 'prove-session' }
    });
    expect(await challenge).toMatchObject({
      type: 'server:packet',
      payload: { challenge: 'prove-session' }
    });

    await acceptPending(browser, appServer, request.requestId);
  });

  it('binds verified JWT identity to a pending client without performing admission', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    const request = await openPending(
      browser,
      appServer,
      'chat',
      {
        identity: {
          issuer: 'https://forged.example.com/',
          subject: 'attacker'
        }
      },
      { type: 'jwt', token: 'valid-client-jwt' }
    );

    expect(request.identity).toEqual(clientIdentity);
    const noAutomaticAdmission = await expectNoMessage<AppClientStateMessage>(
      browser,
      'app:state'
    );
    expect(noAutomaticAdmission).toBeNull();

    const packet = waitForMessage<RelayClientPacketMessage<{
      identity: { subject: string };
    }>>(appServer, 'client:packet');
    sendJson(browser, {
      type: 'client:packet',
      payload: { identity: { subject: 'attacker' } }
    });
    expect(await packet).toMatchObject({
      from: {
        connectionId: request.connectionId,
        state: 'pending',
        identity: clientIdentity
      },
      payload: { identity: { subject: 'attacker' } }
    });

    await acceptPending(browser, appServer, request.requestId);
    const downstream = waitForMessage<RelayServerPacketMessage<{ body: string }>>(
      browser,
      'server:packet'
    );
    sendJson(appServer, {
      type: 'server:packet',
      target: { connectionId: request.connectionId },
      payload: { body: 'welcome' }
    });
    expect(await downstream).toEqual({
      type: 'server:packet',
      payload: { body: 'welcome' }
    });

    const disconnected = waitForMessage<AppDisconnectMessage>(appServer, 'app:disconnect');
    sendJson(browser, { type: 'app:close' });
    expect(await disconnected).toMatchObject({
      connectionId: request.connectionId,
      admitted: true,
      identity: clientIdentity
    });
  });

  it('rejects an invalid supplied client credential before notifying the app server', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    const appServerConnect = expectNoMessage<AppConnectMessage>(appServer, 'app:connect');
    const failed = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });

    sendJson(browser, {
      type: 'app:open',
      appId: 'chat',
      credential: { type: 'jwt', token: 'invalid-client-jwt' }
    });

    expect((await failed).message).toBe('Client authentication failed.');
    expect(await closed).toBe(4401);
    expect(await appServerConnect).toBeNull();
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    expect(health.clients).toBe(0);
  });

  it('rejects a client without a JWT before notifying the app server', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    const appServerConnect = expectNoMessage<AppConnectMessage>(appServer, 'app:connect');
    const failed = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });

    sendJson(browser, {
      type: 'app:open',
      appId: 'chat'
    });

    expect((await failed).message).toBe('Client authentication failed.');
    expect(await closed).toBe(4401);
    expect(await appServerConnect).toBeNull();
  });

  it('verifies identity before revealing app availability', async () => {
    const browser = await connectSocket();
    const failed = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });

    sendJson(browser, {
      type: 'app:open',
      appId: 'missing',
      credential: { type: 'jwt', token: 'invalid-client-jwt' }
    });

    expect((await failed).message).toBe('Client authentication failed.');
    expect(await closed).toBe(4401);
  });

  it('closes malformed traffic from an unauthenticated connection', async () => {
    const socket = await connectSocket();
    const failed = waitForMessage<RelayErrorMessage>(socket, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code));
    });

    socket.send('not-json');

    expect((await failed).message).toBe('Authentication is required.');
    expect(await closed).toBe(4401);
  });

  it('closes a connection that does not authenticate before the setup deadline', async () => {
    const timeoutServer = createRelayServer({
      authenticateAppServer: () => null,
      authenticateClient: () => null,
      authenticationTimeoutMs: 20
    });
    await listen(timeoutServer.httpServer);
    const address = timeoutServer.httpServer.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);

    try {
      await waitForOpen(socket);
      const failed = waitForMessage<RelayErrorMessage>(socket, 'error:notice');
      const closed = new Promise<number>((resolve) => {
        socket.once('close', (code) => resolve(code));
      });

      expect((await failed).message).toBe('Authentication timed out.');
      expect(await closed).toBe(4401);
    } finally {
      socket.close();
      await new Promise<void>((resolve) => timeoutServer.wss.close(() => resolve()));
      await new Promise<void>((resolve) => timeoutServer.httpServer.close(() => resolve()));
    }
  });

  it('closes oversized WebSocket messages before parsing them', async () => {
    const socket = await connectSocket();
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code));
    });

    socket.send(Buffer.alloc(65_537, 0x61));

    expect(await closed).toBe(1009);
  });

  it('closes a connection that sends more traffic while authentication is pending', async () => {
    let completeAuthentication: ((identity: VerifiedClientIdentity) => void) | undefined;
    authenticateClient = () => new Promise((resolve) => {
      completeAuthentication = resolve;
    });
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    const appServerConnect = expectNoMessage<AppConnectMessage>(appServer, 'app:connect');

    sendJson(browser, {
      type: 'app:open',
      appId: 'chat',
      credential: { type: 'jwt', token: 'delayed-client-jwt' }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const duplicate = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });
    sendJson(browser, { type: 'app:open', appId: 'chat' });
    expect((await duplicate).message).toBe('Authentication is already in progress.');
    expect(await closed).toBe(4401);

    completeAuthentication?.(clientIdentity);
    expect(await appServerConnect).toBeNull();
  });

  it('lets the app server reject admission after relay-verified client identity', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    const request = await openPending(browser, appServer);
    const rejected = waitForMessage<AppClientStateMessage>(browser, 'app:state');

    sendJson(appServer, {
      type: 'app:reject',
      requestId: request.requestId,
      message: 'Chat ACL denied this client.'
    });
    expect(await rejected).toMatchObject({
      state: 'rejected',
      message: 'Chat ACL denied this client.'
    });

    const cannotSend = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    sendJson(browser, { type: 'client:packet', payload: 'after rejection' });
    expect((await cannotSend).message).toBe('Only a connected app client can send client packets.');
  });

  it('routes client packets only upstream to the app server', async () => {
    const appServer = await connectAppServer();
    const ada = await connectSocket();
    const grace = await connectSocket();
    const adaState = await openAndAccept(ada, appServer);
    await openAndAccept(grace, appServer);

    const forAppServer = waitForMessage<RelayClientPacketMessage<{ body: string }>>(appServer, 'client:packet');
    const forGrace = expectNoMessage<RelayServerPacketMessage>(grace, 'server:packet');
    sendJson(ada, { type: 'client:packet', payload: { body: 'hello' } });

    expect(await forAppServer).toMatchObject({
      from: { connectionId: adaState.connectionId, state: 'admitted' },
      payload: { body: 'hello' }
    });
    expect(await forGrace).toBeNull();

    const forbiddenBroadcast = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'server:packet',
      target: 'all',
      payload: 'forged broadcast'
    });
    expect((await forbiddenBroadcast).message).toBe('Only an authenticated app server can send server packets.');

    const forbiddenTarget = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'client:packet',
      target: { connectionId: 'another-client' },
      payload: 'forged target'
    });
    expect((await forbiddenTarget).message).toBe('Client packets cannot specify a target.');
  });

  it('allows only the app server to unicast or broadcast downstream', async () => {
    const appServer = await connectAppServer();
    const ada = await connectSocket();
    const grace = await connectSocket();
    const pending = await connectSocket();
    const adaState = await openAndAccept(ada, appServer);
    await openAndAccept(grace, appServer);
    const pendingRequest = await openPending(pending, appServer);

    const adaBroadcast = waitForMessage<RelayServerPacketMessage>(ada, 'server:packet');
    const graceBroadcast = waitForMessage<RelayServerPacketMessage>(grace, 'server:packet');
    const pendingBroadcast = expectNoMessage<RelayServerPacketMessage>(pending, 'server:packet');
    sendJson(appServer, {
      type: 'server:packet',
      target: 'all',
      payload: 'admitted clients only'
    });
    expect((await adaBroadcast).payload).toBe('admitted clients only');
    expect((await graceBroadcast).payload).toBe('admitted clients only');
    expect(await pendingBroadcast).toBeNull();

    const adaUnicast = waitForMessage<RelayServerPacketMessage>(ada, 'server:packet');
    const graceUnicast = expectNoMessage<RelayServerPacketMessage>(grace, 'server:packet');
    sendJson(appServer, {
      type: 'server:packet',
      target: { connectionId: adaState.connectionId },
      payload: 'only Ada'
    });
    expect((await adaUnicast).payload).toBe('only Ada');
    expect(await graceUnicast).toBeNull();

    const pendingHandshake = waitForMessage<RelayServerPacketMessage>(pending, 'server:packet');
    sendJson(appServer, {
      type: 'server:packet',
      target: { connectionId: pendingRequest.connectionId },
      payload: 'pending handshake only'
    });
    expect((await pendingHandshake).payload).toBe('pending handshake only');
  });

  it('prevents an app server from targeting another app server client', async () => {
    const chatAppServer = await connectAppServer();
    const filesAppServer = await connectAppServer('files-server-key');
    const filesClient = await connectSocket();
    const filesState = await openAndAccept(filesClient, filesAppServer, 'files');

    const wrongClient = waitForMessage<RelayErrorMessage>(chatAppServer, 'error:notice');
    sendJson(chatAppServer, {
      type: 'server:packet',
      target: { connectionId: filesState.connectionId },
      payload: 'cross-boundary'
    });
    expect((await wrongClient).message).toBe('Packet target is not a client of this app server.');
  });

  it('lets the app server revoke a client and observes explicit client closure', async () => {
    const appServer = await connectAppServer();
    const ada = await connectSocket();
    const grace = await connectSocket();
    const adaState = await openAndAccept(ada, appServer);
    const graceState = await openAndAccept(grace, appServer);

    const revoked = waitForMessage<AppClientStateMessage>(ada, 'app:state');
    sendJson(appServer, {
      type: 'app:revoke',
      connectionId: adaState.connectionId,
      message: 'Session expired.'
    });
    expect(await revoked).toMatchObject({ state: 'rejected', message: 'Session expired.' });

    const disconnected = waitForMessage<AppDisconnectMessage>(appServer, 'app:disconnect');
    sendJson(grace, { type: 'app:close' });
    expect(await disconnected).toMatchObject({
      connectionId: graceState.connectionId,
      admitted: true,
      reason: 'client-closed'
    });
  });

  it('closes all clients when their app server disconnects', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    await openAndAccept(browser, appServer);

    const closed = waitForMessage<AppClientStateMessage>(browser, 'app:state');
    appServer.close();
    expect(await closed).toMatchObject({
      state: 'closed',
      message: 'The app server is unavailable.'
    });

    const cannotSend = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    sendJson(browser, { type: 'client:packet', payload: 'after app server disconnect' });
    expect((await cannotSend).message).toBe('Only a connected app client can send client packets.');
  });

  it('updates health for connected apps and admitted clients', async () => {
    const appServer = await connectAppServer();
    const browser = await connectSocket();
    await openAndAccept(browser, appServer);

    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    expect(health).toEqual({
      ok: true,
      version: '0.8.0',
      connections: 2,
      clients: 1,
      pendingClients: 0,
      connectedApps: 1
    });
  });

  it('reports malformed and unknown protocol input', async () => {
    const appServer = await connectAppServer();
    const malformed = waitForMessage<RelayErrorMessage>(appServer, 'error:notice');
    appServer.send('not-json');
    expect((await malformed).message).toBe('Messages must be valid JSON.');

    const unknown = waitForMessage<RelayErrorMessage>(appServer, 'error:notice');
    sendJson(appServer, { type: 'made:up' });
    expect((await unknown).message).toBe('Unknown message type.');

    const client = await connectSocket();
    const deepApp = waitForMessage<RelayErrorMessage>(client, 'error:notice');
    sendJson(client, {
      type: 'app:open',
      appId: 'chat/private',
      credential: { type: 'jwt', token: 'valid-client-jwt' }
    });
    expect((await deepApp).message).toBe('App ID must be a lowercase identifier such as "chat".');
  });
});
