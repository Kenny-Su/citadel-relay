import type { AppId, AppManifest } from '@citadel/platform/app';
import { isAppId } from '@citadel/platform/app';
import type { ServerAppModule, ServerAppRegistration } from '@citadel/platform/server-app';
import {
  bundledAppIds,
  bundledAppManifests,
  orderBundledAppEntries
} from './catalog.js';
import {
  chatServerRegistration,
  type ChatRateLimitOptions,
  type ChatRepository,
  type MessageStore
} from '@citadel/app-chat/server';
import {
  chessServerRegistration,
  type ChessRepository
} from '@citadel/app-chess/server';
import { snakeServerRegistration } from '@citadel/app-snake/server';
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

export { bundledAppManifests } from './catalog.js';

type BundledServerAppRegistration = ServerAppRegistration<BundledServerAppServices>;

const bundledServerAppDefinitions = orderBundledAppEntries({
  chat: chatServerRegistration,
  chess: chessServerRegistration,
  snake: snakeServerRegistration
}) satisfies BundledServerAppRegistration[];

export const bundledServerAppBundles = bundledServerAppDefinitions.map((definition) => definition.bundle);

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
  return filterServerAppDefinitions(enabledAppIds).map((definition) => definition.bundle);
}

export function filterAppManifests(enabledAppIds: AppId[]) {
  return enabledAppIds
    .map((appId) => bundledAppManifests.find((manifest) => manifest.appId === appId))
    .filter((manifest): manifest is AppManifest => Boolean(manifest));
}

function filterServerAppDefinitions(enabledAppIds: AppId[]) {
  return enabledAppIds
    .map((appId) => bundledServerAppDefinitions.find((definition) => definition.appId === appId))
    .filter((definition): definition is (typeof bundledServerAppDefinitions)[number] => Boolean(definition));
}

export function createBundledServerApps(services: BundledServerAppServices): ServerAppModule[] {
  const definitions = services.enabledAppIds
    ? filterServerAppDefinitions(services.enabledAppIds)
    : bundledServerAppDefinitions;

  return definitions.map((definition) => definition.createServerApp(services));
}
