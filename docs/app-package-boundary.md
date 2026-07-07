# App Package Boundary

Citadel apps live in separate package repositories. The host wires selected installed app packages through a generated catalog, so new apps can be built and released without changing host or platform source.

For task-oriented guides, see [Adding Apps](adding-apps.md) for host owners, [Developing Apps](developing-apps.md) for app authors, and [Developing The Platform](developing-platform.md) for platform maintainers.

## Installed App Contract

Each app package exposes three public surfaces:

- package root (`.`): neutral app descriptor, manifest, constants, and shared types only.
- `./client`: browser client registration, `ClientAppModule`, and view wiring.
- `./server`: server registration, bundle, persistence adapters, and server-only exports.

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

The package root descriptor must mirror `package.json#citadel`. App repos should run `citadel-generate-app-metadata --package-dir .` in `prebuild` and `pretypecheck` to generate package-local runtime constants from that metadata.

## Host Integration

The platform host selects apps by installed package name in `bundled-apps.json`. Every package named there must already resolve from `node_modules`. The default host in this repo has no apps installed and uses an empty package list.

To add an app to a host:

1. Add the app package as a dependency.
2. Add its package name to `bundled-apps.json`.
3. Run `npm install`.
4. Run `npm run generate:bundled-apps`.

`scripts/generate-bundled-apps.mjs` validates package names, installed package metadata, package exports, root descriptors, and configured client/server registration exports. It then writes `src/bundledApps/generatedAppCatalog.ts`, the only static bridge from the host to configured app packages.

Runtime app definitions, client registries, and server registries derive from `src/bundledApps/catalog.ts`; handwritten host code should not import concrete app packages directly.

## Platform Exports

Apps import platform APIs through package-facing exports:

- `@citadel-platform/platform/app`: neutral app metadata, installed catalog entry types, app ids, participants, space helpers, and shared platform payload types.
- `@citadel-platform/platform/client`: browser app contracts.
- `@citadel-platform/platform/server-app`: server app contracts and shared platform server services.
- `@citadel-platform/platform/persistence`: persistence APIs available to app repositories.
- `@citadel-platform/platform/server`: host server runtime.
- `@citadel-platform/platform/validation`: platform validation helpers.

The platform package artifact includes only `dist` plus `package.json`. The platform source lives in its own repository and this host consumes the artifact from `vendor/citadel-platform/platform` as a local `file:` dependency.

## App Repo Starter Shape

A typical app repo contains:

- `src/index.ts` for manifest, descriptor, constants, and shared type exports.
- `src/client.tsx` for the `ClientAppRegistration` and React view wiring.
- `src/server.ts` for the `ServerAppRegistration` and app-owned server service adapters.
- App-owned modules such as state machines, repositories, validation, and tests.
- Package scripts for `build`, `typecheck`, and `test`.

Apps own their domain behavior. Stages and rules such as lobbies, readiness, turns, match state, typing, checkmate, scoring, or persistence tables belong inside app repos, not platform contracts or host registries.

## Import Rules

- Platform core imports only platform contracts and generic server modules.
- Platform core must not import concrete app packages or app internals.
- `bundled-apps.json` declares installed app package names only.
- The generated catalog is the only host file that imports configured app package client/server registration surfaces.
- Neutral app package roots must not import client views, server bundles, repositories, stores, or implementation factories.
- App client code must not import server entrypoints, repositories, stores, or `node:*` modules.
- App server entrypoints must not import React views or app client modules.
- Server-side platform code must not import `clientAppContract`, and client-side platform code must not import `serverAppContract`.
- Shared server service contracts must not mention concrete app repositories, enabled-app config, or app-specific options.

## Current Defaults

App ids are open strings validated by syntax in the platform and by installed catalog membership in the host. The checked-in host starts with `bundled-apps.json` set to an empty package list. Apps share one SQLite database by default when installed, and each app owns its own tables or live state. Adding or changing apps is install-time composition: install packages, regenerate the catalog, and rebuild the host. Runtime plugin loading is out of scope for this phase.
