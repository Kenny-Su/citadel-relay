import {
  resolveChatRepository,
  type ChatRateLimitOptions,
  type ChatRepository,
  type MessageStore
} from '@citadel/app-chat/server';
import {
  resolveChessRepository,
  type ChessRepository
} from '@citadel/app-chess/server';
import type { CitadelDatabase } from '@citadel/platform/persistence';

export type LegacyAppRepositoryOptions = {
  database: CitadelDatabase;
  chatRepository?: ChatRepository;
  chessRepository?: ChessRepository;
  messageStore?: MessageStore;
  messageRateLimit?: ChatRateLimitOptions;
};

export type LegacyAppRepositories = {
  chatRepository: ChatRepository;
  chessRepository: ChessRepository;
  messageStore: MessageStore;
};

export type LegacyAppRepositoryOptionFields = Omit<LegacyAppRepositoryOptions, 'database'>;

export type {
  ChatRepository,
  ChessRepository,
  MessageStore
};

export function resolveLegacyAppRepositories(options: LegacyAppRepositoryOptions): LegacyAppRepositories {
  const chatRepository = resolveChatRepository(options);
  const chessRepository = resolveChessRepository(options);

  return {
    chatRepository,
    chessRepository,
    messageStore: chatRepository
  };
}

export function readLegacyAppRepositoryOptions(options: unknown): LegacyAppRepositoryOptionFields {
  if (!options || typeof options === 'string') {
    return {};
  }

  const legacyOptions = options as LegacyAppRepositoryOptionFields;

  return {
    chatRepository: legacyOptions.chatRepository,
    chessRepository: legacyOptions.chessRepository,
    messageStore: legacyOptions.messageStore,
    messageRateLimit: legacyOptions.messageRateLimit
  };
}

export function createLegacyAppServiceBag(
  repositories: LegacyAppRepositories,
  options: LegacyAppRepositoryOptionFields
): Record<string, unknown> {
  return {
    chatRepository: repositories.chatRepository,
    chessRepository: repositories.chessRepository,
    messageStore: repositories.messageStore,
    messageRateLimit: options.messageRateLimit
  };
}
