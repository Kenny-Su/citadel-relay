import { createPlatformServer, type PlatformServerOptions } from '../platform/server.js';
import type { AppId } from '../platform/app.js';
import { openCitadelDatabase, type CitadelDatabase } from '../platform/persistence.js';
import express from 'express';
import { join } from 'node:path';
import {
  createBundledServerApps,
  filterAppManifests,
  getEnabledAppIds
} from '../bundledApps/serverRegistry.js';
import {
  DEFAULT_EXTENSIONS_DIR,
  loadExtensionServerRegistrations,
  mountExtensionRoutes
} from './extensions.js';

export type CitadelServerOptions = Omit<PlatformServerOptions, 'apps' | 'appManifests'> & {
  database?: CitadelDatabase;
  databasePath?: string;
  extensionsDir?: string;
  enabledAppIds?: AppId[];
  enabledAppIdsInput?: string;
};

export async function createCitadelServer(options: CitadelServerOptions = {}) {
  const database = options.database ?? openCitadelDatabase(
    options.databasePath ?? process.env.CITADEL_DB_PATH ?? 'data/citadel.sqlite'
  );
  const extensionsDir = options.extensionsDir ?? process.env.CITADEL_EXTENSIONS_DIR ?? DEFAULT_EXTENSIONS_DIR;
  const extensionRegistrations = await loadExtensionServerRegistrations(extensionsDir);
  const extensionAppIds = extensionRegistrations.map((registration) => registration.manifest.appId);
  const bundledAppIds = getEnabledAppIds();
  const allAppIds = [...bundledAppIds, ...extensionAppIds];
  const enabledAppIds = options.enabledAppIds
    ?? (options.enabledAppIdsInput
      ? options.enabledAppIdsInput
        .split(',')
        .map((appId) => appId.trim())
        .filter((appId): appId is AppId => allAppIds.includes(appId))
      : allAppIds);
  const bundledApps = createBundledServerApps({
    database,
    enabledAppIds
  });
  const extensionApps = extensionRegistrations
    .filter((registration) => enabledAppIds.includes(registration.manifest.appId))
    .map((registration) => registration.createServerApp({ database }));
  const extensionManifests = extensionRegistrations
    .map((registration) => registration.manifest)
    .filter((manifest) => enabledAppIds.includes(manifest.appId));

  const platformServer = createPlatformServer({
    clientOrigin: options.clientOrigin,
    appManifests: [
      ...filterAppManifests(enabledAppIds),
      ...extensionManifests
    ],
    apps: [
      ...bundledApps,
      ...extensionApps
    ]
  });

  mountExtensionRoutes(platformServer.app, {
    extensionsDir,
    existingAppIds: [...getEnabledAppIds(), ...extensionAppIds]
  });

  if (options.staticDir) {
    const indexPath = join(options.staticDir, 'index.html');

    platformServer.app.use(express.static(options.staticDir, { index: false }));
    platformServer.app.get(/.*/, (_request, response) => {
      response.sendFile(indexPath);
    });
  }

  return {
    ...platformServer,
    database
  };
}
