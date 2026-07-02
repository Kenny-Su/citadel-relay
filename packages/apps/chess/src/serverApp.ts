import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import type { Participant } from '@citadel/platform/app';
import type { ServerAppModule } from '@citadel/platform/server-app';
import type { ChessColor, ChessMovePayload, ChessState } from './shared.js';
import type { ChessRepository } from './repository.js';

type ChessSpaceState = {
  game: Chess;
  players: {
    white?: string;
    black?: string;
  };
  pgn: string;
};

export type ChessAppOptions = {
  repository: ChessRepository;
};

type ChessContext = Parameters<ServerAppModule['getInitialState']>[0];

function getOrCreateState(context: ChessContext, repository: ChessRepository) {
  const existing = context.getAppState<ChessSpaceState>();

  if (existing) {
    return existing;
  }

  const savedGame = repository.getGame(context.spaceId);
  const game = savedGame ? new Chess(savedGame.fen) : new Chess();
  const state: ChessSpaceState = {
    game,
    players: savedGame?.players ?? {},
    pgn: savedGame?.pgn ?? ''
  };
  context.setAppState(state);
  return state;
}

function assignPlayers(state: ChessSpaceState, participants: Participant[]) {
  for (const participant of participants) {
    if (!state.players.white) {
      state.players.white = participant.id;
      continue;
    }

    if (!state.players.black && state.players.white !== participant.id) {
      state.players.black = participant.id;
    }
  }
}

function getStatus(state: ChessSpaceState) {
  const turn: ChessColor = state.game.turn() === 'w' ? 'white' : 'black';
  let status = `${turn} to move`;

  if (state.game.isCheckmate()) {
    status = `checkmate: ${turn === 'white' ? 'black' : 'white'} wins`;
  } else if (state.game.isDraw()) {
    status = 'draw';
  } else if (state.game.isCheck()) {
    status = `${turn} is in check`;
  }

  return status;
}

function toClientState(state: ChessSpaceState): ChessState {
  const turn: ChessColor = state.game.turn() === 'w' ? 'white' : 'black';

  return {
    fen: state.game.fen(),
    turn,
    players: state.players,
    status: getStatus(state),
    pgn: state.game.pgn() || state.pgn
  };
}

function colorForParticipant(state: ChessSpaceState, participantId: string): ChessColor | null {
  if (state.players.white === participantId) {
    return 'white';
  }

  if (state.players.black === participantId) {
    return 'black';
  }

  return null;
}

function saveGame(repository: ChessRepository, context: Pick<ChessContext, 'spaceId'>, state: ChessSpaceState) {
  repository.saveGame({
    spaceId: context.spaceId,
    fen: state.game.fen(),
    pgn: state.game.pgn() || state.pgn,
    players: state.players,
    status: getStatus(state),
    updatedAt: new Date().toISOString()
  });
}

export function createChessApp(options: ChessAppOptions): ServerAppModule {
  return {
    appId: 'chess',
    getInitialState(context) {
      const state = getOrCreateState(context, options.repository);
      assignPlayers(state, context.participants);
      saveGame(options.repository, context, state);
      return toClientState(state);
    },
    handleEvent(context, event) {
      const state = getOrCreateState(context, options.repository);
      assignPlayers(state, context.participants);
      saveGame(options.repository, context, state);

      if (event.type !== 'chess:move') {
        return;
      }

      const color = colorForParticipant(state, context.participant.id);

      if (!color) {
        context.emitToParticipant('chess:notice', { message: 'Spectators cannot move pieces.' });
        return;
      }

      if ((state.game.turn() === 'w' ? 'white' : 'black') !== color) {
        context.emitToParticipant('chess:notice', { message: 'Wait for your turn.' });
        return;
      }

      const payload = (event.payload ?? {}) as ChessMovePayload;
      const move = state.game.move({
        from: payload.from,
        to: payload.to,
        promotion: payload.promotion ?? 'q'
      });

      if (!move) {
        context.emitToParticipant('chess:notice', { message: 'Illegal move.' });
        return;
      }

      state.pgn = state.game.pgn();
      const createdAt = new Date().toISOString();
      options.repository.appendMove({
        id: nanoid(),
        spaceId: context.spaceId,
        participantId: context.participant.id,
        move: payload,
        san: move.san,
        fenAfter: state.game.fen(),
        createdAt
      });
      saveGame(options.repository, context, state);
      context.emitToSpace('chess:state', toClientState(state));
      context.emitSpaceState();
    },
    onParticipantJoined(context) {
      const state = getOrCreateState(context, options.repository);
      assignPlayers(state, context.participants);
      saveGame(options.repository, context, state);
    },
    onParticipantLeft(context) {
      const state = getOrCreateState(context, options.repository);
      context.emitToSpace('chess:state', toClientState(state));
    }
  };
}
