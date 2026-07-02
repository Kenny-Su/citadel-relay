import type { Participant } from '@citadel/platform/app';
import type { ServerAppContext, ServerAppModule } from '@citadel/platform/server-app';
import type { SnakeDirection, SnakeDirectionPayload, SnakePlayer, SnakeReadyPayload, SnakeSegment, SnakeState } from './shared.js';

const WIDTH = 20;
const HEIGHT = 16;
const TICK_MS = 220;
const REQUIRED_READY_COUNT = 2;
const COLORS = ['#1f6f54', '#7c3aed', '#c2410c', '#0369a1', '#be123c', '#4d7c0f'];

type SnakeSpaceState = SnakeState & {
  timer?: NodeJS.Timeout;
};

const vectors: Record<SnakeDirection, SnakeSegment> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

function isOpposite(current: SnakeDirection, next: SnakeDirection) {
  return (
    (current === 'up' && next === 'down') ||
    (current === 'down' && next === 'up') ||
    (current === 'left' && next === 'right') ||
    (current === 'right' && next === 'left')
  );
}

function makeFood(snakes: SnakePlayer[]): SnakeSegment {
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if (!snakes.some((snake) => snake.body.some((segment) => segment.x === x && segment.y === y))) {
        return { x, y };
      }
    }
  }

  return { x: 1, y: 1 };
}

function spawnSnake(participant: Participant, index: number): SnakePlayer {
  const x = 3 + (index * 4) % (WIDTH - 6);
  const y = 3 + (index * 3) % (HEIGHT - 6);

  return {
    participantId: participant.id,
    name: participant.name,
    body: [
      { x, y },
      { x: x - 1, y },
      { x: x - 2, y }
    ],
    direction: 'right',
    alive: true,
    ready: false,
    score: 0,
    color: COLORS[index % COLORS.length]
  };
}

function publicState(state: SnakeSpaceState): SnakeState {
  return {
    stage: state.stage,
    width: state.width,
    height: state.height,
    food: state.food,
    snakes: state.snakes,
    requiredReadyCount: state.requiredReadyCount,
    readyCount: state.readyCount,
    spectatorCount: state.spectatorCount,
    tick: state.tick
  };
}

function getOrCreateState(context: Pick<ServerAppContext, 'getAppState' | 'setAppState'>) {
  const existing = context.getAppState<SnakeSpaceState>();

  if (existing) {
    return existing;
  }

  const state: SnakeSpaceState = {
    stage: 'waiting',
    width: WIDTH,
    height: HEIGHT,
    food: { x: 10, y: 8 },
    snakes: [],
    requiredReadyCount: REQUIRED_READY_COUNT,
    readyCount: 0,
    spectatorCount: 0,
    tick: 0
  };
  context.setAppState(state);
  return state;
}

function resetToWaiting(state: SnakeSpaceState) {
  state.stage = 'waiting';
  state.tick = 0;
  state.snakes = state.snakes.map((snake) => ({
    ...snake,
    ready: false
  }));
}

function refreshReadyCounts(state: SnakeSpaceState, participants: Participant[]) {
  state.requiredReadyCount = REQUIRED_READY_COUNT;
  state.readyCount = state.snakes.filter((snake) => snake.ready).length;
  state.spectatorCount = Math.max(0, participants.length - state.snakes.length);
}

function syncParticipants(state: SnakeSpaceState, participants: Participant[]) {
  const playerParticipants = participants.slice(0, REQUIRED_READY_COUNT);
  const playerIds = new Set(playerParticipants.map((participant) => participant.id));
  const previousPlayerIds = new Set(state.snakes.map((snake) => snake.participantId));
  const activePlayerLeft = state.snakes.some((snake) => !playerIds.has(snake.participantId));

  state.snakes = state.snakes.filter((snake) => playerIds.has(snake.participantId));

  for (const participant of playerParticipants) {
    if (!state.snakes.some((snake) => snake.participantId === participant.id)) {
      state.snakes.push(spawnSnake(participant, state.snakes.length));
    } else {
      const snake = state.snakes.find((candidate) => candidate.participantId === participant.id);

      if (snake) {
        snake.name = participant.name;
      }
    }
  }

  if (activePlayerLeft || state.snakes.some((snake) => !previousPlayerIds.has(snake.participantId))) {
    resetToWaiting(state);
  }

  refreshReadyCounts(state, participants);

  if (!state.food) {
    state.food = makeFood(state.snakes);
  }
}

function maybeStartGame(
  state: SnakeSpaceState,
  context: ServerAppContext,
  ensureTimer: (context: ServerAppContext) => void
) {
  refreshReadyCounts(state, context.participants);

  if (
    state.stage === 'waiting'
    && state.snakes.length === REQUIRED_READY_COUNT
    && state.readyCount === REQUIRED_READY_COUNT
  ) {
    state.stage = 'playing';
    ensureTimer(context);
  }
}

function advance(state: SnakeSpaceState) {
  state.tick += 1;

  for (const snake of state.snakes) {
    if (!snake.alive) {
      continue;
    }

    const vector = vectors[snake.direction];
    const head = snake.body[0];
    const next = { x: head.x + vector.x, y: head.y + vector.y };
    const hitWall = next.x < 0 || next.x >= WIDTH || next.y < 0 || next.y >= HEIGHT;
    const hitSnake = state.snakes.some((candidate) =>
      candidate.body.some((segment) => segment.x === next.x && segment.y === next.y)
    );

    if (hitWall || hitSnake) {
      snake.alive = false;
      continue;
    }

    snake.body.unshift(next);

    if (next.x === state.food.x && next.y === state.food.y) {
      snake.score += 1;
      state.food = makeFood(state.snakes);
    } else {
      snake.body.pop();
    }
  }
}

export function createSnakeApp(): ServerAppModule {
  const contextsBySpace = new Map<string, ServerAppContext>();

  function ensureTimer(context: ServerAppContext) {
    const state = getOrCreateState(context);

    if (state.stage !== 'playing' || state.timer) {
      return;
    }

    state.timer = setInterval(() => {
      const latestContext = contextsBySpace.get(context.spaceId);

      if (!latestContext) {
        return;
      }

      const latestState = getOrCreateState(latestContext);
      if (latestState.stage !== 'playing') {
        stopTimer(latestState);
        return;
      }

      advance(latestState);
      latestContext.emitToSpace('snake:state', publicState(latestState));
    }, TICK_MS);
  }

  function stopTimer(state: SnakeSpaceState | undefined) {
    if (state?.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }

  return {
    appId: 'snake',
    getInitialState(context) {
      const state = getOrCreateState(context);
      syncParticipants(state, context.participants);
      return publicState(state);
    },
    handleEvent(context, event) {
      contextsBySpace.set(context.spaceId, context);
      const state = getOrCreateState(context);
      syncParticipants(state, context.participants);

      if (event.type === 'snake:ready') {
        const payload = (event.payload ?? {}) as SnakeReadyPayload;
        const snake = state.snakes.find((candidate) => candidate.participantId === context.participant.id);

        if (!snake || state.stage !== 'waiting') {
          return;
        }

        snake.ready = payload.ready ?? true;
        maybeStartGame(state, context, ensureTimer);
        context.emitToSpace('snake:state', publicState(state));
        return;
      }

      if (event.type !== 'snake:direction' || state.stage !== 'playing') {
        return;
      }

      const payload = (event.payload ?? {}) as SnakeDirectionPayload;
      const snake = state.snakes.find((candidate) => candidate.participantId === context.participant.id);

      if (!snake || !payload.direction || !(payload.direction in vectors)) {
        return;
      }

      if (!isOpposite(snake.direction, payload.direction)) {
        snake.direction = payload.direction;
      }

      context.emitToSpace('snake:state', publicState(state));
    },
    onParticipantJoined(context) {
      contextsBySpace.set(context.spaceId, context);
      const state = getOrCreateState(context);
      syncParticipants(state, context.participants);
      maybeStartGame(state, context, ensureTimer);
      context.emitToSpace('snake:state', publicState(state));
    },
    onParticipantLeft(context) {
      const state = getOrCreateState(context);
      const previousStage = state.stage;
      syncParticipants(state, context.participants);

      if (context.participants.length === 0) {
        stopTimer(state);
        contextsBySpace.delete(context.spaceId);
      } else {
        contextsBySpace.set(context.spaceId, context);
        if (previousStage === 'playing' && state.stage === 'waiting') {
          stopTimer(state);
        }
      }

      context.emitToSpace('snake:state', publicState(state));
    }
  };
}
