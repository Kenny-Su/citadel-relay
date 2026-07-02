import { nanoid } from 'nanoid';
import type { ServerAppContext, ServerAppModule } from '@citadel/platform/server-app';
import { MESSAGE_HISTORY_LIMIT, type ChatMessage, type SendMessagePayload } from './shared.js';
import { validateMessageBody } from './validation.js';
import type { ChatRepository } from './messageStore.js';

export type ChatAppOptions = {
  repository: ChatRepository;
  messageRateLimit?: {
    maxMessages: number;
    windowMs: number;
  };
};

const DEFAULT_MESSAGE_RATE_LIMIT = {
  maxMessages: 5,
  windowMs: 10_000
};

type MessageRateState = {
  acceptedAt: number[];
};

export function createChatApp(options: ChatAppOptions): ServerAppModule {
  const typingBySpace = new Map<string, Set<string>>();
  const messageRateBySocket = new Map<string, MessageRateState>();
  const messageRateLimit = options.messageRateLimit ?? DEFAULT_MESSAGE_RATE_LIMIT;

  function canAcceptMessage(socketId: string) {
    const now = Date.now();
    const windowStart = now - messageRateLimit.windowMs;
    const state = messageRateBySocket.get(socketId) ?? { acceptedAt: [] };
    state.acceptedAt = state.acceptedAt.filter((acceptedAt) => acceptedAt > windowStart);

    if (state.acceptedAt.length >= messageRateLimit.maxMessages) {
      messageRateBySocket.set(socketId, state);
      return false;
    }

    state.acceptedAt.push(now);
    messageRateBySocket.set(socketId, state);
    return true;
  }

  function clearTyping(context: ServerAppContext, socketId: string) {
    const typingSocketIds = typingBySpace.get(context.spaceId);

    if (!typingSocketIds?.delete(socketId)) {
      return;
    }

    if (typingSocketIds.size === 0) {
      typingBySpace.delete(context.spaceId);
    }

    emitTypingUpdate(context);
  }

  function emitTypingUpdate(context: ServerAppContext) {
    const typingSocketIds = typingBySpace.get(context.spaceId) ?? new Set<string>();
    const participants = [...typingSocketIds]
      .map((socketId) => context.participants.find((participant) => participant.socketId === socketId))
      .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant))
      .sort((a, b) => a.name.localeCompare(b.name));

    context.emitToSpace('chat:typing:update', {
      spaceId: context.spaceId,
      participants
    });
  }

  return {
    appId: 'chat',
    getInitialState(context) {
      const typingSocketIds = typingBySpace.get(context.spaceId) ?? new Set<string>();
      const typingParticipants = [...typingSocketIds]
        .map((socketId) => context.participants.find((participant) => participant.socketId === socketId))
        .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        messages: options.repository.listRecentMessages(context.spaceId, MESSAGE_HISTORY_LIMIT),
        typingParticipants
      };
    },
    handleEvent(context, event) {
      if (event.type === 'chat:typing:start') {
        const typingSocketIds = typingBySpace.get(context.spaceId) ?? new Set<string>();

        if (!typingSocketIds.has(context.socketId)) {
          typingSocketIds.add(context.socketId);
          typingBySpace.set(context.spaceId, typingSocketIds);
          emitTypingUpdate(context);
        }

        return;
      }

      if (event.type === 'chat:typing:stop') {
        clearTyping(context, context.socketId);
        return;
      }

      if (event.type !== 'chat:message:send') {
        return;
      }

      const payload = (event.payload ?? {}) as SendMessagePayload;
      const result = validateMessageBody(payload.body);

      if (!result.ok) {
        context.emitToParticipant('chat:notice', { message: result.error });
        return;
      }

      if (!canAcceptMessage(context.socketId)) {
        context.emitToParticipant('chat:notice', {
          message: 'Slow down before sending another message.'
        });
        return;
      }

      const message: ChatMessage = {
        id: nanoid(),
        spaceId: context.spaceId,
        participantId: context.participant.id,
        participantName: context.participant.name,
        body: result.value,
        createdAt: new Date().toISOString()
      };

      options.repository.saveMessage(message);
      clearTyping(context, context.socketId);
      context.emitToSpace('chat:message:new', message);
    },
    onParticipantLeft(context) {
      messageRateBySocket.delete(context.socketId);
      clearTyping(context, context.socketId);
    }
  };
}
