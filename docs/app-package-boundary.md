# App Package Boundary

Citadel apps now own their implementation source in workspace package folders, while the platform shell still wires them as bundled apps. Their public surfaces should stay package-shaped so the remaining split work stays mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- `packages/apps/<app>/src/index.ts`: neutral metadata and shared types only.
- `packages/apps/<app>/src/client.tsx`: browser `ClientAppModule` and view wiring.
- `packages/apps/<app>/src/serverEntry.ts`: server bundle, repository resolver, and server-only exports.

Bundled app order and host assembly are owned by `src/bundledApps`. Client and server registries derive their ordered app lists from that neutral bundled catalog.

Platform contracts are split by environment:

- `src/platform/appContract.ts`: neutral app metadata such as `AppManifest`.
- `src/platform/clientAppContract.ts`: browser view contracts such as `AppViewProps` and `ClientAppModule`.
- `src/platform/serverAppContract.ts`: server runtime contracts such as `ServerAppContext`, `ServerAppModule`, and `ServerAppBundle`.

Bundled apps import platform APIs through small app-facing facades. These are the future package-facing platform exports:

- `src/platform/app.ts`: neutral app metadata, app ids, participants, space helpers, and shared platform payload types.
- `src/platform/client.ts`: browser app contracts.
- `src/platform/serverApp.ts`: server app contracts and shared platform server services.
- `src/platform/persistence.ts`: persistence APIs intentionally available to app repositories.

The current repo uses package-shaped aliases for the split:

- `@citadel/platform/app`, `@citadel/platform/client`, `@citadel/platform/server-app`, and `@citadel/platform/persistence`.
- `@citadel/apps/catalog`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` with `./client` and `./server` surfaces.
- `@citadel/apps/<app>`, `@citadel/apps/<app>/client`, and `@citadel/apps/<app>/server` remain as temporary compatibility aliases.

Workspace packages exist under `packages/` as the scaffold for the source split. They expose thin TypeScript entrypoints:

- `@citadel/platform` owns its source under `packages/platform/src` and exports `./app`, `./client`, `./server-app`, and `./persistence`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` export `.`, `./client`, and `./server`.

Temporary `src/platform/*` files remain as compatibility shims while the server/client shell code migrates to package imports.
All bundled apps are source-owning workspace packages: their implementations live under `packages/apps/<app>/src`, with `src/apps/<app>/*` left as temporary compatibility shims.
Temporary `src/apps/catalog.ts`, `src/apps/serverRegistry.ts`, and `src/apps/serverServices.ts` remain as compatibility shims while host code migrates to `src/bundledApps`.

Shared server app services stay platform-only in `src/apps/serverServices.ts`. App-specific server options, such as repository injection or chat rate limits, belong to each app server entrypoint or to the bundled registry adapter.

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
- Platform implementation lives in `packages/platform/src`; compatibility files under `src/platform` must stay thin re-export shims.
- Bundled app assembly lives in `src/bundledApps`; compatibility files under `src/apps` must not contain host registry logic.
- App package shell entrypoints stay thin re-export shims to package-local source once each app moves.
- App compatibility files under `src/apps/<app>` must stay thin re-export shims after that app owns package source.
- App client code must not import server entrypoints, repositories, message stores, or `node:*` modules.
- App server entrypoints must not import React views or app client modules.
- Server-side code must not import `clientAppContract`, and client-side code must not import `serverAppContract`.
- Shared server service contracts must not mention concrete app repositories, enabled-app config, or app-specific options.

Compatibility shims such as `src/server/messageStore.ts` and focused repository tests may still import implementation files directly. Those are compatibility and implementation-test boundaries, not platform runtime wiring.

## Current Defaults

App ids remain a closed `AppId` union. Apps share one SQLite database by default, and each app owns its own tables or live state. This document does not introduce runtime plugin loading or a package split.
