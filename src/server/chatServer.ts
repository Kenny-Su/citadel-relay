import { createPlatformServer, type PlatformServerOptions } from '../platform/server.js';
import { createChatApp } from '../apps/chat/server.js';
import { createChatRepository, type ChatRepository, type MessageStore } from '../apps/chat/messageStore.js';
import { createChessApp } from '../apps/chess/server.js';
import { createChessRepository, type ChessRepository } from '../apps/chess/repository.js';
import { createSnakeApp } from '../apps/snake/server.js';
import { openCitadelDatabase, type CitadelDatabase } from '../persistence/sqlite.js';

export type ChatServerOptions = Omit<PlatformServerOptions, 'apps'> & {
  database?: CitadelDatabase;
  chatRepository?: ChatRepository;
  chessRepository?: ChessRepository;
  messageStore?: MessageStore;
  messageRateLimit?: {
    maxMessages: number;
    windowMs: number;
  };
};

export function createChatServer(options: ChatServerOptions | string = {}) {
  const clientOrigin =
    typeof options === 'string' ? options : (options.clientOrigin ?? 'http://localhost:5173');
  const database =
    typeof options === 'string'
      ? openCitadelDatabase(process.env.CHAT_DB_PATH ?? 'data/citadel.sqlite')
      : (options.database ??
        openCitadelDatabase(process.env.CHAT_DB_PATH ?? process.env.CITADEL_DB_PATH ?? 'data/citadel.sqlite'));
  const chatRepository =
    typeof options === 'string'
      ? createChatRepository(database.database)
      : (options.chatRepository ?? options.messageStore ?? createChatRepository(database.database));
  const chessRepository =
    typeof options === 'string'
      ? createChessRepository(database.database)
      : (options.chessRepository ?? createChessRepository(database.database));

  return {
    ...createPlatformServer({
      clientOrigin,
      staticDir: typeof options === 'string' ? undefined : options.staticDir,
      apps: [
        createChatApp({
          repository: chatRepository,
          messageRateLimit: typeof options === 'string' ? undefined : options.messageRateLimit
        }),
        createChessApp({
          repository: chessRepository
        }),
        createSnakeApp()
      ]
    }),
    database,
    messageStore: chatRepository,
    chatRepository,
    chessRepository
  };
}
