# Citadel Relay

Citadel is an authenticated first-level namespace router. App servers authenticate with pre-shared keys and exclusively claim paths such as `/chat`. Every client authenticates with a JWT from one configured global issuer. Citadel verifies client identity, while each app owner makes every admission and ACL decision.

All traffic still passes through Citadel. Clients can send packets only upstream to their namespace owner. Only the authenticated owner can unicast or broadcast downstream.

Citadel does not issue client identities or own app ACLs, subrooms, presence, payload validation, persistence, or domain behavior.

## Local Development

Create a 256-bit app-owner key:

```bash
openssl rand -hex 32
```

Copy the example and replace its placeholder with the generated 64-character lowercase hexadecimal value:

```bash
cp relay.config.example.json relay.config.json
npm install
npm run dev:issuer -- dev-user
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
  ],
  "clientJwt": {
    "issuer": "http://127.0.0.1:4000/",
    "audience": "citadel-relay",
    "jwksUri": "http://127.0.0.1:4000/jwks.json",
    "algorithms": ["RS256"]
  }
}
```

`relay.config.json` is ignored by Git. App names, keys, and claimed paths must be unique. Claimed paths are exact, first-level lowercase paths. The required `clientJwt` block applies to every namespace. Its JWKS URI must use HTTPS, except for loopback development URLs, and its algorithm list accepts only supported asymmetric signing algorithms.

`dev:issuer` prints a one-hour JWT and serves its public key at `http://127.0.0.1:4000/jwks.json`. It creates a new in-memory key each time it starts.

The HTTP server runs at `http://localhost:3001`. The WebSocket endpoint is `ws://localhost:3001/ws`.

## Connection Gate

Every WebSocket must establish a role within five seconds. Its first valid message must be either app-owner PSK authentication or a client namespace open carrying a JWT. Malformed, unknown, or additional messages during authentication close the connection with code `4401`.

Client JWTs are verified before Citadel reveals whether the requested namespace is available. Individual WebSocket messages are limited to 64 KiB and oversized messages close with code `1009`.

These controls protect app owners and bound per-connection work. Production deployments should still apply IP rate limits, concurrent-connection limits, and TLS at the reverse proxy or network edge; Citadel intentionally does not implement network-level abuse policy.

## Routing Model

The Chat server authenticates and claims its configured path:

```json
{ "type": "auth:authenticate", "token": "app-owner-psk" }
```

```json
{ "type": "namespace:claim", "namespace": "/chat" }
```

A client opens `/chat` with required JWT credentials and optional opaque app handshake data:

```json
{
  "type": "namespace:open",
  "namespace": "/chat",
  "credential": {
    "type": "jwt",
    "token": "signed-client-jwt"
  },
  "hello": { "resumeToken": null }
}
```

Missing or invalid credentials fail authentication before the namespace owner is notified.

The relay verifies a supplied JWT and gives the owner a pending connection with a trusted `subject`. It never forwards the bearer token or other JWT claims. Pending client packets and owner unicasts form a restricted handshake tunnel. The Chat server applies its ACL and responds with `namespace:accept` or `namespace:reject`; verified identity never implies admission.

After acceptance:

```text
Browser A → Relay → Chat server → Relay → Browser B
```

- Clients send `client:packet`; the relay adds their trusted connection ID and verified identity, then sends only to the owner.
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

Summaries contain routing metadata but never authentication keys, JWTs, or verified subjects. `RELAY_TRAFFIC_LOG=payload` additionally records opaque app packet payloads and may expose credentials if an application puts them inside its own payload.

## Server Environment

- `PORT`: HTTP and WebSocket port, default `3001`.
- `RELAY_CONFIG_PATH`: PSK app-owner config, default `relay.config.json`.
- `RELAY_TRAFFIC_LOG`: `summary` or `payload`; other values disable logging.
