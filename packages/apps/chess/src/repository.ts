import { DatabaseSync } from 'node:sqlite';
import type { ChessMovePayload, ChessPlayerMap } from './shared.js';

export type PersistedChessGame = {
  spaceId: string;
  fen: string;
  pgn: string;
  players: ChessPlayerMap;
  status: string;
  updatedAt: string;
};

export type PersistedChessMove = {
  id: string;
  spaceId: string;
  participantId: string;
  from: string;
  to: string;
  promotion?: string;
  san: string;
  fenAfter: string;
  createdAt: string;
};

export type SaveChessGameInput = {
  spaceId: string;
  fen: string;
  pgn: string;
  players: ChessPlayerMap;
  status: string;
  updatedAt: string;
};

export type SaveChessMoveInput = {
  id: string;
  spaceId: string;
  participantId: string;
  move: ChessMovePayload;
  san: string;
  fenAfter: string;
  createdAt: string;
};

export type ChessRepository = {
  getGame(spaceId: string): PersistedChessGame | null;
  saveGame(game: SaveChessGameInput): void;
  appendMove(move: SaveChessMoveInput): void;
  listMoves(spaceId: string): PersistedChessMove[];
  close(): void;
};

type GameRow = {
  space_id: string;
  fen: string;
  pgn: string;
  white_participant_id: string | null;
  black_participant_id: string | null;
  status: string;
  updated_at: string;
};

type MoveRow = {
  id: string;
  space_id: string;
  participant_id: string;
  from_square: string;
  to_square: string;
  promotion: string | null;
  san: string;
  fen_after: string;
  created_at: string;
};

export function createChessRepository(database: DatabaseSync): ChessRepository {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chess_games (
      space_id TEXT PRIMARY KEY,
      fen TEXT NOT NULL,
      pgn TEXT NOT NULL,
      white_participant_id TEXT,
      black_participant_id TEXT,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chess_moves (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      from_square TEXT NOT NULL,
      to_square TEXT NOT NULL,
      promotion TEXT,
      san TEXT NOT NULL,
      fen_after TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chess_moves_space_created_at ON chess_moves (space_id, created_at);
  `);

  const getGame = database.prepare(`
    SELECT space_id, fen, pgn, white_participant_id, black_participant_id, status, updated_at
    FROM chess_games
    WHERE space_id = ?
  `);

  const saveGame = database.prepare(`
    INSERT INTO chess_games (
      space_id, fen, pgn, white_participant_id, black_participant_id, status, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(space_id) DO UPDATE SET
      fen = excluded.fen,
      pgn = excluded.pgn,
      white_participant_id = excluded.white_participant_id,
      black_participant_id = excluded.black_participant_id,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  const appendMove = database.prepare(`
    INSERT INTO chess_moves (
      id, space_id, participant_id, from_square, to_square, promotion, san, fen_after, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const listMoves = database.prepare(`
    SELECT id, space_id, participant_id, from_square, to_square, promotion, san, fen_after, created_at
    FROM chess_moves
    WHERE space_id = ?
    ORDER BY created_at ASC, id ASC
  `);

  return {
    getGame(spaceId) {
      const row = getGame.get(spaceId) as GameRow | undefined;
      return row ? rowToGame(row) : null;
    },
    saveGame(game) {
      saveGame.run(
        game.spaceId,
        game.fen,
        game.pgn,
        game.players.white ?? null,
        game.players.black ?? null,
        game.status,
        game.updatedAt
      );
    },
    appendMove(move) {
      appendMove.run(
        move.id,
        move.spaceId,
        move.participantId,
        move.move.from,
        move.move.to,
        move.move.promotion ?? null,
        move.san,
        move.fenAfter,
        move.createdAt
      );
    },
    listMoves(spaceId) {
      return listMoves.all(spaceId).map(rowToMove);
    },
    close() {}
  };
}

function rowToGame(row: GameRow): PersistedChessGame {
  return {
    spaceId: row.space_id,
    fen: row.fen,
    pgn: row.pgn,
    players: {
      white: row.white_participant_id ?? undefined,
      black: row.black_participant_id ?? undefined
    },
    status: row.status,
    updatedAt: row.updated_at
  };
}

function rowToMove(row: unknown): PersistedChessMove {
  const move = row as MoveRow;

  return {
    id: move.id,
    spaceId: move.space_id,
    participantId: move.participant_id,
    from: move.from_square,
    to: move.to_square,
    promotion: move.promotion ?? undefined,
    san: move.san,
    fenAfter: move.fen_after,
    createdAt: move.created_at
  };
}
