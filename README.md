# Citadel Relay

Citadel is an authenticated first-level namespace router. App servers authenticate with pre-shared keys and exclusively claim paths such as `/chat`. Browsers connect anonymously to the relay, open a pending tunnel to an owner, and let that app perform its own authentication and ACL checks.

All traffic still passes through Citadel. Clients can send packets only upstream to their namespace owner. Only the authenticated owner can unicast or broadcast downstream.

Citadel does not own browser identity, app ACLs, subrooms, presence, payload validation, persistence, or domain behavior.

## Local Development

Create a 256-bit app-owner key:

```bash
openssl rand -hex 32
```

Copy the example and replace its placeholder with the generated 64-character lowercase hexadecimal value:

```bash
cp relay.config.example.json relay.config.json
npm install
npm run dev
```

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

`relay.config.json` is ignored by Git. App names, keys, and claimed paths must be unique. Claimed paths are exact, first-level lowercase paths.

The HTTP server runs at `http://localhost:3001`. The WebSocket endpoint is `ws://localhost:3001/ws`.

## Routing Model

The Chat server authenticates and claims its configured path:

```json
{ "type": "auth:authenticate", "token": "app-owner-psk" }
```

```json
{ "type": "namespace:claim", "namespace": "/chat" }
```

A browser does not authenticate to Citadel. It opens `/chat` with optional opaque app handshake data:

```json
{
  "type": "namespace:open",
  "namespace": "/chat",
  "hello": { "resumeToken": null }
}
```

The relay gives the owner a pending connection. Pending client packets and owner unicasts form a restricted handshake tunnel. The Chat server applies its ACL and responds with `namespace:accept` or `namespace:reject`.

After acceptance:

```text
Browser A → Relay → Chat server → Relay → Browser B
```

- Browsers send `client:packet`; the relay adds their trusted connection ID and sends only to the owner.
- Owners send `server:packet`; `target: "all"` reaches admitted clients and a connection target performs unicast.
- A client cannot target another client or request a broadcast.
- The owner can revoke a client at any time.

See [Communication Protocol](docs/communication-protocol.md) for the complete wire contract.

## Test And Build

```bash
npm test
npm run typecheck
```

## Traffic Diagnostics

Traffic logging is disabled by default:

```bash
RELAY_TRAFFIC_LOG=summary npm run dev
```

Summaries contain routing metadata but never authentication keys. `RELAY_TRAFFIC_LOG=payload` additionally records opaque app payloads and may expose app data.

## Server Environment

- `PORT`: HTTP and WebSocket port, default `3001`.
- `RELAY_CONFIG_PATH`: PSK app-owner config, default `relay.config.json`.
- `RELAY_TRAFFIC_LOG`: `summary` or `payload`; other values disable logging.
