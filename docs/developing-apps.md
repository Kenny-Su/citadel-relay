# Developing Apps For Citadel

Citadel apps are independent local packages or trusted extension zips. They depend on the local `@citadel-platform/platform` SDK, expose a small public contract, and own all app-specific UI, events, state, validation, and persistence.

## Scaffold A New App

Use `create-citadel-app` to start from a working package:

```bash
npm create citadel-app@latest poker
cd citadel-app-poker
npm install
npm run build
npm test
```

For local development from this repository before the generator is published:

```bash
node ../create-citadel-app/bin/create-citadel-app.js poker
```

## Repository Shape

A typical app repo looks like this:

```text
citadel-app-demo/
  package.json
  tsconfig.json
  src/
    generatedMetadata.ts
    index.ts
    client.tsx
    server.ts
    validation.ts
    state.ts
    server.test.ts
```

`src/generatedMetadata.ts` is generated from `package.json#citadel` by `citadel-generate-app-metadata`.

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
  "dependencies": {
    "@citadel-platform/platform": "file:../citadel-host/vendor/citadel-platform/platform"
  },
  "scripts": {
    "prebuild": "citadel-generate-app-metadata --package-dir .",
    "pretypecheck": "citadel-generate-app-metadata --package-dir . --check",
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

The package root should export neutral metadata, constants, validation helpers, and shared types. It must not import React views, server bundles, repositories, or Node-only modules.

```ts
// src/index.ts
export { generatedAppPackage as demoAppPackage, generatedManifest as demoManifest } from './generatedMetadata.js';
export type DemoState = {
  count: number;
};
```

## Client Export

The client entrypoint exports a `ClientAppRegistration`. The view receives current participant data, current app state, and a `sendAppEvent` helper.

```tsx
// src/client.tsx
import type { ClientAppRegistration, AppViewProps } from '@citadel-platform/platform/client';
import { generatedManifest } from './generatedMetadata.js';
import type { DemoState } from './index.js';

function DemoView({ appState, sendAppEvent }: AppViewProps<DemoState>) {
  return (
    <button type="button" onClick={() => sendAppEvent('demo:increment')}>
      Count: {appState.count}
    </button>
  );
}

export const demoClientRegistration = {
  appId: generatedManifest.appId,
  clientApp: {
    appId: generatedManifest.appId,
    label: generatedManifest.label,
    defaultSpaceId: generatedManifest.defaultSpaceId,
    View: DemoView
  }
} satisfies ClientAppRegistration<DemoState>;
```

## Server Export

The server entrypoint exports a `ServerAppRegistration`. The server module owns initial state and handles app events.

```ts
// src/server.ts
import type { ServerAppModule, ServerAppRegistration } from '@citadel-platform/platform/server-app';
import { generatedManifest } from './generatedMetadata.js';
import type { DemoState } from './index.js';

function createDemoServerApp(): ServerAppModule {
  return {
    appId: generatedManifest.appId,
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
  appId: generatedManifest.appId,
  bundle: {
    appId: generatedManifest.appId,
    createServerApp: createDemoServerApp
  },
  createServerApp: createDemoServerApp
} satisfies ServerAppRegistration<unknown>;
```

## Persistence

For SQLite-backed apps, import persistence helpers from `@citadel-platform/platform/persistence` and keep tables app-owned. Do not add app tables or repositories to the host or platform package. The host passes the shared database through server app services.

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
