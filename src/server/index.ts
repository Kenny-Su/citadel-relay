import { createRelayServer } from '../relay/server.js';

const PORT = Number(process.env.PORT ?? 3001);

const { httpServer } = createRelayServer();

httpServer.listen(PORT, () => {
  console.log(`Citadel relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
});
