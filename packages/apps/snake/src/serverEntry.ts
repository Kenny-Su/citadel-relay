import type { ServerAppBundle, ServerAppServices } from '@citadel/platform/server-app';
import { snakeManifest } from './manifest.js';
import { createSnakeApp } from './server.js';

export const snakeServerBundle = {
  appId: snakeManifest.appId,
  createServerApp(_services) {
    return createSnakeApp();
  }
} satisfies ServerAppBundle<ServerAppServices>;

export function createSnakeServerAppFromServices(services: ServerAppServices) {
  return snakeServerBundle.createServerApp(services);
}
