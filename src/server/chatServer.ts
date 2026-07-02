import { createPlatformServer, type PlatformServerOptions } from '@citadel/platform/server';
import type { AppId } from '@citadel/platform/app';
import { createBundledServerApps, filterAppManifests } from '../bundledApps/serverRegistry.js';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import {
  createLegacyAppServiceBag,
  readLegacyAppRepositoryOptions,
  resolveLegacyAppRepositories,
  type LegacyAppRepositoryOptionFields
} from './legacyAppRepositories.js';

export type ChatServerOptions = Omit<PlatformServerOptions, 'apps'> & {
  database?: CitadelDatabase;
  enabledAppIds?: AppId[];
} & LegacyAppRepositoryOptionFields;

export function createChatServer(options: ChatServerOptions | string = {}) {
  const clientOrigin =
    typeof options === 'string' ? options : (options.clientOrigin ?? 'http://localhost:5173');
  const database =
    typeof options === 'string'
      ? openCitadelDatabase(process.env.CHAT_DB_PATH ?? 'data/citadel.sqlite')
      : (options.database ??
        openCitadelDatabase(process.env.CHAT_DB_PATH ?? process.env.CITADEL_DB_PATH ?? 'data/citadel.sqlite'));
  const legacyOptions = readLegacyAppRepositoryOptions(options);
  const services = {
    database,
    enabledAppIds: typeof options === 'string' ? undefined : options.enabledAppIds
  };
  const repositories = resolveLegacyAppRepositories({
    database,
    ...legacyOptions
  });
  const appManifests = services.enabledAppIds ? filterAppManifests(services.enabledAppIds) : undefined;

  return {
    ...createPlatformServer({
      clientOrigin,
      staticDir: typeof options === 'string' ? undefined : options.staticDir,
      appManifests,
      apps: createBundledServerApps({
        ...services,
        appServices: createLegacyAppServiceBag(repositories, legacyOptions, services.enabledAppIds)
      })
    }),
    database,
    messageStore: repositories.messageStore,
    chatRepository: repositories.chatRepository,
    chessRepository: repositories.chessRepository
  };
}
