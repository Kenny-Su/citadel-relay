import type { ServerAppBundle, ServerAppServices } from '@citadel/platform/server-app';
import { chessManifest } from './manifest.js';
import { createChessRepository, type ChessRepository } from './repository.js';
import { createChessApp } from './server.js';

export type ChessServerAppServices = ServerAppServices & {
  chessRepository?: ChessRepository;
};

export {
  createChessRepository,
  type ChessRepository,
  type PersistedChessGame,
  type PersistedChessMove
} from './repository.js';

export function resolveChessRepository(services: ChessServerAppServices) {
  return services.chessRepository ?? createChessRepository(services.database.database);
}

export const chessServerBundle = {
  appId: chessManifest.appId,
  createServerApp(services) {
    return createChessApp({
      repository: resolveChessRepository(services)
    });
  }
} satisfies ServerAppBundle<ChessServerAppServices>;
