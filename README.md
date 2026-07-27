# Citadel Relay

Citadel is an authenticated app router. App servers authenticate with pre-shared
keys that map them to identifiers such as `chat`. Every client
authenticates with a JWT signed by the configured identity service. Citadel verifies
client identity, while each app server makes every admission and ACL decision.

All WebSocket traffic passes through Citadel. Clients can send packets only upstream
to their app server. Only the authenticated app server can unicast or broadcast
downstream.

An app ID selects an app server; it does not represent a space or room. Each app
implements its own spaces, rooms, ACLs, presence, payload validation,
persistence, and domain behavior. Citadel does not issue client identities.

## Local Development

Provide the SPKI public key published by the trusted identity server:

```bash
cp /path/from/identity-server/client-jwt-public.pem .
```

The corresponding private key stays in the identity server and must never be
copied into the relay.

Copy the relay configuration, set a development admin passphrase, and start the
relay plus its admin frontend:

```bash
cp relay.config.example.json relay.config.json
npm install
export RELAY_ADMIN_PASSPHRASE='replace-with-at-least-16-characters'
export RELAY_ADMIN_SECURE_COOKIES=false
npm run dev
```

```json
{
  "clientJwt": {
    "issuer": "citadel-local",
    "audience": "citadel-relay",
    "publicKeyPath": "./client-jwt-public.pem",
    "algorithm": "RS256"
  }
}
```

Open `http://localhost:5173/admin/`, sign in, and register an app ID such as
`chat`. The generated 256-bit app-server key is displayed once; store it in the
app server's secret manager. App IDs use lowercase letters, numbers, and
internal hyphens without a leading slash.

Registrations live in `relay.sqlite`. Only SHA-256 key digests are persisted,
and creating, rotating, or deleting a registration takes effect immediately.
Rotation and deletion disconnect the current app server and its clients.

`relay.config.json`, `relay.sqlite`, and `client-jwt-public.pem` are ignored by Git.
The required `clientJwt` block applies to every app. Citadel loads the SPKI
public key once at startup and accepts only the configured asymmetric
algorithm. A relative `publicKeyPath` is resolved from the process working
directory.

The identity server issues client JWTs. The issuer and audience settings remain
in `relay.config.json` for compatibility but are not currently enforced.
Citadel only verifies those tokens and never loads a private key or exposes
token-generation functionality.

The API and WebSocket server run at `http://localhost:3001`; Vite serves the
admin frontend at `http://localhost:5173/admin/` during development. After
`npm run build`, `npm start` serves the admin frontend from
`http://localhost:3001/admin/`.

### Migrating Existing Registrations

On the first startup after upgrading, any legacy `apps` entries in
`relay.config.json` are imported transactionally into SQLite. Existing keys
continue to work. Once the import is verified, Citadel atomically removes the
plaintext app registrations from the config file and restricts it to owner-only
permissions. The relay process therefore needs write and rename permission on
the directory containing `relay.config.json` for this one-time migration. A
failed cleanup is safe to retry: the imported registrations remain in SQLite
and the next startup verifies them before removing the legacy entries.

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
npm run build
```

## Docker Deployment

The included multi-stage image builds the server and admin frontend, then runs
them as an unprivileged user on Node.js 24. Compose stores the SQLite database
in a named volume and mounts the JWT configuration and public key read-only.

Prepare the deployment-only files:

```bash
mkdir -p deploy
cp deploy/relay.config.example.json deploy/relay.config.json
cp /path/from/identity-server/client-jwt-public.pem deploy/client-jwt-public.pem
```

Edit `deploy/relay.config.json` so its algorithm matches the identity server.
The issuer and audience settings are retained but are not currently enforced.
Keep its `publicKeyPath` set to
`/run/secrets/client-jwt-public.pem`.

Create an ignored `.env` file from the documented template, then replace the
admin passphrase with a unique, randomly generated secret:

```bash
cp .env.example .env
```

Then build and start the service:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://localhost:3001/health
```

Set `RELAY_TRUST_PROXY=true` when the container is behind a trusted reverse
proxy that terminates TLS. In production, expose the relay through that proxy
with WebSocket upgrade support, rate limits, and concurrent-connection limits.
Do not publish port 3001 directly to the internet.

The `relay-data` volume contains the registration database. Back it up before
upgrades and destructive registration changes. The Compose configuration uses
a read-only relay config, so migrate any legacy plaintext `apps` entries with a
local start before deploying; new installations should register apps through
the admin console.

Useful lifecycle commands:

```bash
docker compose logs -f relay
docker compose restart relay
docker compose down
```

`docker compose down` preserves the database volume. Do not add `--volumes`
unless you intentionally want to delete all app registrations.

## Traffic Diagnostics

Traffic logging is disabled by default:

```bash
RELAY_TRAFFIC_LOG=summary npm run dev
```

Summaries contain routing metadata but never authentication keys, JWTs, or verified subjects. `RELAY_TRAFFIC_LOG=payload` additionally records opaque app packet payloads and may expose credentials if an application puts them inside its own payload.

## Server Environment

- `PORT`: HTTP and WebSocket port, default `3001`.
- `RELAY_CONFIG_PATH`: JWT verification config and legacy migration source,
  default `relay.config.json`.
- `RELAY_DATABASE_PATH`: SQLite registration database, default `relay.sqlite`.
- `RELAY_ADMIN_PASSPHRASE`: enables the admin API and frontend; must be at least
  16 characters.
- `RELAY_ADMIN_SECURE_COOKIES`: secure cookies are enabled unless set to
  `false`; use `false` only for local HTTP development.
- `RELAY_TRUST_PROXY`: set to `true` behind a trusted TLS reverse proxy so
  same-origin checks use the forwarded protocol.
- `RELAY_TRAFFIC_LOG`: `summary` or `payload`; other values disable logging.
