import React from 'react';
import type { AppViewProps } from '@citadel/platform/client';
import type { SnakeDirection, SnakeState } from './shared.js';

const SNAKE_VIEW_STYLES = `
.game-surface {
  align-items: center;
  display: grid;
  gap: 16px;
  justify-items: center;
  min-height: 0;
  overflow: auto;
  padding: 22px 24px;
}

.game-status {
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

.snake-board {
  aspect-ratio: 20 / 16;
  background: #17201b;
  border: 1px solid #244238;
  display: grid;
  gap: 1px;
  width: min(76vh, 720px, 100%);
}

.snake-cell {
  background: #213028;
  min-width: 0;
}

.snake-cell.occupied {
  border-radius: 3px;
}

.snake-cell.food {
  background: #d89b24;
  border-radius: 999px;
}

.snake-lobby {
  align-items: center;
  color: #66756c;
  display: flex;
  justify-content: center;
  min-height: 42px;
}

.snake-controls {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(4, minmax(72px, 1fr));
  max-width: 420px;
  width: 100%;
}

@media (max-width: 720px) {
  .snake-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;

export function SnakeView({
  currentParticipant,
  appState,
  sendAppEvent
}: AppViewProps<SnakeState>) {
  const [state, setState] = React.useState(appState);

  React.useEffect(() => {
    setState(appState);
  }, [appState]);

  React.useEffect(() => {
    function handleAppEvent(rawEvent: Event) {
      const event = (rawEvent as CustomEvent).detail;

      if (event.type === 'snake:state') {
        setState(event.payload as SnakeState);
      }
    }

    window.addEventListener('citadel:app-event', handleAppEvent);

    return () => {
      window.removeEventListener('citadel:app-event', handleAppEvent);
    };
  }, []);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const directions: Record<string, SnakeDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right'
      };
      const direction = directions[event.key];

      if (direction) {
        event.preventDefault();
        sendAppEvent('snake:direction', { direction });
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sendAppEvent]);

  function directionButton(direction: SnakeDirection, label: string) {
    return (
      <button
        type="button"
        disabled={state.stage !== 'playing'}
        onClick={() => sendAppEvent('snake:direction', { direction })}
      >
        {label}
      </button>
    );
  }

  const mySnake = state.snakes.find((snake) => snake.participantId === currentParticipant.id);
  const isSpectator = !mySnake;
  const statusText = isSpectator
    ? 'Spectating'
    : state.stage === 'waiting'
      ? mySnake.ready
        ? 'Ready'
        : 'Waiting'
      : mySnake.alive === false
        ? 'You crashed'
        : 'Playing';

  return (
    <>
      <style>{SNAKE_VIEW_STYLES}</style>
      <section className="game-surface" aria-label="Snake arena">
        <div className="game-status">
          <strong>{statusText}</strong>
          <span>Score {mySnake?.score ?? 0}</span>
          <span>{state.readyCount}/{state.requiredReadyCount} ready</span>
          {state.spectatorCount > 0 ? <span>{state.spectatorCount} spectating</span> : null}
        </div>
        {state.stage === 'waiting' && (
          <div className="snake-lobby">
            {isSpectator ? (
              <span>Waiting for the two players to start.</span>
            ) : (
              <button
                type="button"
                onClick={() => sendAppEvent('snake:ready', { ready: !mySnake.ready })}
              >
                {mySnake.ready ? 'Cancel Ready' : 'Ready'}
              </button>
            )}
          </div>
        )}
        <div
          className="snake-board"
          style={{
            gridTemplateColumns: `repeat(${state.width}, 1fr)`,
            gridTemplateRows: `repeat(${state.height}, 1fr)`
          }}
        >
          {Array.from({ length: state.width * state.height }, (_, index) => {
            const x = index % state.width;
            const y = Math.floor(index / state.width);
            const snake = state.snakes.find((candidate) =>
              candidate.body.some((segment) => segment.x === x && segment.y === y)
            );
            const isFood = state.food.x === x && state.food.y === y;

            return (
              <div
                className={isFood ? 'snake-cell food' : snake ? 'snake-cell occupied' : 'snake-cell'}
                key={`${x}:${y}`}
                style={{ backgroundColor: snake?.color }}
              />
            );
          })}
        </div>
        <div className="snake-controls" aria-label="Snake controls">
          {directionButton('up', 'Up')}
          {directionButton('left', 'Left')}
          {directionButton('down', 'Down')}
          {directionButton('right', 'Right')}
        </div>
      </section>
    </>
  );
}
