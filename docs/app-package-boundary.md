# App Package Boundary

Citadel apps now own their implementation source in workspace package folders, while the platform shell still wires them as bundled apps. Their public surfaces should stay package-shaped so the remaining split work stays mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- package root (`.`): neutral package descriptor, manifest, and shared types only.
- `./client`: browser client registration, `ClientAppModule`, and view wiring.
- `./server`: server registration, bundle, repository resolver, and server-only exports.

In the current first-party workspace apps, those surfaces are backed by `packages/apps/<app>/src/index.ts`, `packages/apps/<app>/src/client.tsx`, and `packages/apps/<app>/src/serverEntry.ts`. External apps only need to provide the package exports and installed `package.json#citadel` metadata.

Bundled app order is declared as installed package names in `bundled-apps.json`. Those selected packages should also be declared as host dependencies so a normal install creates the expected `node_modules/<package>/package.json` discovery surface. Local app packages that need monorepo build/watch support are declared separately in `workspace-apps.json`; this is a development convenience, not runtime selection. The two lists may match while apps live in this monorepo, but installed external apps only need to appear in `bundled-apps.json` and the host dependency manifest. Each app package declares a `citadel` metadata block in its `package.json`; that package manifest metadata is the app discovery contract. Metadata includes manifest fields, client/server registration metadata, and app capabilities such as legacy service keys needed during the transition. `src/bundledApps/config.ts` validates generator input, and `src/bundledApps/generatedAppCatalog.ts` is the generated installed-app catalog that mirrors selected package metadata and imports selected client/server registrations. Runtime app definitions, client registries, and server registries derive their ordered app lists from that generated catalog while keeping behavior environment-specific.

Hosts may select installed apps that the current repo does not build. In that shape, `bundled-apps.json` names the installed runtime package and `workspace-apps.json` can be empty; root package build/watch helpers operate only on `workspace-apps.json`, while catalog generation operates only on installed packages named by `bundled-apps.json`.

To add an external app to a host, add the app package as a dependency, add its package name to `bundled-apps.json`, leave it out of `workspace-apps.json`, run install, and then run `npm run generate:bundled-apps`. If the package is not installed, catalog generation fails against the expected `node_modules/<package>/package.json` path instead of looking for workspace source.

Root lifecycle scripts build local workspace package artifacts before generating the installed-app catalog, because generation validates package `exports` by importing the built public surfaces. External app dependencies are expected to arrive already built.

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
- Snake is the current external-app proof: tests pack it, install the tarball through npm into a temp host with no workspaces and an empty `workspace-apps.json`, generate a Snake-only installed-app catalog, and boot the host/server path from that packed dependency shape.
- Local development prebuilds local workspace app artifacts once, then runs configured workspace app build watchers alongside the platform watcher, server, and Vite client so local `dist/` exports stay fresh during edits.

Shared platform payloads and SQLite persistence are platform-owned under `packages/platform/src`.
The currently bundled first-party apps are still source-owning workspace packages: their implementations live under `packages/apps/<app>/src`.

Shared server app services stay platform-only in `@citadel/platform/server-app`. App-specific server options, such as repository injection or chat rate limits, belong to each app server entrypoint and its app-owned server registration. The normal host server factory is `createCitadelServer`; the older `createChatServer` wrapper remains only as a compatibility adapter for legacy repository return fields and test injection.

Neutral app package descriptors expose manifest, package name, app capabilities, and intended client/server registration export names. They are the runtime/public API mirror of the package manifest metadata, and must not import client or server implementation modules directly.

## App-Owned State Machines

Apps own their domain state machines. Stages and rules such as Snake `waiting`/`playing`, player readiness, Chess turns/checkmate, or Chat typing are app state and app events. The platform should continue to provide app-neutral primitives: identity, presence, transport, app state storage, and persistence contracts.

App lifecycle terms may appear in app packages, app public types, and app protocol docs. They must not appear in platform contracts, host registries, generated app selection, or generic server service contracts. External apps should be able to add lobby, ready, round, match, or end-state rules without changing platform source.

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
- Every package named in `bundled-apps.json` is a host package dependency.
- `workspace-apps.json` declares local app packages that root build/watch scripts should build; installed external apps do not need to appear there.
- App `package.json` files declare Citadel metadata, including manifest data, capability metadata, and client/server registration subpaths and export names.
- App capability metadata is declarative host compatibility data. `capabilities.legacyServices` names legacy service keys that the app can consume while old host adapters still exist; apps without legacy service needs declare an empty list.
- App package artifacts expose runtime code through package `exports` that point at built `dist` JavaScript and declaration files.
- The neutral bundled app config validates the JSON selection data for generation.
- `src/bundledApps/generatedAppCatalog.ts` is generated from app package manifest metadata and is the only static host bridge to configured app descriptors and client/server registration imports.
- Runtime bundled app definitions derive from `generatedAppCatalog.ts`, not from `bundled-apps.json`.
- Installed/generated catalog data is the host source of truth for known app ids; platform app-id validation is syntax-only.
- The handwritten bundled app resolver validates configured package names against the generated descriptor map when parser/resolver behavior is tested.
- The client registry consumes generated client registrations plus neutral shared types.
- The server registry consumes generated server registrations and calls app-owned server service adapters through that registration contract.
- The production server entrypoint uses `createCitadelServer`; app-specific legacy repository wiring stays isolated in `createChatServer` and `legacyAppRepositories`.
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
