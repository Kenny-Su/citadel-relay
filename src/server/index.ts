import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createJwtClientAuthenticator,
  parseRelayConfig
} from '../relay/auth.js';
import { createRelayServer } from '../relay/server.js';
import { mountAdminApi } from '../admin/adminApi.js';
import { prepareRelayConfig } from '../admin/legacyConfigMigration.js';
import { RegistrationStore } from '../admin/registrationStore.js';
import { mountAdminFrontend } from '../admin/staticAdmin.js';

const PORT = Number(process.env.PORT ?? 3001);
const CONFIG_PATH = process.env.RELAY_CONFIG_PATH ?? 'relay.config.json';
const ADMIN_PASSPHRASE = process.env.RELAY_ADMIN_PASSPHRASE;
const ADMIN_ASSET_PATH = resolve(process.cwd(), 'dist/admin');

if (ADMIN_PASSPHRASE && ADMIN_PASSPHRASE.length < 16) {
  throw new Error('RELAY_ADMIN_PASSPHRASE must be at least 16 characters.');
}

const { clientJwt: clientJwtConfig } = parseRelayConfig(readFileSync(CONFIG_PATH, 'utf8'));
const authenticateClient = createJwtClientAuthenticator(clientJwtConfig);
const registrationStore = new RegistrationStore();
const { migratedLegacyApps } = prepareRelayConfig(CONFIG_PATH, registrationStore);
const authenticateAppServer = (token: string) => registrationStore.authenticate(token);
const relay = createRelayServer({
  authenticateAppServer,
  authenticateClient
});

if (process.env.RELAY_TRUST_PROXY === 'true') {
  relay.app.set('trust proxy', 1);
}

let adminFrontendMounted = false;
if (ADMIN_PASSPHRASE) {
  mountAdminApi(relay.app, {
    passphrase: ADMIN_PASSPHRASE,
    registrationStore,
    runtime: relay,
    secureCookies: process.env.RELAY_ADMIN_SECURE_COOKIES !== 'false'
  });
  adminFrontendMounted = mountAdminFrontend(relay.app, ADMIN_ASSET_PATH);
}

relay.httpServer.on('close', () => registrationStore.close());

relay.httpServer.listen(PORT, () => {
  console.log(`Citadel relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
  if (migratedLegacyApps > 0) {
    console.log(`Migrated ${migratedLegacyApps} app registration(s) to SQLite.`);
  }
  if (adminFrontendMounted) {
    console.log(`Admin console available at http://localhost:${PORT}/admin/`);
  } else if (ADMIN_PASSPHRASE) {
    console.log('Admin API enabled; use the Vite development URL for the console.');
  }
});
