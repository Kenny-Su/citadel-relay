import type { ServerAppBundle, ServerAppRegistration, ServerAppServices } from '@citadel/platform/server-app';
import { chatManifest } from './manifest.js';
import { createChatRepository, type ChatRepository, type MessageStore } from './messageStore.js';
import { createChatApp } from './serverApp.js';

export type ChatRateLimitOptions = {
  maxMessages: number;
  windowMs: number;
};

export type ChatServerAppServices = ServerAppServices & {
  chatRepository?: ChatRepository;
  messageStore?: MessageStore;
  messageRateLimit?: ChatRateLimitOptions;
};

type ChatServerAppServiceInput = ServerAppServices & {
  chatRepository?: unknown;
  messageStore?: unknown;
  messageRateLimit?: unknown;
};

export {
  createChatRepository,
  createSqliteMessageStore,
  type ChatRepository,
  type MessageStore
} from './messageStore.js';

export function resolveChatRepository(services: ChatServerAppServices) {
  return services.chatRepository
    ?? services.messageStore
    ?? createChatRepository(services.database.database);
}

export function createChatServerAppFromServices(services: ChatServerAppServiceInput) {
  return chatServerBundle.createServerApp(services as ChatServerAppServices);
}

export const chatServerBundle = {
  appId: chatManifest.appId,
  createServerApp(services) {
    return createChatApp({
      repository: resolveChatRepository(services),
      messageRateLimit: services.messageRateLimit
    });
  }
} satisfies ServerAppBundle<ChatServerAppServices>;

export const chatServerRegistration = {
  appId: chatServerBundle.appId,
  bundle: chatServerBundle,
  createServerApp: createChatServerAppFromServices
} satisfies ServerAppRegistration<ChatServerAppServices>;
