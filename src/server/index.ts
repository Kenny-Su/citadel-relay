import { readFileSync } from 'node:fs';
import {
  createPreSharedKeyAuthenticator,
  parsePreSharedKeyConfig
} from '../relay/auth.js';
import { createRelayServer } from '../relay/server.js';

const PORT = Number(process.env.PORT ?? 3001);
const CONFIG_PATH = process.env.RELAY_CONFIG_PATH ?? 'relay.config.json';

const authenticateOwner = createPreSharedKeyAuthenticator(
  parsePreSharedKeyConfig(readFileSync(CONFIG_PATH, 'utf8'))
);
const { httpServer } = createRelayServer({ authenticateOwner });

httpServer.listen(PORT, () => {
  console.log(`Citadel relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
});
