# Citadel Relay

Citadel is an authenticated app router. App servers authenticate with pre-shared
keys that map them to identifiers such as `chat`. Every client
authenticates with a JWT from one configured global issuer. Citadel verifies
client identity, while each app server makes every admission and ACL decision.

All WebSocket traffic passes through Citadel. Clients can send packets only upstream
to their app server. Only the authenticated app server can unicast or broadcast
downstream.

An app ID selects an app server; it does not represent a space or room. Each app
implements its own spaces, rooms, ACLs, presence, payload validation,
persistence, and domain behavior. Citadel does not issue client identities.

## Local Development

Create a 256-bit app-server key:

```bash
openssl rand -hex 32
```

Create an RSA key pair for client JWTs. Keep the private key only with the
trusted process that authenticates clients and issues tokens:

```bash
openssl genrsa -out client-jwt-private.pem 2048
openssl rsa -in client-jwt-private.pem -pubout -out client-jwt-public.pem
```

Copy the example and replace its app-server key placeholder with the generated
64-character lowercase hexadecimal value:

```bash
cp relay.config.example.json relay.config.json
npm install
npm run dev
```

```json
{
  "apps": [
    {
      "preSharedKey": "64-character-lowercase-hexadecimal-key",
      "appId": "chat"
    }
  ],
  "clientJwt": {
    "issuer": "citadel-local",
    "audience": "citadel-relay",
    "publicKeyPath": "./client-jwt-public.pem",
    "algorithm": "RS256"
  }
}
```

`relay.config.json` and both generated key files are ignored by Git. App-server
keys and app IDs must be unique. App IDs are lowercase identifiers such as
`chat`, without a leading slash. The required `clientJwt` block applies to every
app. Citadel loads the SPKI public key once at startup and accepts only the configured
asymmetric algorithm. A relative `publicKeyPath` is resolved from the process
working directory.

After `npm install`, create a one-hour development token with one Node command.
The project already depends on `jose`:

```bash
node --input-type=module -e 'import{readFileSync}from"node:fs";import{importPKCS8,SignJWT}from"jose";const key=await importPKCS8(readFileSync("client-jwt-private.pem","utf8"),"RS256");console.log(await new SignJWT({}).setProtectedHeader({alg:"RS256"}).setIssuer("citadel-local").setAudience("citadel-relay").setSubject(process.argv[1]??"dev-user").setIssuedAt().setExpirationTime("1h").sign(key))' dev-user
```

The issuer and audience in a token must exactly match `relay.config.json`.
Production token issuance belongs in a trusted application backend after it
authenticates the user. Never put the private key in Citadel or distribute it to
clients.

The HTTP server runs at `http://localhost:3001`. The WebSocket endpoint is `ws://localhost:3001/ws`.

## Connection Gate

Every WebSocket must establish a role within five seconds. Its first valid
message must be either `app:authenticate` with an app-server PSK or `app:open`
with a client JWT. Malformed, unknown, or additional messages during
authentication close the connection with code `4401`.

Client JWTs are verified before Citadel reveals whether the requested app is available. Individual WebSocket messages are limited to 64 KiB and oversized messages close with code `1009`.

These controls protect app servers and bound per-connection work. Production deployments should still apply IP rate limits, concurrent-connection limits, and TLS at the reverse proxy or network edge; Citadel intentionally does not implement network-level abuse policy.

## Routing Model

The Chat server authenticates. Citadel immediately registers it as the live
server for the app ID associated with that key:

```json
{ "type": "app:authenticate", "token": "app-server-psk" }
```

```json
{ "type": "app:ready", "appId": "chat" }
```

A client opens `chat` with required JWT credentials and optional opaque app handshake data:

```json
{
  "type": "app:open",
  "appId": "chat",
  "credential": {
    "type": "jwt",
    "token": "signed-client-jwt"
  },
  "hello": { "resumeToken": null }
}
```

Missing or invalid credentials fail authentication before the app server is notified.

The relay verifies a supplied JWT and gives the app server a pending connection
with a trusted `subject`. It never forwards the bearer token or other JWT
claims. Pending client packets and server unicasts form a restricted handshake
tunnel. The Chat server applies its ACL and responds with `app:accept` or
`app:reject`; verified identity never implies admission.

After acceptance:

```text
Browser A → Relay → Chat server → Relay → Browser B
```

- Clients send `client:packet`; the relay adds their trusted connection ID and verified identity, then sends only to the app server.
- App servers send `server:packet`; `target: "all"` reaches admitted clients and a connection target performs unicast.
- Packets do not carry an app ID; the route is fixed when the socket authenticates or opens an app.
- A client cannot target another client or request a broadcast.
- The app server can revoke a client at any time.

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
- `RELAY_CONFIG_PATH`: PSK app-server config, default `relay.config.json`.
- `RELAY_TRAFFIC_LOG`: `summary` or `payload`; other values disable logging.
