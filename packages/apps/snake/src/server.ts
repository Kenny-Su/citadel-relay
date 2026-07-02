import type { ServerAppBundle, ServerAppRegistration, ServerAppServices } from '@citadel/platform/server-app';
import { snakeManifest } from './manifest.js';
import { createSnakeApp } from './serverApp.js';

export const snakeServerBundle = {
  appId: snakeManifest.appId,
  createServerApp(_services) {
    return createSnakeApp();
  }
} satisfies ServerAppBundle<ServerAppServices>;

export function createSnakeServerAppFromServices(services: ServerAppServices) {
  return snakeServerBundle.createServerApp(services);
}

export const snakeServerRegistration = {
  appId: snakeServerBundle.appId,
  bundle: snakeServerBundle,
  createServerApp: createSnakeServerAppFromServices
} satisfies ServerAppRegistration<ServerAppServices>;
