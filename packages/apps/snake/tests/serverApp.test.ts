import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEventEnvelope, Participant } from '@citadel/platform/app';
import type { ServerAppContext } from '@citadel/platform/server-app';
import { createSnakeApp } from '../src/serverApp.js';
import type { SnakeState } from '../src/shared.js';

type EmittedEvent = {
  type: string;
  payload: unknown;
};

type SnakeHarness = {
  participants: Participant[];
  emitted: EmittedEvent[];
  appState: unknown;
  contextFor(participant: Participant): ServerAppContext;
};

function participant(id: string, name: string): Participant {
  return { id, name };
}

function createHarness(initialParticipants: Participant[] = []): SnakeHarness {
  const harness: SnakeHarness = {
    participants: [...initialParticipants],
    emitted: [],
    appState: undefined,
    contextFor(currentParticipant) {
      return {
        appId: 'snake',
        spaceId: 'arena',
        socketId: `socket-${currentParticipant.id}`,
        participant: currentParticipant,
        participants: harness.participants,
        emitToSpace(type, payload) {
          harness.emitted.push({ type, payload });
        },
        emitToParticipant(type, payload) {
          harness.emitted.push({ type, payload });
        },
        emitSpaceState() {},
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

function lastSnakeState(harness: SnakeHarness) {
  const event = harness.emitted.at(-1);
  expect(event?.type).toBe('snake:state');
  return event?.payload as SnakeState;
}

function readyEvent(): AppEventEnvelope {
  return {
    appId: 'snake',
    type: 'snake:ready'
  };
}

function directionEvent(direction: 'up' | 'down' | 'left' | 'right'): AppEventEnvelope {
  return {
    appId: 'snake',
    type: 'snake:direction',
    payload: { direction }
  };
}

describe('snake server app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in a waiting stage with the first participant as an active player', () => {
    const app = createSnakeApp();
    const ada = participant('guest-ada', 'Ada');
    const harness = createHarness([ada]);

    const state = app.getInitialState(harness.contextFor(ada)) as SnakeState;

    expect(state).toMatchObject({
      stage: 'waiting',
      readyCount: 0,
      requiredReadyCount: 2,
      spectatorCount: 0,
      tick: 0
    });
    expect(state.snakes.map((snake) => snake.participantId)).toEqual(['guest-ada']);
    expect(state.snakes[0].ready).toBe(false);
  });

  it('ignores direction changes until both active players are ready', () => {
    const app = createSnakeApp();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const harness = createHarness([ada, grace]);

    app.onParticipantJoined?.(harness.contextFor(ada));
    app.onParticipantJoined?.(harness.contextFor(grace));
    app.handleEvent(harness.contextFor(ada), directionEvent('down'));

    const waitingState = lastSnakeState(harness);

    expect(waitingState.stage).toBe('waiting');
    expect(waitingState.snakes.find((snake) => snake.participantId === 'guest-ada')?.direction).toBe('right');
  });

  it('enters playing after both active players are ready and starts ticking', () => {
    const app = createSnakeApp();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const harness = createHarness([ada, grace]);

    app.onParticipantJoined?.(harness.contextFor(ada));
    app.onParticipantJoined?.(harness.contextFor(grace));
    app.handleEvent(harness.contextFor(ada), readyEvent());

    expect(lastSnakeState(harness)).toMatchObject({
      stage: 'waiting',
      readyCount: 1
    });

    app.handleEvent(harness.contextFor(grace), readyEvent());

    expect(lastSnakeState(harness)).toMatchObject({
      stage: 'playing',
      readyCount: 2
    });

    vi.advanceTimersByTime(220);

    expect(lastSnakeState(harness)).toMatchObject({
      stage: 'playing',
      tick: 1
    });
  });

  it('keeps later participants as spectators that cannot ready or steer snakes', () => {
    const app = createSnakeApp();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const linus = participant('guest-linus', 'Linus');
    const harness = createHarness([ada, grace, linus]);

    app.onParticipantJoined?.(harness.contextFor(ada));
    app.onParticipantJoined?.(harness.contextFor(grace));
    app.onParticipantJoined?.(harness.contextFor(linus));

    const spectatorState = lastSnakeState(harness);
    expect(spectatorState).toMatchObject({
      stage: 'waiting',
      readyCount: 0,
      spectatorCount: 1
    });
    expect(spectatorState.snakes.map((snake) => snake.participantId)).toEqual(['guest-ada', 'guest-grace']);

    const emittedBeforeSpectatorReady = harness.emitted.length;
    app.handleEvent(harness.contextFor(linus), readyEvent());
    expect(harness.emitted).toHaveLength(emittedBeforeSpectatorReady);

    app.handleEvent(harness.contextFor(ada), readyEvent());
    app.handleEvent(harness.contextFor(grace), readyEvent());

    const emittedBeforeSpectatorDirection = harness.emitted.length;
    app.handleEvent(harness.contextFor(linus), directionEvent('down'));
    expect(harness.emitted).toHaveLength(emittedBeforeSpectatorDirection);
  });

  it('resets to waiting and promotes remaining participants when an active player leaves', () => {
    const app = createSnakeApp();
    const ada = participant('guest-ada', 'Ada');
    const grace = participant('guest-grace', 'Grace');
    const linus = participant('guest-linus', 'Linus');
    const harness = createHarness([ada, grace, linus]);

    app.onParticipantJoined?.(harness.contextFor(ada));
    app.onParticipantJoined?.(harness.contextFor(grace));
    app.onParticipantJoined?.(harness.contextFor(linus));
    app.handleEvent(harness.contextFor(ada), readyEvent());
    app.handleEvent(harness.contextFor(grace), readyEvent());

    expect(lastSnakeState(harness).stage).toBe('playing');

    harness.participants = [ada, linus];
    app.onParticipantLeft?.(harness.contextFor(ada));

    const resetState = lastSnakeState(harness);
    expect(resetState).toMatchObject({
      stage: 'waiting',
      readyCount: 0,
      spectatorCount: 0,
      tick: 0
    });
    expect(resetState.snakes.map((snake) => snake.participantId)).toEqual(['guest-ada', 'guest-linus']);
    expect(resetState.snakes.every((snake) => !snake.ready)).toBe(true);

    vi.advanceTimersByTime(500);

    expect(lastSnakeState(harness)).toMatchObject({
      stage: 'waiting',
      tick: 0
    });
  });
});
