import { generatedAppPackage } from './generatedMetadata.js';

export { snakeManifest } from './manifest.js';
export type {
  SnakeDirection,
  SnakeDirectionPayload,
  SnakePlayer,
  SnakeReadyPayload,
  SnakeSegment,
  SnakeStage,
  SnakeState
} from './shared.js';

export const snakeAppPackage = generatedAppPackage;
