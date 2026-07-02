import type { AppId } from '@citadel/platform/app';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import { createCitadelServer, type CitadelServerOptions } from './citadelServer.js';
import {
  createLegacyAppServiceBag,
  readLegacyAppRepositoryOptions,
  resolveLegacyAppRepositories,
  type LegacyAppRepositoryOptionFields
} from './legacyAppRepositories.js';

export type ChatServerOptions = Omit<CitadelServerOptions, 'appServices' | 'enabledAppIdsInput'> & {
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
        openCitadelDatabase(
          process.env.CHAT_DB_PATH
            ?? options.databasePath
            ?? process.env.CITADEL_DB_PATH
            ?? 'data/citadel.sqlite'
        ));
  const legacyOptions = readLegacyAppRepositoryOptions(options);
  const enabledAppIds = typeof options === 'string' ? undefined : options.enabledAppIds;
  const repositories = resolveLegacyAppRepositories({
    database,
    ...legacyOptions
  });

  return {
    ...createCitadelServer({
      clientOrigin,
      staticDir: typeof options === 'string' ? undefined : options.staticDir,
      database,
      enabledAppIds,
      appServices: createLegacyAppServiceBag(repositories, legacyOptions, enabledAppIds)
    }),
    database,
    messageStore: repositories.messageStore,
    chatRepository: repositories.chatRepository,
    chessRepository: repositories.chessRepository
  };
}
