import { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RelayClientAuthenticator } from '../../src/relay/auth.js';
import { createRelayServer } from '../../src/relay/server.js';
import type {
  AuthenticationStateMessage,
  NamespaceClaimedMessage,
  NamespaceClientStateMessage,
  NamespaceConnectMessage,
  NamespaceDisconnectMessage,
  RelayClientPacketMessage,
  RelayErrorMessage,
  RelayServerPacketMessage,
  ServerMessage,
  VerifiedClientIdentity
} from '../../src/relay/app.js';

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForMessage<T extends ServerMessage>(socket: WebSocket, type?: T['type']) {
  return new Promise<T>((resolve) => {
    function handleMessage(data: WebSocket.RawData) {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (type && message.type !== type) return;
      socket.off('message', handleMessage);
      resolve(message as T);
    }
    socket.on('message', handleMessage);
  });
}

function expectNoMessage<T extends ServerMessage>(socket: WebSocket, type: T['type'], timeoutMs = 50) {
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
  claimedNamespaces: number;
};

describe('citadel namespace relay', () => {
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
      authenticateOwner(token) {
        if (token === 'chat-owner-key') {
          return { id: 'chat-server', name: 'chat-server', namespaceClaims: ['/chat'] };
        }
        if (token === 'files-owner-key') {
          return { id: 'files-server', name: 'files-server', namespaceClaims: ['/files'] };
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

  async function connectOwner(token: string) {
    const socket = await connectSocket();
    const authenticated = waitForMessage<AuthenticationStateMessage>(socket, 'auth:state');
    sendJson(socket, { type: 'auth:authenticate', token });
    await authenticated;
    return socket;
  }

  async function claimOwner(token = 'chat-owner-key', namespace = '/chat') {
    const owner = await connectOwner(token);
    const claimed = waitForMessage<NamespaceClaimedMessage>(owner, 'namespace:claimed');
    sendJson(owner, { type: 'namespace:claim', namespace });
    expect(await claimed).toEqual({ type: 'namespace:claimed', namespace });
    return owner;
  }

  async function openPending(
    client: WebSocket,
    owner: WebSocket,
    namespace = '/chat',
    hello: unknown = { resumeToken: null },
    credential: { type: 'jwt'; token: string } | null = {
      type: 'jwt',
      token: 'valid-client-jwt'
    }
  ) {
    const pendingState = waitForMessage<NamespaceClientStateMessage>(client, 'namespace:state');
    const connect = waitForMessage<NamespaceConnectMessage>(owner, 'namespace:connect');
    sendJson(client, {
      type: 'namespace:open',
      namespace,
      ...(credential !== null ? { credential } : {}),
      hello
    });
    const [state, request] = await Promise.all([pendingState, connect]);
    expect(state).toMatchObject({ type: 'namespace:state', namespace, state: 'pending' });
    expect(request).toMatchObject({
      type: 'namespace:connect',
      namespace,
      connectionId: state.connectionId,
      hello
    });
    return request;
  }

  async function acceptPending(client: WebSocket, owner: WebSocket, requestId: string) {
    const admitted = waitForMessage<NamespaceClientStateMessage>(client, 'namespace:state');
    sendJson(owner, { type: 'namespace:accept', requestId });
    const state = await admitted;
    expect(state.state).toBe('admitted');
    return state;
  }

  async function openAndAccept(client: WebSocket, owner: WebSocket, namespace = '/chat') {
    const request = await openPending(client, owner, namespace);
    return acceptPending(client, owner, request.requestId);
  }

  it('reports first-level router health', async () => {
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    expect(health).toEqual({
      ok: true,
      version: '0.7.0',
      connections: 0,
      clients: 0,
      pendingClients: 0,
      claimedNamespaces: 0
    });
  });

  it('requires a client authenticator at server construction', () => {
    expect(() => createRelayServer({
      authenticateOwner: () => null
    } as unknown as Parameters<typeof createRelayServer>[0])).toThrow(
      'requires an authenticateClient function'
    );
    expect(() => createRelayServer({
      authenticateOwner: () => null,
      authenticateClient: () => null,
      authenticationTimeoutMs: 0
    })).toThrow('authenticationTimeoutMs must be a positive number');
  });

  it('allows only an authorized app owner to claim an exclusive namespace', async () => {
    const browser = await connectSocket();
    const unauthenticated = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const unauthenticatedClosed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });
    sendJson(browser, { type: 'namespace:claim', namespace: '/chat' });
    expect((await unauthenticated).message).toBe('Authentication is required.');
    expect(await unauthenticatedClosed).toBe(4401);

    const invalidOwner = await connectSocket();
    const invalid = waitForMessage<RelayErrorMessage>(invalidOwner, 'error:notice');
    sendJson(invalidOwner, { type: 'auth:authenticate', token: 'wrong-key' });
    expect((await invalid).message).toBe('Authentication failed.');

    const owner = await claimOwner();
    const unauthorizedPath = waitForMessage<RelayErrorMessage>(owner, 'error:notice');
    sendJson(owner, { type: 'namespace:claim', namespace: '/files' });
    expect((await unauthorizedPath).message).toBe('This app owner is not authorized for that namespace.');

    const secondOwner = await connectOwner('chat-owner-key');
    const duplicate = waitForMessage<RelayErrorMessage>(secondOwner, 'error:notice');
    sendJson(secondOwner, { type: 'namespace:claim', namespace: '/chat' });
    expect((await duplicate).message).toBe('Namespace is already claimed.');
  });

  it('opens an identified pending tunnel for an app-owned handshake', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    const request = await openPending(browser, owner, '/chat', { mode: 'member' });
    expect(request.identity).toEqual(clientIdentity);

    const credentials = waitForMessage<RelayClientPacketMessage<{ token: string }>>(owner, 'client:packet');
    sendJson(browser, { type: 'client:packet', payload: { token: 'app-owned-token' } });
    const credentialsMessage = await credentials;
    expect(credentialsMessage).toMatchObject({
      type: 'client:packet',
      namespace: '/chat',
      from: {
        connectionId: request.connectionId,
        state: 'pending',
        identity: clientIdentity
      },
      payload: { token: 'app-owned-token' }
    });

    const challenge = waitForMessage<RelayServerPacketMessage<{ challenge: string }>>(browser, 'server:packet');
    sendJson(owner, {
      type: 'server:packet',
      namespace: '/chat',
      target: { connectionId: request.connectionId },
      payload: { challenge: 'prove-session' }
    });
    expect(await challenge).toMatchObject({
      type: 'server:packet',
      namespace: '/chat',
      payload: { challenge: 'prove-session' }
    });

    await acceptPending(browser, owner, request.requestId);
  });

  it('binds verified JWT identity to a pending client without performing admission', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    const request = await openPending(
      browser,
      owner,
      '/chat',
      {
        identity: {
          issuer: 'https://forged.example.com/',
          subject: 'attacker'
        }
      },
      { type: 'jwt', token: 'valid-client-jwt' }
    );

    expect(request.identity).toEqual(clientIdentity);
    const noAutomaticAdmission = await expectNoMessage<NamespaceClientStateMessage>(
      browser,
      'namespace:state'
    );
    expect(noAutomaticAdmission).toBeNull();

    const packet = waitForMessage<RelayClientPacketMessage<{
      identity: { subject: string };
    }>>(owner, 'client:packet');
    sendJson(browser, {
      type: 'client:packet',
      payload: { identity: { subject: 'attacker' } }
    });
    expect(await packet).toMatchObject({
      namespace: '/chat',
      from: {
        connectionId: request.connectionId,
        state: 'pending',
        identity: clientIdentity
      },
      payload: { identity: { subject: 'attacker' } }
    });

    await acceptPending(browser, owner, request.requestId);
    const downstream = waitForMessage<RelayServerPacketMessage<{ body: string }>>(
      browser,
      'server:packet'
    );
    sendJson(owner, {
      type: 'server:packet',
      namespace: '/chat',
      target: { connectionId: request.connectionId },
      payload: { body: 'welcome' }
    });
    expect(await downstream).toEqual({
      type: 'server:packet',
      namespace: '/chat',
      payload: { body: 'welcome' }
    });

    const disconnected = waitForMessage<NamespaceDisconnectMessage>(owner, 'namespace:disconnect');
    sendJson(browser, { type: 'namespace:close' });
    expect(await disconnected).toMatchObject({
      connectionId: request.connectionId,
      admitted: true,
      identity: clientIdentity
    });
  });

  it('rejects an invalid supplied client credential before notifying the owner', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    const ownerConnect = expectNoMessage<NamespaceConnectMessage>(owner, 'namespace:connect');
    const failed = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });

    sendJson(browser, {
      type: 'namespace:open',
      namespace: '/chat',
      credential: { type: 'jwt', token: 'invalid-client-jwt' }
    });

    expect((await failed).message).toBe('Client authentication failed.');
    expect(await closed).toBe(4401);
    expect(await ownerConnect).toBeNull();
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    expect(health.clients).toBe(0);
  });

  it('rejects a client without a JWT before notifying the owner', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    const ownerConnect = expectNoMessage<NamespaceConnectMessage>(owner, 'namespace:connect');
    const failed = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });

    sendJson(browser, {
      type: 'namespace:open',
      namespace: '/chat'
    });

    expect((await failed).message).toBe('Client authentication failed.');
    expect(await closed).toBe(4401);
    expect(await ownerConnect).toBeNull();
  });

  it('verifies identity before revealing namespace availability', async () => {
    const browser = await connectSocket();
    const failed = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });

    sendJson(browser, {
      type: 'namespace:open',
      namespace: '/missing',
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
      authenticateOwner: () => null,
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
    const owner = await claimOwner();
    const browser = await connectSocket();
    const ownerConnect = expectNoMessage<NamespaceConnectMessage>(owner, 'namespace:connect');

    sendJson(browser, {
      type: 'namespace:open',
      namespace: '/chat',
      credential: { type: 'jwt', token: 'delayed-client-jwt' }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const duplicate = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    const closed = new Promise<number>((resolve) => {
      browser.once('close', (code) => resolve(code));
    });
    sendJson(browser, { type: 'namespace:open', namespace: '/chat' });
    expect((await duplicate).message).toBe('Authentication is already in progress.');
    expect(await closed).toBe(4401);

    completeAuthentication?.(clientIdentity);
    expect(await ownerConnect).toBeNull();
  });

  it('lets the owner reject admission after relay-verified client identity', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    const request = await openPending(browser, owner);
    const rejected = waitForMessage<NamespaceClientStateMessage>(browser, 'namespace:state');

    sendJson(owner, {
      type: 'namespace:reject',
      requestId: request.requestId,
      message: 'Chat ACL denied this client.'
    });
    expect(await rejected).toMatchObject({
      namespace: '/chat',
      state: 'rejected',
      message: 'Chat ACL denied this client.'
    });

    const cannotSend = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    sendJson(browser, { type: 'client:packet', payload: 'after rejection' });
    expect((await cannotSend).message).toBe('Only an open namespace client can send client packets.');
  });

  it('routes client packets only upstream to the namespace owner', async () => {
    const owner = await claimOwner();
    const ada = await connectSocket();
    const grace = await connectSocket();
    const adaState = await openAndAccept(ada, owner);
    await openAndAccept(grace, owner);

    const forOwner = waitForMessage<RelayClientPacketMessage<{ body: string }>>(owner, 'client:packet');
    const forGrace = expectNoMessage<RelayServerPacketMessage>(grace, 'server:packet');
    sendJson(ada, { type: 'client:packet', payload: { body: 'hello' } });

    expect(await forOwner).toMatchObject({
      namespace: '/chat',
      from: { connectionId: adaState.connectionId, state: 'admitted' },
      payload: { body: 'hello' }
    });
    expect(await forGrace).toBeNull();

    const forbiddenBroadcast = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'server:packet',
      namespace: '/chat',
      target: 'all',
      payload: 'forged broadcast'
    });
    expect((await forbiddenBroadcast).message).toBe('Only an authenticated namespace owner can send server packets.');

    const forbiddenTarget = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'client:packet',
      target: { connectionId: 'another-client' },
      payload: 'forged target'
    });
    expect((await forbiddenTarget).message).toBe('Client packets cannot specify a namespace or target.');
  });

  it('allows only the owner to unicast or broadcast downstream', async () => {
    const owner = await claimOwner();
    const ada = await connectSocket();
    const grace = await connectSocket();
    const pending = await connectSocket();
    const adaState = await openAndAccept(ada, owner);
    await openAndAccept(grace, owner);
    const pendingRequest = await openPending(pending, owner);

    const adaBroadcast = waitForMessage<RelayServerPacketMessage>(ada, 'server:packet');
    const graceBroadcast = waitForMessage<RelayServerPacketMessage>(grace, 'server:packet');
    const pendingBroadcast = expectNoMessage<RelayServerPacketMessage>(pending, 'server:packet');
    sendJson(owner, {
      type: 'server:packet',
      namespace: '/chat',
      target: 'all',
      payload: 'admitted clients only'
    });
    expect((await adaBroadcast).payload).toBe('admitted clients only');
    expect((await graceBroadcast).payload).toBe('admitted clients only');
    expect(await pendingBroadcast).toBeNull();

    const adaUnicast = waitForMessage<RelayServerPacketMessage>(ada, 'server:packet');
    const graceUnicast = expectNoMessage<RelayServerPacketMessage>(grace, 'server:packet');
    sendJson(owner, {
      type: 'server:packet',
      namespace: '/chat',
      target: { connectionId: adaState.connectionId },
      payload: 'only Ada'
    });
    expect((await adaUnicast).payload).toBe('only Ada');
    expect(await graceUnicast).toBeNull();

    const pendingHandshake = waitForMessage<RelayServerPacketMessage>(pending, 'server:packet');
    sendJson(owner, {
      type: 'server:packet',
      namespace: '/chat',
      target: { connectionId: pendingRequest.connectionId },
      payload: 'pending handshake only'
    });
    expect((await pendingHandshake).payload).toBe('pending handshake only');
  });

  it('prevents an owner from targeting another owner namespace', async () => {
    const chatOwner = await claimOwner();
    const filesOwner = await claimOwner('files-owner-key', '/files');
    const filesClient = await connectSocket();
    const filesState = await openAndAccept(filesClient, filesOwner, '/files');

    const wrongNamespace = waitForMessage<RelayErrorMessage>(chatOwner, 'error:notice');
    sendJson(chatOwner, {
      type: 'server:packet',
      namespace: '/files',
      target: { connectionId: filesState.connectionId },
      payload: 'cross-boundary'
    });
    expect((await wrongNamespace).message).toBe('This connection does not own the packet namespace.');

    const wrongClient = waitForMessage<RelayErrorMessage>(chatOwner, 'error:notice');
    sendJson(chatOwner, {
      type: 'server:packet',
      namespace: '/chat',
      target: { connectionId: filesState.connectionId },
      payload: 'cross-boundary'
    });
    expect((await wrongClient).message).toBe('Packet target is not a client of this namespace owner.');
  });

  it('lets the owner revoke a client and observes explicit client closure', async () => {
    const owner = await claimOwner();
    const ada = await connectSocket();
    const grace = await connectSocket();
    const adaState = await openAndAccept(ada, owner);
    const graceState = await openAndAccept(grace, owner);

    const revoked = waitForMessage<NamespaceClientStateMessage>(ada, 'namespace:state');
    sendJson(owner, {
      type: 'namespace:revoke',
      connectionId: adaState.connectionId,
      message: 'Session expired.'
    });
    expect(await revoked).toMatchObject({ state: 'rejected', message: 'Session expired.' });

    const disconnected = waitForMessage<NamespaceDisconnectMessage>(owner, 'namespace:disconnect');
    sendJson(grace, { type: 'namespace:close' });
    expect(await disconnected).toMatchObject({
      namespace: '/chat',
      connectionId: graceState.connectionId,
      admitted: true,
      reason: 'client-closed'
    });
  });

  it('closes all clients when their namespace owner disconnects', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    await openAndAccept(browser, owner);

    const closed = waitForMessage<NamespaceClientStateMessage>(browser, 'namespace:state');
    owner.close();
    expect(await closed).toMatchObject({
      namespace: '/chat',
      state: 'closed',
      message: 'The namespace owner is unavailable.'
    });

    const cannotSend = waitForMessage<RelayErrorMessage>(browser, 'error:notice');
    sendJson(browser, { type: 'client:packet', payload: 'after owner disconnect' });
    expect((await cannotSend).message).toBe('Only an open namespace client can send client packets.');
  });

  it('updates health for claimed namespaces and admitted clients', async () => {
    const owner = await claimOwner();
    const browser = await connectSocket();
    await openAndAccept(browser, owner);

    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;
    expect(health).toEqual({
      ok: true,
      version: '0.7.0',
      connections: 2,
      clients: 1,
      pendingClients: 0,
      claimedNamespaces: 1
    });
  });

  it('reports malformed and unknown protocol input', async () => {
    const owner = await claimOwner();
    const malformed = waitForMessage<RelayErrorMessage>(owner, 'error:notice');
    owner.send('not-json');
    expect((await malformed).message).toBe('Messages must be valid JSON.');

    const unknown = waitForMessage<RelayErrorMessage>(owner, 'error:notice');
    sendJson(owner, { type: 'made:up' });
    expect((await unknown).message).toBe('Unknown message type.');

    const client = await connectSocket();
    const deepNamespace = waitForMessage<RelayErrorMessage>(client, 'error:notice');
    sendJson(client, {
      type: 'namespace:open',
      namespace: '/chat/private',
      credential: { type: 'jwt', token: 'valid-client-jwt' }
    });
    expect((await deepNamespace).message).toBe('Namespace must be a first-level lowercase path such as "/chat".');
  });
});
