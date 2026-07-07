# Developing Apps For Citadel

Citadel apps are independent local packages or trusted extension zips. They follow the host's documented metadata and module protocol, and own all app-specific UI, events, state, validation, and persistence.

## Repository Shape

A typical app repo looks like this:

```text
citadel-app-demo/
  package.json
  tsconfig.json
  src/
    index.ts
    client.tsx
    server.ts
    validation.ts
    state.ts
    server.test.ts
```

The host does not require app packages to depend on a Citadel SDK. App authors may define local TypeScript types that mirror this protocol, but runtime compatibility is determined by `package.json#citadel` and the exported module shapes.

## Package Metadata

Declare the app contract in `package.json`:

```json
{
  "name": "@your-scope/citadel-app-demo",
  "version": "0.1.0",
  "type": "module",
  "peerDependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./client": {
      "types": "./dist/client.d.ts",
      "import": "./dist/client.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js"
    }
  },
  "files": [
    "dist",
    "package.json"
  ],
  "citadel": {
    "appId": "demo",
    "label": "Demo",
    "defaultSpaceId": "general",
    "persistence": "none",
    "version": "0.1.0",
    "client": {
      "subpath": "./client",
      "registrationExport": "demoClientRegistration"
    },
    "server": {
      "subpath": "./server",
      "registrationExport": "demoServerRegistration"
    }
  }
}
```

Use `persistence: "sqlite"` when the app owns SQLite tables through the host database. Use `persistence: "none"` for live-only state.

## Root Export

The package root may export neutral app constants, validation helpers, and shared types. It must not import React views, server bundles, repositories, or Node-only modules. The host reads app identity and entrypoint details from `package.json#citadel`, not from a generated root descriptor.

```ts
// src/index.ts
export type DemoState = {
  count: number;
};

export const demoEvents = {
  increment: 'demo:increment'
} as const;
```

## Client Export

The client entrypoint exports the configured registration name. The view receives current participant data, current app state, and host helpers.

```tsx
// src/client.tsx
import type { DemoState } from './index.js';

type AppViewProps<TState = unknown> = {
  currentParticipant: { id: string; socketId?: string; name: string };
  spaceId: string;
  participants: Array<{ id: string; socketId?: string; name: string }>;
  appState: TState;
  sendAppEvent(type: string, payload?: unknown): void;
  setNotice(message: string): void;
};

function DemoView({ appState, sendAppEvent }: AppViewProps<DemoState>) {
  return (
    <button type="button" onClick={() => sendAppEvent('demo:increment')}>
      Count: {appState.count}
    </button>
  );
}

export const demoClientRegistration = {
  appId: 'demo',
  clientApp: {
    appId: 'demo',
    label: 'Demo',
    defaultSpaceId: 'general',
    View: DemoView
  }
};
```

## Server Export

The server entrypoint exports the configured registration name. The export may be a factory, a registration object with `createServerApp`, or a server module with `getInitialState` and `handleEvent`.

```ts
// src/server.ts
import type { DemoState } from './index.js';

function createDemoServerApp() {
  return {
    appId: 'demo',
    getInitialState(context) {
      return context.getAppState<DemoState>() ?? { count: 0 };
    },
    handleEvent(context, event) {
      if (event.type !== 'demo:increment') {
        return;
      }

      const current = context.getAppState<DemoState>() ?? { count: 0 };
      context.setAppState<DemoState>({ count: current.count + 1 });
      context.emitSpaceState();
    }
  };
}

export const demoServerRegistration = {
  appId: 'demo',
  createServerApp: createDemoServerApp
};
```

The server context includes `appId`, `spaceId`, `socketId`, `participant`, `participants`, `emitToSpace`, `emitToParticipant`, `emitSpaceState`, `getAppState`, `setAppState`, and `clearAppState`.

## Persistence

For SQLite-backed apps, use the database service passed to `createServerApp(services)`. Apps own their tables and repositories. Do not add app tables or repositories to the host.

## Local Host Testing

During app development, build or pack the app, install it into a host from a local path, add it to `bundled-apps.json`, and regenerate:

```bash
# in the app repo
npm run build
npm pack

# in the host repo
npm install ../citadel-app-demo/your-scope-citadel-app-demo-0.1.0.tgz
```

Then edit `bundled-apps.json`:

```json
{
  "packages": [
    "@your-scope/citadel-app-demo"
  ]
}
```

Regenerate and run the host:

```bash
npm run generate:bundled-apps
npm run dev
```

## Extension Zip Testing

For runtime installation, build a browser-ready client bundle and Node ESM server module, then zip them with `package.json`. The package metadata must include `citadel.client.bundle` and `citadel.server.module`:

```json
{
  "citadel": {
    "appId": "demo",
    "label": "Demo",
    "defaultSpaceId": "general",
    "persistence": "none",
    "version": "0.1.0",
    "client": {
      "bundle": "client.js"
    },
    "server": {
      "module": "server.js"
    }
  }
}
```

Upload the zip from the host UI and restart the host after the installer reports success.

## Release Checklist

- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm pack --dry-run`
- Install the packed tarball into a host from a local path and run `npm run generate:bundled-apps`
- Build and upload an extension zip when testing runtime installation
