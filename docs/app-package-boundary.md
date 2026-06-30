# App Package Boundary

Citadel apps are still local source folders today, but their public surfaces should look like future packages. That keeps the eventual package split mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- `src/apps/<app>/index.ts`: neutral metadata and shared types only.
- `src/apps/<app>/client.tsx`: browser `ClientAppModule` and view wiring.
- `src/apps/<app>/serverEntry.ts`: server bundle, repository resolver, and server-only exports.

Bundled app order and manifest lists are owned by `src/apps/catalog.ts`. Client and server registries derive their ordered app lists from that neutral catalog.

Platform contracts are split by environment:

- `src/platform/appContract.ts`: neutral app metadata such as `AppManifest`.
- `src/platform/clientAppContract.ts`: browser view contracts such as `AppViewProps` and `ClientAppModule`.
- `src/platform/serverAppContract.ts`: server runtime contracts such as `ServerAppContext`, `ServerAppModule`, and `ServerAppBundle`.

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
- App client code must not import server entrypoints, repositories, message stores, or `node:*` modules.
- App server entrypoints must not import React views or app client modules.
- Server-side code must not import `clientAppContract`, and client-side code must not import `serverAppContract`.
- Shared server service contracts must not mention concrete app repositories, enabled-app config, or app-specific options.

Compatibility shims such as `src/server/messageStore.ts` and focused repository tests may still import implementation files directly. Those are compatibility and implementation-test boundaries, not platform runtime wiring.

## Current Defaults

App ids remain a closed `AppId` union. Apps share one SQLite database by default, and each app owns its own tables or live state. This document does not introduce runtime plugin loading or a package split.
