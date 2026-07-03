# Citadel Host

A small real-time host for installable Citadel app packages. The host runs the web app and server, while `@citadel-platform/platform` provides the shared SDK/runtime for identity, spaces, presence, Socket.IO routing, persistence helpers, and app contracts. Each app package owns its own state, events, UI, and persistence.

## Local Development

```bash
npm install
npm run dev
```

The Vite client runs at `http://localhost:5173` and the Socket.IO/Express backend runs at `http://localhost:3001`.
`npm run dev` builds the Platform package, regenerates the installed app catalog, then watches the Platform package while the server and client run.
This repo is empty by default: apps are normal installed package dependencies selected by `bundled-apps.json`.

## Test And Build

```bash
npm test
npm run build
npm run test:production
```

`npm run test:production` builds the client and checks that the production server serves `/health`, app routes, and legacy room links from the empty host.
Generated root and package `dist/` directories are build output and are not committed.
`npm run generate:bundled-apps` validates each package listed in `bundled-apps.json` from `node_modules` and writes the generated catalog used by the client and server registries.

## Apps

To add apps, install their packages and list the package names in `bundled-apps.json`:

```bash
npm install @citadel-platform/app-chat @citadel-platform/app-chess @citadel-platform/app-snake
```

```json
{
  "packages": [
    "@citadel-platform/app-chat",
    "@citadel-platform/app-chess",
    "@citadel-platform/app-snake",
    "@example/citadel-app"
  ]
}
```

Then run:

```bash
npm install
npm run generate:bundled-apps
```

An app package must depend on `@citadel-platform/platform`, declare `package.json#citadel` metadata, and export:

- `.` for the neutral app descriptor, manifest, and shared types.
- `./client` for a `ClientAppRegistration`.
- `./server` for a `ServerAppRegistration`.

The recommended app repo shape is `src/index.ts`, `src/client.tsx`, `src/server.ts`, optional app-owned shared modules and tests, and package scripts for `build`, `typecheck`, and `test`. Use `citadel-generate-app-metadata --package-dir .` in `prebuild` and `pretypecheck` so runtime metadata stays mirrored from `package.json#citadel`.

## Production Run

```bash
npm run build
npm start
```

The server reads:

- `PORT`: HTTP port, default `3001`.
- `HOST`: bind host, default `0.0.0.0`.
- `CLIENT_ORIGIN`: allowed Socket.IO browser origin, default `http://localhost:5173`.
- `CITADEL_ENABLED_APPS`: comma-separated enabled app ids, defaulting to installed catalog order. With the default empty host, no apps are enabled.
- `CITADEL_DB_PATH`: SQLite database path for app persistence, default `data/citadel.sqlite`.

## Render Deployment

Create a Render Web Service connected to this repo.

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health`
- Node version: `24.14.1`
- Persistent disk mount path: `/var/data`

Set environment variables:

```text
NODE_VERSION=24.14.1
CITADEL_DB_PATH=/var/data/citadel.sqlite
CLIENT_ORIGIN=https://<service>.onrender.com
```

Keep the service at one instance while using SQLite-backed app persistence. Move to Postgres or another shared persistence layer before horizontal scaling.
