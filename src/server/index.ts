import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatformServer } from '../platform/server.js';
import { createChatApp } from '../apps/chat/server.js';
import { createChessApp } from '../apps/chess/server.js';
import { createSnakeApp } from '../apps/snake/server.js';
import { createChatRepository } from '../apps/chat/messageStore.js';
import { createChessRepository } from '../apps/chess/repository.js';
import { openCitadelDatabase } from '../persistence/sqlite.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const serverDir = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(serverDir, '..', '..', 'dist');
const dbPath = process.env.CHAT_DB_PATH ?? process.env.CITADEL_DB_PATH ?? 'data/citadel.sqlite';
const citadelDatabase = openCitadelDatabase(dbPath);

const { httpServer } = createPlatformServer({
  clientOrigin: CLIENT_ORIGIN,
  staticDir: existsSync(resolve(staticDir, 'index.html')) ? staticDir : undefined,
  apps: [
    createChatApp({
      repository: createChatRepository(citadelDatabase.database)
    }),
    createChessApp({
      repository: createChessRepository(citadelDatabase.database)
    }),
    createSnakeApp()
  ]
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Citadel platform listening on http://${HOST}:${PORT}`);
});
