# App Package Boundary

Citadel apps live in separate package repositories. The host wires selected installed app packages through a generated catalog, so new apps can be built and released without changing host source.

For task-oriented guides, see [Adding Apps](adding-apps.md) for host owners, [Developing Apps](developing-apps.md) for app authors, and [Developing The Host Platform](developing-platform.md) for host platform maintainers.

## Installed App Contract

Each app package exposes three public surfaces:

- package root (`.`): neutral constants, validation helpers, and shared types only.
- client entrypoint: browser client registration and React view wiring.
- server entrypoint: server registration, factory, persistence adapters, and server-only exports.

Each app package declares a `citadel` metadata block in `package.json`. That metadata is the discovery contract used by the host:

```json
{
  "citadel": {
    "appId": "demo",
    "label": "Demo",
    "defaultSpaceId": "general",
    "persistence": "sqlite",
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

Package exports should point at built JavaScript and declarations:

```json
{
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
  }
}
```

The host does not require a generated root descriptor. `package.json#citadel` is the source of truth for installed app identity and entrypoints.

## Host Integration

The host selects apps by installed package name in `bundled-apps.json`. Every package named there must already resolve from `node_modules`. The default host in this repo has no apps installed and uses an empty package list.

To add an app to a host:

1. Add the app package as a dependency.
2. Add its package name to `bundled-apps.json`.
3. Run `npm install`.
4. Run `npm run generate:bundled-apps`.

`scripts/generate-bundled-apps.mjs` validates package names, installed package metadata, package exports, and configured client/server runtime export shapes. It then writes `src/bundledApps/generatedAppCatalog.ts`, the only static bridge from the host to configured app packages.

Runtime app definitions, client registries, and server registries derive from `src/bundledApps/catalog.ts`; handwritten host code should not import concrete app packages directly.

## Host Platform Contract

The host owns platform contracts and runtime source under `src/platform`:

- `app`: neutral app metadata, installed catalog entry types, app ids, participants, space helpers, and shared platform payload types.
- `client`: browser app registration shape.
- `server-app`: server app context, module, factory, registration, and shared server services.
- `persistence`: SQLite database service available to server apps.
- `server`: Socket.IO/Express host runtime.
- `validation`: host validation helpers.

These modules are host-internal TypeScript source. External app compatibility is defined by documented metadata, module object shapes, and the Socket.IO protocol, not by importing a Citadel SDK.

## App Repo Starter Shape

A typical app repo contains:

- `src/index.ts` for constants, validation helpers, and shared type exports.
- `src/client.tsx` for the client registration and React view wiring.
- `src/server.ts` for the server registration/factory and app-owned server service adapters.
- App-owned modules such as state machines, repositories, validation, and tests.
- Package scripts for `build`, `typecheck`, and `test`.

Apps own their domain behavior. Stages and rules such as lobbies, readiness, turns, match state, typing, checkmate, scoring, or persistence tables belong inside app repos, not platform contracts or host registries.

## Import Rules

- Host platform code imports only platform contracts and generic server modules.
- Host platform code must not import concrete app packages or app internals.
- `bundled-apps.json` declares installed app package names only.
- The generated catalog is the only host file that imports configured app package client/server registration surfaces.
- Neutral app package roots must not import client views, server bundles, repositories, stores, or implementation factories.
- App client code must not import server entrypoints, repositories, stores, or `node:*` modules.
- App server entrypoints must not import React views or app client modules.
- Server-side platform code must not import client app view modules, and client-side platform code must not import server app modules.
- Shared server service contracts must not mention concrete app repositories, enabled-app config, or app-specific options.

## Current Defaults

App ids are open strings validated by syntax in the host platform and by installed catalog membership in the host. The checked-in host starts with `bundled-apps.json` set to an empty package list. Apps share one SQLite database by default when installed, and each app owns its own tables or live state. Adding or changing apps is install-time composition: install packages, regenerate the catalog, and rebuild the host.
