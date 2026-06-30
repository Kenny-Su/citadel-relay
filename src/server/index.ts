import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatformServer } from '@citadel/platform/server';
import { createBundledServerApps, filterAppManifests, getEnabledAppIds } from '../bundledApps/serverRegistry.js';
import { openCitadelDatabase } from '@citadel/platform/persistence';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const serverDir = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(serverDir, '..', '..', 'dist');
const dbPath = process.env.CHAT_DB_PATH ?? process.env.CITADEL_DB_PATH ?? 'data/citadel.sqlite';
const citadelDatabase = openCitadelDatabase(dbPath);
const enabledAppIds = getEnabledAppIds(process.env.CITADEL_ENABLED_APPS);

const { httpServer } = createPlatformServer({
  clientOrigin: CLIENT_ORIGIN,
  staticDir: existsSync(resolve(staticDir, 'index.html')) ? staticDir : undefined,
  appManifests: filterAppManifests(enabledAppIds),
  apps: createBundledServerApps({
    database: citadelDatabase,
    enabledAppIds
  })
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Citadel platform listening on http://${HOST}:${PORT}`);
});
