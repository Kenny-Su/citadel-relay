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

Packets can target the full space, everyone except the sender, or one connection in the sender's current space:

```json
{ "type": "space:packet", "topic": "command", "payload": {}, "target": { "connectionId": "recipient-connection-id" } }
```

Citadel routes packets without interpreting `payload`.
See [Communication Protocol](docs/communication-protocol.md) for the full wire contract.

## Traffic diagnostics

Traffic logging is disabled by default. To record structured JSON Lines routing summaries:

```bash
RELAY_TRAFFIC_LOG=summary npm run dev
```

Summaries contain message type, topic, space and connection IDs, byte counts, routing target, and WebSocket buffered bytes. Set `RELAY_TRAFFIC_LOG=payload` only when complete opaque application payloads are required; payload mode is substantially noisier and may expose application data.

## Server Environment

The server reads:

- `PORT`: HTTP and WebSocket port, default `3001`.
- `RELAY_TRAFFIC_LOG`: `summary` or `payload`; unset/other values disable traffic logging.
