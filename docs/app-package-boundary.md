# App Package Boundary

Citadel apps now own their implementation source in workspace package folders, while the platform shell still wires them as bundled apps. Their public surfaces should stay package-shaped so the remaining split work stays mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- `packages/apps/<app>/src/index.ts`: neutral metadata and shared types only.
- `packages/apps/<app>/src/client.tsx`: browser `ClientAppModule` and view wiring.
- `packages/apps/<app>/src/serverEntry.ts`: server bundle, repository resolver, and server-only exports.

Bundled app order and host assembly are owned by `src/bundledApps`. Client and server registries derive their ordered app lists from that neutral bundled catalog.

Platform contracts are split by environment inside `packages/platform/src`:

- `appContract.ts`: neutral app metadata such as `AppManifest`.
- `clientAppContract.ts`: browser view contracts such as `AppViewProps` and `ClientAppModule`.
- `serverAppContract.ts`: server runtime contracts such as `ServerAppContext`, `ServerAppModule`, and `ServerAppBundle`.

Bundled apps import platform APIs through small app-facing facades. These are the package-facing platform exports:

- `@citadel/platform/app`: neutral app metadata, app ids, participants, space helpers, and shared platform payload types.
- `@citadel/platform/client`: browser app contracts.
- `@citadel/platform/server-app`: server app contracts and shared platform server services.
- `@citadel/platform/persistence`: persistence APIs intentionally available to app repositories.
- `@citadel/platform/server`: host server runtime.
- `@citadel/platform/validation`: platform validation helpers.

The current repo uses package-shaped aliases for the split:

- `@citadel/platform/app`, `@citadel/platform/client`, `@citadel/platform/server-app`, and `@citadel/platform/persistence`.
- `@citadel/platform/server` and `@citadel/platform/validation`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` with `./client` and `./server` surfaces.

Workspace packages exist under `packages/` as the scaffold for the source split. They expose thin TypeScript entrypoints:

- `@citadel/platform` owns its source under `packages/platform/src` and exports `./app`, `./client`, `./server-app`, and `./persistence`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` export `.`, `./client`, and `./server`.

Shared platform payloads and SQLite persistence are platform-owned under `packages/platform/src`.
All bundled apps are source-owning workspace packages: their implementations live under `packages/apps/<app>/src`.

Shared server app services stay platform-only in `@citadel/platform/server-app`. App-specific server options, such as repository injection or chat rate limits, belong to each app server entrypoint or to the bundled registry adapter.

For example, a future package can map these to exports like:

```json
{
  ".": "./index.js",
  "./client": "./client.js",
  "./server": "./serverEntry.js"
}
```

## Import Rules

- Platform core imports only platform contracts and generic server modules. It must not import concrete app internals.
- The client registry imports app client entrypoints plus neutral shared types.
- The server registry imports neutral manifests plus app server entrypoints.
- Neutral app indexes do not export client modules, server bundles, repositories, repository resolvers, or implementation factories.
- App code imports platform contracts, shared platform helpers, and persistence APIs through `@citadel/platform/*` aliases rather than relative platform, shared, or persistence paths.
- Registries import bundled app public surfaces through `@citadel/app-*` package aliases rather than relative app entrypoint paths.
- Platform implementation lives in `packages/platform/src`; root `src/platform` compatibility shims are removed.
- Root shared and persistence compatibility shims are removed.
- Bundled app assembly lives in `src/bundledApps`; root `src/apps` compatibility shims are removed.
- App package shell entrypoints stay thin re-export shims to package-local source once each app moves.
- App client code must not import server entrypoints, repositories, message stores, or `node:*` modules.
- App server entrypoints must not import React views or app client modules.
- Server-side code must not import `clientAppContract`, and client-side code must not import `serverAppContract`.
- Shared server service contracts must not mention concrete app repositories, enabled-app config, or app-specific options.

Focused repository tests may still import server package surfaces directly. Runtime wiring should use host and package public entrypoints, not removed compatibility paths.

## Current Defaults

App ids remain a closed `AppId` union. Apps share one SQLite database by default, and each app owns its own tables or live state. This document does not introduce runtime plugin loading or a package split.
