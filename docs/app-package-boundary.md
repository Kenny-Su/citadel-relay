# App Package Boundary

Citadel apps now own their implementation source in workspace package folders, while the platform shell still wires them as bundled apps. Their public surfaces should stay package-shaped so the remaining split work stays mechanical instead of architectural.

## Public Surfaces

Each bundled app exposes three environment-specific surfaces:

- package root (`.`): neutral package descriptor, manifest, and shared types only.
- `./client`: browser client registration, `ClientAppModule`, and view wiring.
- `./server`: server registration, bundle, repository resolver, and server-only exports.

In the current first-party app source packages, those surfaces are backed by `packages/apps/<app>/src/index.ts`, `packages/apps/<app>/src/client.tsx`, and `packages/apps/<app>/src/server.ts`. External apps only need to provide the package exports and installed `package.json#citadel` metadata.

Bundled app order is declared as installed package names in `bundled-apps.json`. Catalog generation expects those packages to exist at `node_modules/<package>/package.json`: production/external hosts normally get that by declaring app package dependencies, while this repo's first-party app pilots get it from `local-external-apps.json`. Local app packages that should behave like installed external dependencies during the migration are declared there with package names plus source paths; the root build packs and installs those artifacts into `node_modules` before generating the installed-app catalog. Installed external apps only need to appear in `bundled-apps.json` and be installed by the host package manager. Each app package declares a `citadel` metadata block in its `package.json`; that package manifest metadata is the app discovery contract. Metadata includes manifest fields and client/server registration metadata. `src/bundledApps/config.ts` validates generator input, and `src/bundledApps/generatedAppCatalog.ts` is the generated installed-app catalog that mirrors selected package metadata and imports selected client/server registrations. Runtime app definitions, client registries, and server registries derive their ordered app lists from that generated catalog while keeping behavior environment-specific.

Hosts may select installed apps that the current repo does not build. In that shape, `bundled-apps.json` names the installed runtime package, and catalog generation operates only on installed packages named by `bundled-apps.json`.

To add an external app to a host, add the app package as a dependency, add its package name to `bundled-apps.json`, run install, and then run `npm run generate:bundled-apps`. If the package is not installed, catalog generation fails against the expected `node_modules/<package>/package.json` path instead of looking for source.

Root lifecycle scripts build local workspace package artifacts and install local external app artifacts before generating the installed-app catalog, because generation validates package `exports` by importing the built public surfaces. External app dependencies are expected to arrive already built. For local external-app pilots, `npm run pack:local-package -- @citadel/app-snake` builds the platform and the Snake source directory, then writes an ignored npm tarball under `.citadel/app-packs` so the host can test the same packed dependency shape an external package would use. `npm run install:local-external-apps` builds each source path in `local-external-apps.json`, packs it, installs the packed artifact into `node_modules`, and gives that installed app artifact its own non-Citadel runtime dependency directories; the root `build:packages` lifecycle skips the installer Platform build because `build:platform` has already prepared shared Platform artifacts.
Root app-only libraries such as `chess.js` are local source-build bootstrap dev dependencies, not host runtime dependencies.

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

The current repo resolves package-shaped imports through installed packages. Platform remains a root workspace package; bundled apps are installed artifacts prepared by local external-app tooling instead of root workspaces or root `file:` dependencies:

- `@citadel/platform/app`, `@citadel/platform/client`, `@citadel/platform/server-app`, and `@citadel/platform/persistence`.
- `@citadel/platform/server` and `@citadel/platform/validation`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` with `./client` and `./server` surfaces.

Local package source exists under `packages/` as the current local development shape for the source split. These packages keep thin TypeScript entrypoints as package-local build inputs:

- `@citadel/platform` owns its source under `packages/platform/src` and exports `./app`, `./client`, `./server-app`, `./persistence`, `./server`, and `./validation`.
- `@citadel/app-chat`, `@citadel/app-chess`, and `@citadel/app-snake` export `.`, `./client`, and `./server`.
- Each local package has a package-local no-emit TypeScript check. These checks prove package isolation without producing JavaScript or declarations.
- Each local package also has a local package build that emits JavaScript and declarations into its ignored `dist/` directory. Package `exports` point at those built artifacts, and the host consumes packages through package resolution rather than source aliases.
- Platform and app package artifacts are built-package artifacts: npm pack allowlists `dist` plus `package.json`, so source files and TypeScript build configs are development inputs rather than external dependency contents.
- Chat, Chess, and Snake are local-external pilots: root build scripts install them from packed artifacts instead of workspace build/watch maintenance. Local installed artifacts carry their own non-Citadel runtime dependency directories, while Platform stays a host package. Tests pack them from the source paths declared in `local-external-apps.json`, install the tarballs through npm into temp hosts with no workspaces, generate installed-app catalogs, and boot/import the host path from that packed dependency shape.
- Local development watches the Platform workspace package alongside the server and Vite client. Apps in the local-external pilot path are prepared through packed artifacts before dev/test/build.

Shared platform payloads and SQLite persistence are platform-owned under `packages/platform/src`.
The currently bundled first-party apps are still source-owning package folders in this repo, but they are no longer root npm workspaces. Their implementations live under `packages/apps/<app>/src`, and the host sees them through installed package artifacts in `node_modules`.

Shared server app services stay platform-only in `@citadel/platform/server-app`. App-specific server options, such as repository injection or chat rate limits, belong to each app server entrypoint and its app-owned server registration. The host server factory is `createCitadelServer`; app-named host server factories such as the old `createChatServer` compatibility surface have been removed.

Neutral app package descriptors expose manifest, package name, and intended client/server registration export names. They are the runtime/public API mirror of the package manifest metadata, and must not import client or server implementation modules directly.

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
- Every package named in `bundled-apps.json` must be installed before catalog generation. Production/external hosts should do that with normal package dependencies; this repo's first-party pilots do it through `local-external-apps.json`.
- `local-external-apps.json` is optional migration data. When present, it declares local source package names and source paths that should be consumed as packed installed artifacts; external hosts with normally installed app dependencies do not need the file.
- App `package.json` files declare Citadel metadata, including manifest data and client/server registration subpaths and export names.
- App package artifacts expose runtime code through package `exports` that point at built `dist` JavaScript and declaration files.
- Platform and app package manifests are publishable-shaped: they are not marked private, and npm pack includes only `dist` plus `package.json`.
- Local packed app artifacts are written under ignored `.citadel/app-packs`; they are install inputs for pilots, not committed source.
- The neutral bundled app config validates the JSON selection data for generation.
- `src/bundledApps/generatedAppCatalog.ts` is generated from app package manifest metadata and is the only static host bridge to configured app descriptors and client/server registration imports.
- Runtime bundled app definitions derive from `generatedAppCatalog.ts`, not from `bundled-apps.json`.
- Installed/generated catalog data is the host source of truth for known app ids; platform app-id validation is syntax-only.
- The handwritten bundled app resolver validates configured package names against the generated descriptor map when parser/resolver behavior is tested.
- The client registry consumes generated client registrations plus neutral shared types.
- The server registry consumes generated server registrations and calls app-owned server service adapters through that registration contract.
- The production server entrypoint uses `createCitadelServer`; app-specific repository wiring belongs to app server entrypoints and focused tests, not host server compatibility wrappers.
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
