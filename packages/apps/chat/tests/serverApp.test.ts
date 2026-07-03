import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEventEnvelope, Participant } from '@citadel/platform/app';
import type { ServerAppContext } from '@citadel/platform/server-app';
import { createChatApp } from '../src/serverApp.js';
import type { ChatMessage, ChatState, SendMessagePayload, TypingUpdatePayload } from '../src/shared.js';
import type { ChatRepository } from '../src/messageStore.js';

type EmittedEvent = {
  scope: 'space' | 'participant';
  type: string;
  payload: unknown;
};

type ChatHarness = {
  participants: Participant[];
  emitted: EmittedEvent[];
  contextFor(participant: Participant): ServerAppContext;
};

function participant(id: string, name: string): Participant {
  return {
    id,
    socketId: `socket-${id}`,
    name
  };
}

function createHarness(initialParticipants: Participant[] = []): ChatHarness {
  const harness: ChatHarness = {
    participants: [...initialParticipants],
    emitted: [],
    contextFor(currentParticipant) {
      return {
        appId: 'chat',
        spaceId: 'design',
        socketId: currentParticipant.socketId ?? currentParticipant.id,
        participant: currentParticipant,
        participants: harness.participants,
        emitToSpace(type, payload) {
          harness.emitted.push({ scope: 'space', type, payload });
        },
        emitToParticipant(type, payload) {
          harness.emitted.push({ scope: 'participant', type, payload });
        },
        emitSpaceState() {},
        getAppState<T>() {
          return undefined as T | undefined;
        },
        setAppState() {},
        clearAppState() {}
      };
    }
  };

  return harness;
}

function createMemoryRepository(messages: ChatMessage[] = []): ChatRepository {
  return {
    listRecentMessages(spaceId, limit = 100) {
      return messages
        .filter((message) => message.spaceId === spaceId)
        .slice(-limit);
    },
    saveMessage(message) {
      messages.push(message);
    },
    countMessages() {
      return messages.length;
    },
    close() {}
  };
}

function sendMessage(body: string): AppEventEnvelope<SendMessagePayload> {
  return {
    appId: 'chat',
    type: 'chat:message:send',
    payload: { body }
  };
}

function lastEvent<T>(harness: ChatHarness, type: string) {
  const event = harness.emitted.findLast((candidate) => candidate.type === type);
  expect(event).toBeDefined();
  return event as EmittedEvent & { payload: T };
}

describe('chat server app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads recent messages from the repository for the current space', () => {
    const repository = createMemoryRepository([
      {
        id: 'message-1',
        spaceId: 'design',
        participantId: 'guest-ada',
        participantName: 'Ada',
        body: 'stored',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'message-2',
        spaceId: 'other',
        participantId: 'guest-grace',
        participantName: 'Grace',
        body: 'elsewhere',
        createdAt: '2026-01-01T00:00:01.000Z'
      }
    ]);
    const ada = participant('guest-ada', 'Ada');
    const harness = createHarness([ada]);
    const app = createChatApp({ repository });

    const state = app.getInitialState(harness.contextFor(ada)) as ChatState;

    expect(state.messages.map((message) => message.body)).toEqual(['stored']);
    expect(state.typingParticipants).toEqual([]);
  });

  it('broadcasts typing updates and clears typing when a message is sent', () => {
    const repository = createMemoryRepository();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const harness = createHarness([ada, grace]);
    const app = createChatApp({ repository });

    app.handleEvent(harness.contextFor(ada), {
      appId: 'chat',
      type: 'chat:typing:start'
    });

    expect(lastEvent<TypingUpdatePayload>(harness, 'chat:typing:update').payload.participants).toEqual([ada]);

    app.handleEvent(harness.contextFor(ada), sendMessage('  hello platform  '));

    expect(lastEvent<ChatMessage>(harness, 'chat:message:new').payload).toMatchObject({
      spaceId: 'design',
      participantId: 'guest-ada',
      participantName: 'Ada',
      body: 'hello platform',
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    expect(lastEvent<TypingUpdatePayload>(harness, 'chat:typing:update').payload.participants).toEqual([]);
    expect(repository.countMessages()).toBe(1);
  });

  it('rejects invalid messages without saving or broadcasting them', () => {
    const repository = createMemoryRepository();
    const ada = participant('guest-ada', 'Ada');
    const harness = createHarness([ada]);
    const app = createChatApp({ repository });

    app.handleEvent(harness.contextFor(ada), sendMessage('   '));

    expect(lastEvent<{ message: string }>(harness, 'chat:notice')).toMatchObject({
      scope: 'participant',
      payload: { message: 'Type a message before sending.' }
    });
    expect(repository.countMessages()).toBe(0);
    expect(harness.emitted.some((event) => event.type === 'chat:message:new')).toBe(false);
  });

  it('rate limits messages per socket', () => {
    const repository = createMemoryRepository();
    const ada = participant('guest-ada', 'Ada');
    const harness = createHarness([ada]);
    const app = createChatApp({
      repository,
      messageRateLimit: {
        maxMessages: 2,
        windowMs: 1_000
      }
    });

    app.handleEvent(harness.contextFor(ada), sendMessage('message 1'));
    app.handleEvent(harness.contextFor(ada), sendMessage('message 2'));
    app.handleEvent(harness.contextFor(ada), sendMessage('message 3'));

    expect(repository.countMessages()).toBe(2);
    expect(lastEvent<{ message: string }>(harness, 'chat:notice')).toMatchObject({
      scope: 'participant',
      payload: { message: 'Slow down before sending another message.' }
    });
    expect(harness.emitted.filter((event) => event.type === 'chat:message:new')).toHaveLength(2);
  });
});
