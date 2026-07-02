# App Package Boundary

Citadel apps now own their implementation source in workspace package folders, while the platform shell still wires them as bundled apps. Their public surfaces should stay package-shaped so the remaining split work stays mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- `packages/apps/<app>/src/index.ts`: neutral package descriptor, manifest, and shared types only.
- `packages/apps/<app>/src/client.tsx`: browser client registration, `ClientAppModule`, and view wiring.
- `packages/apps/<app>/src/serverEntry.ts`: server registration, bundle, repository resolver, and server-only exports.

Bundled app order is declared as installed package names in `bundled-apps.json`. Local app packages that need monorepo build/watch support are declared separately in `workspace-apps.json`; this is a development convenience, not runtime selection. Each app package declares a `citadel` metadata block in its `package.json`; that package manifest metadata is the app discovery contract. `src/bundledApps/config.ts` validates the selection data, and `src/bundledApps/generatedAppCatalog.ts` is the generated installed-app catalog that mirrors selected package metadata and imports selected client/server registrations. Handwritten client and server registries derive their ordered app lists from that catalog while keeping runtime behavior environment-specific.

Platform contracts are split by environment inside `packages/platform/src`:

- `appContract.ts`: neutral app metadata such as `AppManifest` and `AppPackageDescriptor`.
- `clientAppContract.ts`: browser view contracts such as `AppViewProps`, `ClientAppModule`, and `ClientAppRegistration`.
- `serverAppContract.ts`: server runtime contracts such as `ServerAppContext`, `ServerAppModule`, `ServerAppBundle`, and `ServerAppRegistration`.

Bundled apps import platform APIs through small app-facing facades. These are the package-facing platform exports:

- `@citadel/platform/app`: neutral app metadata, app ids, participants, space helpers, and shared platform payload types.
- `@citadel/platform/client`: browser app contracts.
- `@citadel/platform/server-app`: server app contracts and shared platform server services.
- `@citadel/platform/persistence`: persistence APIs intentionally available to app repositories.
- `@citadel/platform/server`: host server runtime.
- `@citadel/platform/validation`: platform validation helpers.

The current repo resolves package-shaped imports through installed workspace packages, currently linked into `node_modules` by npm workspaces:

- `@citadel/platform/app`, `@citadel/platform/client`, `@citadel/platform/server-app`, and `@citadel/platform/persistence`.
- `@citadel/platform/server` and `@citadel/platform/validation`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` with `./client` and `./server` surfaces.

Workspace packages exist under `packages/` as the current local development shape for the source split. They keep thin TypeScript entrypoints as package-local build inputs:

- `@citadel/platform` owns its source under `packages/platform/src` and exports `./app`, `./client`, `./server-app`, `./persistence`, `./server`, and `./validation`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` export `.`, `./client`, and `./server`.
- Each workspace package has a package-local no-emit TypeScript check. These checks prove package isolation without producing JavaScript or declarations.
- Each workspace package also has a local package build that emits JavaScript and declarations into its ignored `dist/` directory. Package `exports` point at those built artifacts, and the host consumes packages through workspace package resolution rather than source aliases.
- App package artifacts are built-package artifacts: npm pack allowlists `dist` plus `package.json`, so source files and TypeScript build configs are development inputs rather than external dependency contents.
- Local development prebuilds local workspace app artifacts once, then runs configured workspace app build watchers alongside the platform watcher, server, and Vite client so local `dist/` exports stay fresh during edits.

Shared platform payloads and SQLite persistence are platform-owned under `packages/platform/src`.
All bundled apps are source-owning workspace packages: their implementations live under `packages/apps/<app>/src`.

Shared server app services stay platform-only in `@citadel/platform/server-app`. App-specific server options, such as repository injection or chat rate limits, belong to each app server entrypoint and its app-owned server registration.

Neutral app package descriptors expose manifest, package name, and intended client/server registration export names. They are the runtime/public API mirror of the package manifest metadata, and must not import client or server implementation modules directly.

Package exports map each public surface to built JavaScript and declarations, for example:

```json
{
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
```

## Import Rules

- Platform core imports only platform contracts and generic server modules. It must not import concrete app internals.
- `bundled-apps.json` declares installed app package names only.
- `workspace-apps.json` declares local app packages that root build/watch scripts should build; installed external apps do not need to appear there.
- App `package.json` files declare Citadel metadata, including manifest data and client/server registration subpaths and export names.
- App package artifacts expose runtime code through package `exports` that point at built `dist` JavaScript and declaration files.
- The neutral bundled app config validates the JSON selection data.
- `src/bundledApps/generatedAppCatalog.ts` is generated from app package manifest metadata and is the only static host bridge to configured app client/server registration imports.
- Installed/generated catalog data is the host source of truth for known app ids; platform app-id validation is syntax-only.
- The handwritten bundled app resolver owns validation and imports the generated descriptor map from the generated catalog.
- The client registry consumes generated client registrations plus neutral shared types.
- The server registry consumes generated server registrations and calls app-owned server service adapters through that registration contract.
- Neutral app indexes do not import client modules, server bundles, repositories, repository resolvers, or implementation factories.
- App code imports platform contracts, shared platform helpers, and persistence APIs through `@citadel/platform/*` aliases rather than relative platform, shared, or persistence paths.
- Registries import bundled app public surfaces through `@citadel/app-*` package aliases rather than relative app entrypoint paths.
- Platform implementation lives in `packages/platform/src`; root `src/platform` compatibility shims are removed.
- Root shared and persistence compatibility shims are removed.
- Bundled app assembly lives in `src/bundledApps`; root `src/apps` compatibility shims are removed.
- App package shell entrypoints stay thin re-export shims to package-local source once each app moves.
- Package `tsconfig.json` files include only package-local entrypoints and source files. They must not include root host code, tests, or sibling package source by relative path.
- Package build configs emit artifacts into package-local `dist/` directories only. Generated artifacts are inspectable build output, not committed source of truth.
- App client code must not import server entrypoints, repositories, message stores, or `node:*` modules.
- App server entrypoints must not import React views or app client modules.
- Server-side code must not import `clientAppContract`, and client-side code must not import `serverAppContract`.
- Shared server service contracts must not mention concrete app repositories, enabled-app config, or app-specific options.

Focused repository tests may still import server package surfaces directly. Runtime wiring should use host and package public entrypoints, not removed compatibility paths.

## Current Defaults

App ids are open strings validated by syntax in the platform and by installed catalog membership in the host. Apps share one SQLite database by default, and each app owns its own tables or live state. This document does not introduce runtime plugin loading or a package split.
