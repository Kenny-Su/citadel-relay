# App Package Boundary

Citadel apps are still local source folders today, but their public surfaces should look like future packages. That keeps the eventual package split mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- `src/apps/<app>/index.ts`: neutral metadata and shared types only.
- `src/apps/<app>/client.tsx`: browser `ClientAppModule` and view wiring.
- `src/apps/<app>/serverEntry.ts`: server bundle, repository resolver, and server-only exports.

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

Compatibility shims such as `src/server/messageStore.ts` and focused repository tests may still import implementation files directly. Those are compatibility and implementation-test boundaries, not platform runtime wiring.

## Current Defaults

App ids remain a closed `AppId` union. Apps share one SQLite database by default, and each app owns its own tables or live state. This document does not introduce runtime plugin loading or a package split.
