import { readFileSync } from 'node:fs';
import {
  createAppServerAuthenticator,
  createJwtClientAuthenticator,
  parseRelayConfig
} from '../relay/auth.js';
import { createRelayServer } from '../relay/server.js';

const PORT = Number(process.env.PORT ?? 3001);
const CONFIG_PATH = process.env.RELAY_CONFIG_PATH ?? 'relay.config.json';

const config = parseRelayConfig(readFileSync(CONFIG_PATH, 'utf8'));
const authenticateAppServer = createAppServerAuthenticator(config);
const authenticateClient = createJwtClientAuthenticator(config.clientJwt);
const { httpServer } = createRelayServer({
  authenticateAppServer,
  authenticateClient
});

httpServer.listen(PORT, () => {
  console.log(`Citadel relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
});
