import type { AppId } from '../shared/platform.js';
import { isAppId } from '../shared/platform.js';
import type { AppManifest } from '../platform/appContract.js';
import type { ServerAppModule } from '../platform/serverAppContract.js';
import {
  bundledAppIds,
  bundledAppManifests,
  orderBundledAppEntries
} from '@citadel/apps/catalog';
import {
  chatServerBundle,
  resolveChatRepository,
  type ChatRateLimitOptions,
  type ChatRepository,
  type ChatServerAppServices,
  type MessageStore
} from '@citadel/app-chat/server';
import {
  chessServerBundle,
  resolveChessRepository,
  type ChessRepository,
  type ChessServerAppServices
} from '@citadel/app-chess/server';
import { snakeServerBundle } from '@citadel/app-snake/server';
import type { ServerAppServices } from './serverServices.js';

export type { ChatRateLimitOptions } from '@citadel/app-chat/server';
export type { ServerAppServices } from './serverServices.js';

export type BundledServerAppServices = ServerAppServices & {
  chatRepository?: ChatRepository;
  chessRepository?: ChessRepository;
  messageStore?: MessageStore;
  messageRateLimit?: ChatRateLimitOptions;
  enabledAppIds?: AppId[];
};

export function resolveBundledRepositories(services: BundledServerAppServices) {
  return {
    chatRepository: resolveChatRepository(services),
    chessRepository: resolveChessRepository(services)
  };
}

export { bundledAppManifests } from '@citadel/apps/catalog';

type BundledServerAppBundle =
  | typeof chatServerBundle
  | typeof chessServerBundle
  | typeof snakeServerBundle;

export const bundledServerAppBundles: BundledServerAppBundle[] = orderBundledAppEntries({
  chat: chatServerBundle,
  chess: chessServerBundle,
  snake: snakeServerBundle
});

export function getEnabledAppIds(input?: string): AppId[] {
  if (!input?.trim()) {
    return [...bundledAppIds];
  }

  const enabledAppIds: AppId[] = [];
  const seen = new Set<AppId>();

  for (const token of input.split(',')) {
    const appId = token.trim();

    if (!isAppId(appId) || seen.has(appId)) {
      continue;
    }

    enabledAppIds.push(appId);
    seen.add(appId);
  }

  return enabledAppIds.length > 0 ? enabledAppIds : [...bundledAppIds];
}

export function filterServerAppBundles(enabledAppIds: AppId[]) {
  return enabledAppIds
    .map((appId) => bundledServerAppBundles.find((bundle) => bundle.appId === appId))
    .filter((bundle): bundle is (typeof bundledServerAppBundles)[number] => Boolean(bundle));
}

export function filterAppManifests(enabledAppIds: AppId[]) {
  return enabledAppIds
    .map((appId) => bundledAppManifests.find((manifest) => manifest.appId === appId))
    .filter((manifest): manifest is AppManifest => Boolean(manifest));
}

export function createBundledServerApps(services: BundledServerAppServices): ServerAppModule[] {
  const repositories = resolveBundledRepositories(services);
  const bundles = services.enabledAppIds
    ? filterServerAppBundles(services.enabledAppIds)
    : bundledServerAppBundles;

  const servicesByAppId = {
    chat: {
      database: services.database,
      chatRepository: repositories.chatRepository,
      messageStore: services.messageStore,
      messageRateLimit: services.messageRateLimit
    } satisfies ChatServerAppServices,
    chess: {
      database: services.database,
      chessRepository: repositories.chessRepository
    } satisfies ChessServerAppServices,
    snake: {
      database: services.database
    } satisfies ServerAppServices
  };

  return bundles.map((bundle) => {
    if (bundle.appId === 'chat') {
      return chatServerBundle.createServerApp(servicesByAppId.chat);
    }

    if (bundle.appId === 'chess') {
      return chessServerBundle.createServerApp(servicesByAppId.chess);
    }

    return snakeServerBundle.createServerApp(servicesByAppId.snake);
  });
}
