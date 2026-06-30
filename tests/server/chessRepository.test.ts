import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import { createChessRepository, type ChessRepository } from '@citadel/app-chess/server';

describe('chess repository', () => {
  let tempDir: string;
  let db: CitadelDatabase;
  let repository: ChessRepository;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-chess-repository-'));
    db = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
    repository = createChessRepository(db.database);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes with no game', () => {
    expect(repository.getGame('board')).toBeNull();
    expect(repository.listMoves('board')).toEqual([]);
  });

  it('saves and reloads a game snapshot', () => {
    repository.saveGame({
      spaceId: 'board',
      fen: 'start-fen',
      pgn: '',
      players: { white: 'guest-white', black: 'guest-black' },
      status: 'white to move',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    expect(repository.getGame('board')).toEqual({
      spaceId: 'board',
      fen: 'start-fen',
      pgn: '',
      players: { white: 'guest-white', black: 'guest-black' },
      status: 'white to move',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  it('appends moves chronologically and scopes them by space', () => {
    repository.appendMove({
      id: 'move-2',
      spaceId: 'board',
      participantId: 'guest-black',
      move: { from: 'e7', to: 'e5' },
      san: 'e5',
      fenAfter: 'fen-2',
      createdAt: '2026-01-01T00:00:02.000Z'
    });
    repository.appendMove({
      id: 'move-1',
      spaceId: 'board',
      participantId: 'guest-white',
      move: { from: 'e2', to: 'e4' },
      san: 'e4',
      fenAfter: 'fen-1',
      createdAt: '2026-01-01T00:00:01.000Z'
    });
    repository.appendMove({
      id: 'other-1',
      spaceId: 'other',
      participantId: 'guest-white',
      move: { from: 'd2', to: 'd4' },
      san: 'd4',
      fenAfter: 'fen-other',
      createdAt: '2026-01-01T00:00:00.000Z'
    });

    expect(repository.listMoves('board').map((move) => move.id)).toEqual(['move-1', 'move-2']);
    expect(repository.listMoves('other').map((move) => move.id)).toEqual(['other-1']);
  });
});
