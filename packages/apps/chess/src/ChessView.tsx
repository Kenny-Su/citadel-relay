import React from 'react';
import type { AppViewProps } from '@citadel/platform/client';
import type { ChessState } from './shared.js';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
const pieces: Record<string, string> = {
  p: '♟',
  r: '♜',
  n: '♞',
  b: '♝',
  q: '♛',
  k: '♚',
  P: '♙',
  R: '♖',
  N: '♘',
  B: '♗',
  Q: '♕',
  K: '♔'
};
const CHESS_VIEW_STYLES = `
.game-surface {
  align-items: center;
  display: grid;
  gap: 16px;
  justify-items: center;
  min-height: 0;
  overflow: auto;
  padding: 22px 24px;
}

.game-status,
.game-meta {
  align-items: center;
  color: #4e5c54;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
}

.game-status strong {
  color: #1f2a24;
}

.chess-board {
  aspect-ratio: 1;
  border: 1px solid #244238;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  width: min(68vh, 560px, 100%);
}

.chess-square {
  align-items: center;
  aspect-ratio: 1;
  border-radius: 0;
  color: #18211c;
  display: flex;
  font-size: clamp(1.5rem, 5vw, 3rem);
  justify-content: center;
  min-height: 0;
  padding: 0;
}

.chess-square.light {
  background: #f1ead8;
}

.chess-square.dark {
  background: #7d9b8d;
}

.chess-square.selected {
  box-shadow: inset 0 0 0 4px #d89b24;
}
`;

function boardFromFen(fen: string) {
  const board = fen.split(' ')[0] ?? '';

  return board.split('/').map((rank) => {
    const squares: string[] = [];

    for (const char of rank) {
      const emptyCount = Number(char);

      if (Number.isInteger(emptyCount)) {
        squares.push(...Array.from({ length: emptyCount }, () => ''));
      } else {
        squares.push(char);
      }
    }

    return squares;
  });
}

export function ChessView({
  currentParticipant,
  participants,
  appState,
  sendAppEvent,
  setNotice
}: AppViewProps<ChessState>) {
  const [selected, setSelected] = React.useState('');
  const [state, setState] = React.useState(appState);

  React.useEffect(() => {
    setState(appState);
  }, [appState]);

  React.useEffect(() => {
    function handleAppEvent(rawEvent: Event) {
      const event = (rawEvent as CustomEvent).detail;

      if (event.type === 'chess:state') {
        setState(event.payload as ChessState);
      }

      if (event.type === 'chess:notice') {
        setNotice((event.payload as { message: string }).message);
      }
    }

    window.addEventListener('citadel:app-event', handleAppEvent);

    return () => {
      window.removeEventListener('citadel:app-event', handleAppEvent);
    };
  }, [setNotice]);

  function participantName(id?: string) {
    return participants.find((participant) => participant.id === id)?.name ?? 'Waiting';
  }

  function handleSquareClick(square: string) {
    if (!selected) {
      setSelected(square);
      return;
    }

    sendAppEvent('chess:move', { from: selected, to: square, promotion: 'q' });
    setSelected('');
  }

  const board = boardFromFen(state.fen);
  const role =
    state.players.white === currentParticipant.id
      ? 'White'
      : state.players.black === currentParticipant.id
        ? 'Black'
        : 'Spectator';

  return (
    <>
      <style>{CHESS_VIEW_STYLES}</style>
      <section className="game-surface" aria-label="Chess board">
        <div className="game-status">
          <strong>{state.status}</strong>
          <span>You are {role}</span>
        </div>
        <div className="chess-board">
          {ranks.map((rank, rankIndex) =>
            files.map((file, fileIndex) => {
              const square = `${file}${rank}`;
              const piece = board[rankIndex]?.[fileIndex] ?? '';

              return (
                <button
                  className={`chess-square ${(rankIndex + fileIndex) % 2 === 0 ? 'light' : 'dark'} ${
                    selected === square ? 'selected' : ''
                  }`}
                  key={square}
                  type="button"
                  onClick={() => handleSquareClick(square)}
                  aria-label={square}
                >
                  {pieces[piece] ?? ''}
                </button>
              );
            })
          )}
        </div>
        <div className="game-meta">
          <span>White: {participantName(state.players.white)}</span>
          <span>Black: {participantName(state.players.black)}</span>
        </div>
      </section>
    </>
  );
}
