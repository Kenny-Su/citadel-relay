import { readFileSync } from 'node:fs';
import {
  createJwtClientAuthenticator,
  createPreSharedKeyAuthenticator,
  parsePreSharedKeyConfig
} from '../relay/auth.js';
import { createRelayServer } from '../relay/server.js';

const PORT = Number(process.env.PORT ?? 3001);
const CONFIG_PATH = process.env.RELAY_CONFIG_PATH ?? 'relay.config.json';

const config = parsePreSharedKeyConfig(readFileSync(CONFIG_PATH, 'utf8'));
const authenticateOwner = createPreSharedKeyAuthenticator(config);
const authenticateClient = createJwtClientAuthenticator(config.clientJwt);
const { httpServer } = createRelayServer({
  authenticateOwner,
  authenticateClient
});

httpServer.listen(PORT, () => {
  console.log(`Citadel relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
});
