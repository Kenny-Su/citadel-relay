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
  );
}
