import { createPlatformServer, type PlatformServerOptions } from '@citadel/platform/server';
import type { AppId } from '@citadel/platform/app';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import { createBundledServerApps, filterAppManifests, getEnabledAppIds } from '../bundledApps/serverRegistry.js';

export type CitadelServerOptions = Omit<PlatformServerOptions, 'apps' | 'appManifests'> & {
  database?: CitadelDatabase;
  databasePath?: string;
  enabledAppIds?: AppId[];
  enabledAppIdsInput?: string;
};

export function createCitadelServer(options: CitadelServerOptions = {}) {
  const database = options.database ?? openCitadelDatabase(
    options.databasePath ?? process.env.CITADEL_DB_PATH ?? 'data/citadel.sqlite'
  );
  const enabledAppIds = options.enabledAppIds ?? getEnabledAppIds(options.enabledAppIdsInput);

  return {
    ...createPlatformServer({
      clientOrigin: options.clientOrigin,
      staticDir: options.staticDir,
      appManifests: filterAppManifests(enabledAppIds),
      apps: createBundledServerApps({
        database,
        enabledAppIds
      })
    }),
    database
  };
}
