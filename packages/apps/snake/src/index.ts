import type { AppPackageDescriptor } from '@citadel/platform/app';
import { snakeManifest } from './manifest.js';

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

export const snakeAppPackage = {
  appId: snakeManifest.appId,
  manifest: snakeManifest,
  packageName: '@citadel/app-snake',
  capabilities: {
    legacyServices: []
  },
  client: {
    subpath: './client',
    registrationExport: 'snakeClientRegistration'
  },
  server: {
    subpath: './server',
    registrationExport: 'snakeServerRegistration'
  }
} satisfies AppPackageDescriptor;
