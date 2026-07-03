import { describe, expect, it } from 'vitest';
import type { AppEventEnvelope, Participant } from '@citadel/platform/app';
import type { ServerAppContext } from '@citadel/platform/server-app';
import { createChessApp } from '../src/serverApp.js';
import type {
  ChessRepository,
  PersistedChessGame,
  PersistedChessMove,
  SaveChessGameInput,
  SaveChessMoveInput
} from '../src/repository.js';
import type { ChessMovePayload, ChessState } from '../src/shared.js';

type EmittedEvent = {
  scope: 'space' | 'participant' | 'space-state';
  type: string;
  payload: unknown;
};

type ChessHarness = {
  participants: Participant[];
  emitted: EmittedEvent[];
  appState: unknown;
  contextFor(participant: Participant): ServerAppContext;
};

function participant(id: string, name: string): Participant {
  return {
    id,
    socketId: `socket-${id}`,
    name
  };
}

function createHarness(initialParticipants: Participant[] = []): ChessHarness {
  const harness: ChessHarness = {
    participants: [...initialParticipants],
    emitted: [],
    appState: undefined,
    contextFor(currentParticipant) {
      return {
        appId: 'chess',
        spaceId: 'board',
        socketId: currentParticipant.socketId ?? currentParticipant.id,
        participant: currentParticipant,
        participants: harness.participants,
        emitToSpace(type, payload) {
          harness.emitted.push({ scope: 'space', type, payload });
        },
        emitToParticipant(type, payload) {
          harness.emitted.push({ scope: 'participant', type, payload });
        },
        emitSpaceState() {
          harness.emitted.push({ scope: 'space-state', type: 'space:state', payload: undefined });
        },
        getAppState<T>() {
          return harness.appState as T | undefined;
        },
        setAppState<T>(state: T) {
          harness.appState = state;
        },
        clearAppState() {
          harness.appState = undefined;
        }
      };
    }
  };

  return harness;
}

function createMemoryRepository(initialGames: PersistedChessGame[] = []): ChessRepository {
  const games = new Map(initialGames.map((game) => [game.spaceId, game]));
  const moves: PersistedChessMove[] = [];

  return {
    getGame(spaceId) {
      return games.get(spaceId) ?? null;
    },
    saveGame(game: SaveChessGameInput) {
      games.set(game.spaceId, { ...game });
    },
    appendMove(move: SaveChessMoveInput) {
      moves.push({
        id: move.id,
        spaceId: move.spaceId,
        participantId: move.participantId,
        from: move.move.from,
        to: move.move.to,
        promotion: move.move.promotion,
        san: move.san,
        fenAfter: move.fenAfter,
        createdAt: move.createdAt
      });
    },
    listMoves(spaceId) {
      return moves.filter((move) => move.spaceId === spaceId);
    },
    close() {}
  };
}

function moveEvent(move: ChessMovePayload): AppEventEnvelope<ChessMovePayload> {
  return {
    appId: 'chess',
    type: 'chess:move',
    payload: move
  };
}

function lastEvent<T>(harness: ChessHarness, type: string) {
  const event = harness.emitted.findLast((candidate) => candidate.type === type);
  expect(event).toBeDefined();
  return event as EmittedEvent & { payload: T };
}

describe('chess server app', () => {
  it('assigns the first two participants as white and black', () => {
    const repository = createMemoryRepository();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const linus = participant('guest-linus', 'Linus');
    const harness = createHarness([ada, grace, linus]);
    const app = createChessApp({ repository });

    const state = app.getInitialState(harness.contextFor(ada)) as ChessState;

    expect(state.players).toEqual({
      white: 'guest-ada',
      black: 'guest-grace'
    });
  });

  it('rejects spectator moves and out-of-turn moves', () => {
    const repository = createMemoryRepository();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const linus = participant('guest-linus', 'Linus');
    const harness = createHarness([ada, grace, linus]);
    const app = createChessApp({ repository });

    app.getInitialState(harness.contextFor(ada));
    app.handleEvent(harness.contextFor(linus), moveEvent({ from: 'e2', to: 'e4' }));

    expect(lastEvent<{ message: string }>(harness, 'chess:notice')).toMatchObject({
      scope: 'participant',
      payload: { message: 'Spectators cannot move pieces.' }
    });

    app.handleEvent(harness.contextFor(grace), moveEvent({ from: 'e7', to: 'e5' }));

    expect(lastEvent<{ message: string }>(harness, 'chess:notice')).toMatchObject({
      scope: 'participant',
      payload: { message: 'Wait for your turn.' }
    });
    expect(repository.listMoves('board')).toHaveLength(0);
  });

  it('persists valid moves and emits updated chess state', () => {
    const repository = createMemoryRepository();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const harness = createHarness([ada, grace]);
    const app = createChessApp({ repository });

    app.getInitialState(harness.contextFor(ada));
    app.handleEvent(harness.contextFor(ada), moveEvent({ from: 'e2', to: 'e4' }));

    const state = lastEvent<ChessState>(harness, 'chess:state').payload;
    const [move] = repository.listMoves('board');

    expect(state.fen).toContain(' b ');
    expect(state.players).toEqual({
      white: 'guest-ada',
      black: 'guest-grace'
    });
    expect(move).toMatchObject({
      spaceId: 'board',
      participantId: 'guest-ada',
      from: 'e2',
      to: 'e4',
      san: 'e4'
    });
    expect(harness.emitted.some((event) => event.type === 'space:state')).toBe(true);
  });

  it('loads persisted games with stable player roles', () => {
    const repository = createMemoryRepository([
      {
        spaceId: 'board',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        pgn: '1. e4 e5',
        players: {
          white: 'stable-ada',
          black: 'stable-grace'
        },
        status: 'white to move',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    const ada = participant('stable-ada', 'Ada');
    const grace = participant('stable-grace', 'Grace');
    const harness = createHarness([ada, grace]);
    const app = createChessApp({ repository });

    const state = app.getInitialState(harness.contextFor(ada)) as ChessState;

    expect(state.players).toEqual({
      white: 'stable-ada',
      black: 'stable-grace'
    });
    expect(state.fen).toContain(' w ');
  });
});
