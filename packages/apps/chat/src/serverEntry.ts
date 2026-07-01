import type { ServerAppBundle, ServerAppServices } from '@citadel/platform/server-app';
import { chatManifest } from './manifest.js';
import { createChatRepository, type ChatRepository, type MessageStore } from './messageStore.js';
import { createChatApp } from './server.js';

export type ChatRateLimitOptions = {
  maxMessages: number;
  windowMs: number;
};

export type ChatServerAppServices = ServerAppServices & {
  chatRepository?: ChatRepository;
  messageStore?: MessageStore;
  messageRateLimit?: ChatRateLimitOptions;
};

export {
  createChatRepository,
  createSqliteMessageStore,
  type ChatRepository,
  type MessageStore
} from './messageStore.js';

export function resolveChatRepository(services: ChatServerAppServices) {
  return services.chatRepository ?? services.messageStore ?? createChatRepository(services.database.database);
}

export function createChatServerAppFromServices(services: ChatServerAppServices) {
  return chatServerBundle.createServerApp(services);
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
