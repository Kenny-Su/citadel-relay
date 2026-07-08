# Citadel Relay

A small raw WebSocket relay server for real-time spaces. Citadel owns network connections, participant identity, spaces, presence, and packet fan-out. External apps own their own UI, state machines, validation, persistence, and domain behavior.

Citadel does not install apps, load app packages, run extension code, render a browser UI, or inspect app payloads.

## Local Development

```bash
npm install
npm run dev
```

The HTTP server runs at `http://localhost:3001`.
The WebSocket endpoint runs at `ws://localhost:3001/ws`.

## Test And Build

```bash
npm test
npm run typecheck
```

`npm run build` runs the same typecheck used by CI-style verification.

## Protocol

Clients connect to `/ws`, join a space, then exchange packets through Citadel:

```json
{ "type": "space:join", "spaceId": "general", "guestId": "stable-guest", "name": "Ada" }
```

```json
{ "type": "space:packet", "topic": "chat", "payload": { "body": "hello" }, "target": "others" }
```

Citadel broadcasts packets to the current space without interpreting `payload`.
See [Communication Protocol](docs/communication-protocol.md) for the full wire contract.

## Server Environment

The server reads:

- `PORT`: HTTP and WebSocket port, default `3001`.
