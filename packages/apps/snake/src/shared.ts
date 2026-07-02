export type SnakeDirection = 'up' | 'down' | 'left' | 'right';
export type SnakeStage = 'waiting' | 'playing';

export type SnakeSegment = {
  x: number;
  y: number;
};

export type SnakePlayer = {
  participantId: string;
  name: string;
  body: SnakeSegment[];
  direction: SnakeDirection;
  alive: boolean;
  ready: boolean;
  score: number;
  color: string;
};

export type SnakeState = {
  stage: SnakeStage;
  width: number;
  height: number;
  food: SnakeSegment;
  snakes: SnakePlayer[];
  requiredReadyCount: number;
  readyCount: number;
  spectatorCount: number;
  tick: number;
};

export type SnakeDirectionPayload = {
  direction: SnakeDirection;
};

export type SnakeReadyPayload = {
  ready?: boolean;
};
