import React from 'react';
import type { AppViewProps } from '@citadel/platform/client';
import type { SnakeDirection, SnakeState } from './shared.js';

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
  );
}
