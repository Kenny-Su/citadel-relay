# Citadel Relay

A raw WebSocket relay for real-time spaces, now with authenticated app-owner namespace claims. Existing browser space traffic remains unchanged in `0.2.0`; app servers can authenticate with a 256-bit pre-shared key and exclusively register an exact first-level path such as `/chat`.

## App Owner Configuration

Generate a key:

```bash
openssl rand -hex 32
```

Copy `relay.config.example.json` to the Git-ignored `relay.config.json` and replace the placeholder:

```json
{
  "apps": [
    {
      "name": "chat-server",
      "preSharedKey": "64-character-lowercase-hexadecimal-key",
      "claimedPath": "/chat"
    }
  ]
}
```

App owners authenticate and claim their configured path:

```json
{ "type": "auth:authenticate", "token": "app-owner-psk" }
```

```json
{ "type": "namespace:claim", "namespace": "/chat" }
```

Names, keys, and claimed paths must be unique. Paths are exact and first-level.

## Local Development

```bash
npm install
npm run dev
```

The HTTP server runs at `http://localhost:3001`; the WebSocket endpoint is `ws://localhost:3001/ws`.

## Existing Space Protocol

Unauthenticated browser clients can continue to join spaces and exchange opaque packets:

```json
{ "type": "space:join", "spaceId": "general", "guestId": "stable-guest", "name": "Ada" }
```

```json
{ "type": "space:packet", "topic": "chat", "payload": { "body": "hello" }, "target": "others" }
```

See [Communication Protocol](docs/communication-protocol.md).

## Verification

```bash
npm run typecheck
npm test
```

## Environment

- `PORT`: server port, default `3001`.
- `RELAY_CONFIG_PATH`: app-owner config, default `relay.config.json`.
- `RELAY_TRAFFIC_LOG`: `summary` or `payload`.
