import type { ServerAppBundle } from '../../platform/serverAppContract.js';
import type { ServerAppServices } from '../serverServices.js';
import { snakeManifest } from './manifest.js';
import { createSnakeApp } from './server.js';

export const snakeServerBundle = {
  appId: snakeManifest.appId,
  createServerApp(_services) {
    return createSnakeApp();
  }
} satisfies ServerAppBundle<ServerAppServices>;
