import { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer } from '../../src/relay/server.js';
import type { RelayErrorMessage, RelayPacketMessage, ServerMessage, SpaceStateMessage } from '../../src/relay/app.js';

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

      if (type && message.type !== type) {
        return;
      }

      socket.off('message', handleMessage);
      resolve(message as T);
    }

    socket.on('message', handleMessage);
  });
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
  participants: number;
  activeSpaces: number;
};

describe('citadel relay websocket server', () => {
  let server: ReturnType<typeof createRelayServer>;
  let url: string;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    server = createRelayServer();
    await listen(server.httpServer);
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await new Promise<void>((resolve) => server.wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });

  async function connectClient() {
    const socket = new WebSocket(`${url.replace('http:', 'ws:')}/ws`);
    clients.push(socket);
    await waitForOpen(socket);
    return socket;
  }

  async function joinSpace(socket: WebSocket, name: string, spaceId = 'general', guestId = `guest-${name.toLowerCase()}`) {
    const state = waitForMessage<SpaceStateMessage>(socket, 'space:state');
    sendJson(socket, {
      type: 'space:join',
      guestId,
      name,
      spaceId
    });
    return state;
  }

  it('exposes relay health without app metadata', async () => {
    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;

    expect(health).toEqual({
      ok: true,
      version: '0.1.0',
      participants: 0,
      activeSpaces: 0
    });
  });

  it('joins participants and reports current space state', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'general', 'stable-ada');
    const adaSawGraceJoin = waitForMessage<SpaceStateMessage>(ada, 'space:state');
    const graceState = await joinSpace(grace, 'Grace', 'general', 'stable-grace');
    const adaState = await adaSawGraceJoin;

    expect(graceState.participants.map((participant) => participant.name)).toEqual(['Ada', 'Grace']);
    expect(adaState.participants.map((participant) => participant.name)).toEqual(['Ada', 'Grace']);
    expect(graceState.participants.find((participant) => participant.name === 'Ada')?.id).toBe('stable-ada');
  });

  it('broadcasts packets inside one space without crossing into other spaces', async () => {
    const ada = await connectClient();
    const grace = await connectClient();
    const linus = await connectClient();

    await joinSpace(ada, 'Ada', 'design');
    await joinSpace(grace, 'Grace', 'design');
    await joinSpace(linus, 'Linus', 'infra');

    const packetForGrace = waitForMessage<RelayPacketMessage<{ body: string }>>(grace, 'space:packet');
    const packetForLinus = Promise.race([
      waitForMessage<RelayPacketMessage>(linus, 'space:packet'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50))
    ]);

    sendJson(ada, {
      type: 'space:packet',
      topic: 'chat',
      payload: { body: 'hello relay' },
      target: 'others'
    });

    expect(await packetForGrace).toMatchObject({
      type: 'space:packet',
      spaceId: 'design',
      topic: 'chat',
      payload: { body: 'hello relay' },
      from: {
        name: 'Ada'
      }
    });
    expect(await packetForLinus).toBeNull();
  });

  it('supports space and others packet targets', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'general');
    await joinSpace(grace, 'Grace', 'general');

    const echoForAda = waitForMessage<RelayPacketMessage>(ada, 'space:packet');
    const echoForGrace = waitForMessage<RelayPacketMessage>(grace, 'space:packet');
    sendJson(ada, {
      type: 'space:packet',
      payload: 'everyone',
      target: 'space'
    });

    expect((await echoForAda).payload).toBe('everyone');
    expect((await echoForGrace).payload).toBe('everyone');

    const othersForGrace = waitForMessage<RelayPacketMessage>(grace, 'space:packet');
    const othersForAda = Promise.race([
      waitForMessage<RelayPacketMessage>(ada, 'space:packet'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50))
    ]);
    sendJson(ada, {
      type: 'space:packet',
      payload: 'not me',
      target: 'others'
    });

    expect((await othersForGrace).payload).toBe('not me');
    expect(await othersForAda).toBeNull();
  });

  it('broadcasts participant leave on explicit leave and disconnect', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'general');
    await joinSpace(grace, 'Grace', 'general');

    const explicitLeave = waitForMessage(ada, 'participant:left');
    sendJson(grace, { type: 'space:leave' });
    expect(await explicitLeave).toMatchObject({
      type: 'participant:left',
      participant: {
        name: 'Grace'
      }
    });

    await joinSpace(grace, 'Grace', 'general');
    const disconnectLeave = waitForMessage(ada, 'participant:left');
    grace.close();
    expect(await disconnectLeave).toMatchObject({
      type: 'participant:left',
      participant: {
        name: 'Grace'
      }
    });
  });

  it('reports protocol errors for invalid input', async () => {
    const ada = await connectClient();

    const malformed = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    ada.send('not json');
    expect(await malformed).toEqual({
      type: 'error:notice',
      message: 'Messages must be valid JSON.'
    });

    const packetBeforeJoin = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'space:packet',
      payload: 'too early'
    });
    expect(await packetBeforeJoin).toEqual({
      type: 'error:notice',
      message: 'Join a space before sending packets.'
    });

    const badName = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'space:join',
      name: '',
      spaceId: 'general'
    });
    expect(await badName).toEqual({
      type: 'error:notice',
      message: 'Enter a display name.'
    });

    const unknownType = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'made:up'
    });
    expect(await unknownType).toEqual({
      type: 'error:notice',
      message: 'Unknown message type.'
    });

    await joinSpace(ada, 'Ada', 'general');
    const invalidTarget = waitForMessage<RelayErrorMessage>(ada, 'error:notice');
    sendJson(ada, {
      type: 'space:packet',
      payload: 'bad target',
      target: ''
    });
    expect(await invalidTarget).toEqual({
      type: 'error:notice',
      message: 'Packet target must be "space" or "others".'
    });
  });

  it('updates health counts for active spaces and participants', async () => {
    const ada = await connectClient();
    const grace = await connectClient();

    await joinSpace(ada, 'Ada', 'design');
    await joinSpace(grace, 'Grace', 'infra');

    const health = await fetch(`${url}/health`).then((response) => response.json()) as HealthResponse;

    expect(health).toMatchObject({
      ok: true,
      participants: 2,
      activeSpaces: 2
    });
  });
});
