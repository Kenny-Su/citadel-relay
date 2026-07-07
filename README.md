# Citadel Host

A small real-time host for installable Citadel app packages. The host runs the web app and server, while `@citadel-platform/platform` provides the shared SDK/runtime for identity, spaces, presence, Socket.IO routing, persistence helpers, and app contracts. Each app package owns its own state, events, UI, and persistence.

## Local Development

```bash
npm install
npm run dev
```

The Vite client runs at `http://localhost:5173` and the Socket.IO/Express backend runs at `http://localhost:3001`.
`npm run dev` regenerates the installed app catalog, then runs the server and client.
This repo uses local `file:` packages under `vendor/citadel-platform` for Citadel platform artifacts. Citadel package installs do not require the npm registry.

## Test And Build

```bash
npm test
npm run build
```

Generated root and package `dist/` directories are build output and are not committed.
`npm run generate:bundled-apps` validates each package listed in `bundled-apps.json` from `node_modules` and writes the generated catalog used by the client and server registries.

## Apps

This host starts with no bundled apps. Apps can be added in two ways:

- Build-time bundled apps: add a local package dependency, list it in `bundled-apps.json`, regenerate the catalog, and rebuild.
- Runtime extensions: upload a trusted built app zip from the host UI. The server stores it under `data/extensions` and enables it after restart.

- Host owners: see [Adding Apps](docs/adding-apps.md).
- App authors: see [Developing Apps](docs/developing-apps.md).
- Platform maintainers: see [Developing The Platform](docs/developing-platform.md).
- Package contract details: see [App Package Boundary](docs/app-package-boundary.md).

## Server Environment

The server reads:

- `PORT`: HTTP port, default `3001`.
- `CLIENT_ORIGIN`: allowed Socket.IO browser origin, default `http://localhost:5173`.
- `CITADEL_ENABLED_APPS`: comma-separated enabled app ids, defaulting to bundled plus installed extension apps.
- `CITADEL_DB_PATH`: SQLite database path for app persistence, default `data/citadel.sqlite`.
- `CITADEL_EXTENSIONS_DIR`: local extension storage directory, default `data/extensions`.
