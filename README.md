# Citadel Platform

A small real-time communication platform with bundled chat, chess, and snake apps. The platform owns identity, spaces, presence, Socket.IO routing, and shared errors; each app owns its own state, events, UI, and persistence.

## Local Development

```bash
npm install
npm run dev
```

The Vite client runs at `http://localhost:5173` and the Socket.IO/Express backend runs at `http://localhost:3001`.
`npm run dev` builds workspace package artifacts once, then watches platform and app packages so their ignored `dist/` exports stay current while the server and client run.

## Test And Build

```bash
npm test
npm run build
npm run test:production
```

`npm run test:production` builds the client and checks that the production server serves `/health`, app routes such as `/apps/chat/spaces/general`, and legacy chat links such as `/rooms/general`.
Generated root and package `dist/` directories are build output and are not committed.

## Production Run

```bash
npm run build
npm start
```

The server reads:

- `PORT`: HTTP port, default `3001`.
- `HOST`: bind host, default `0.0.0.0`.
- `CLIENT_ORIGIN`: allowed Socket.IO browser origin, default `http://localhost:5173`.
- `CITADEL_ENABLED_APPS`: comma-separated enabled app ids, defaulting to installed catalog order (`chat,chess,snake` in this repo).
- `CITADEL_DB_PATH`: SQLite database path for app persistence, default `data/citadel.sqlite`.
- Chess games and moves use the same SQLite database through app-owned tables.

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

Keep the service at one instance while using SQLite for chat history. Move to Postgres before horizontal scaling.
