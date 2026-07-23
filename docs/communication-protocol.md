# Citadel Relay Communication Protocol

Citadel routes opaque traffic between authenticated clients and authenticated
app servers. It enforces one live server per app, packet direction, and client
JWT identity. An app ID selects an app server; spaces, rooms, admission, ACLs,
presence, and application behavior remain inside that app.

## Transport

- WebSocket endpoint: `ws://localhost:3001/ws`
- Health endpoint: `GET /health`
- Maximum WebSocket message size: 65,536 bytes

Messages are JSON objects with a string `type`. Use `wss://` outside local development.

Every connection has five seconds to establish its role. Before authentication,
its first valid message must be either `app:authenticate` with an app-server PSK
or `app:open` with a client JWT. Malformed, unknown, or additional messages while
authentication is running close the connection with code `4401`. Messages
larger than the maximum close with code `1009`.

## Roles

### App server

An app server authenticates with a configured 256-bit PSK. Citadel immediately
registers it as the live server for the app ID associated with that key. Only
that server can accept clients or send downstream packets for the app.

### App client

A client presents a JWT from Citadel's configured global issuer. It opens an app
and receives a relay-generated `connectionId`. While pending, it can exchange
opaque handshake packets only with the app server. Once accepted, it can receive
server broadcasts.

## App Server Configuration

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

Generate a key with `openssl rand -hex 32`. Citadel validates unique keys and app
IDs at startup, decodes each key to exactly 32 bytes, and performs fixed-length
constant-time comparisons.

App IDs are lowercase identifiers such as `chat`, without a leading slash.
`chat-admin` is a different app ID, and nested values such as `chat/private` are
invalid.

The top-level `clientJwt` block is required and applies to every app.
Citadel loads one PEM-encoded SPKI public key from disk at startup and verifies
tokens using the one configured asymmetric algorithm. Relative public-key paths
are resolved from the process working directory. The corresponding private key
must remain with the trusted token issuer and must never be stored in Citadel or
sent to clients. Replacing the key requires a relay restart and immediately
invalidates tokens signed by the previous key.

## App Server Authentication

App server to relay:

```ts
{
  type: 'app:authenticate';
  token: string;
}
```

Successful response:

```ts
{
  type: 'app:ready';
  appId: 'chat';
}
```

The app ID comes from relay configuration, never from the app server.
Disconnecting the app server unregisters the app and closes its clients.

## Opening A Client Connection

Client to relay:

```ts
{
  type: 'app:open';
  appId: 'chat';
  credential: {
    type: 'jwt';
    token: string;
  };
  hello?: unknown;
}
```

Citadel verifies the credential's signature, asymmetric algorithm, issuer, audience, subject, expiration, and optional not-before claim before checking whether the requested app is available or creating a pending session. A missing or unverifiable credential closes the connection with WebSocket code `4401`, and the app server is not notified.

The `hello` value is opaque and untrusted to Citadel. It may contain an app resume token or handshake metadata. Identity-like data inside `hello` is not verified client identity.

The client receives:

```ts
{
  type: 'app:state';
  state: 'pending';
  connectionId: string;
}
```

The app server receives:

```ts
{
  type: 'app:connect';
  requestId: string;
  connectionId: string;
  identity: {
    subject: string;
  };
  hello?: unknown;
}
```

`identity.subject` is copied from the verified JWT subject and is fixed for that
app session. Citadel does not forward the original bearer token, issuer,
protected header, or other claims. JWT expiration after the session opens does
not automatically disconnect the client.

Pending clients cannot receive broadcasts. They can exchange unicast handshake
packets with the app server. Verified identity does not change the pending
state.

## App-Owned Admission

After applying its authentication and ACL rules, the app server accepts:

```ts
{ type: 'app:accept'; requestId: string }
```

Or rejects:

```ts
{
  type: 'app:reject';
  requestId: string;
  message?: string;
}
```

Citadel reports `state: 'admitted'` or `state: 'rejected'` to the client. The app
server can later revoke either a pending or admitted connection:

```ts
{
  type: 'app:revoke';
  connectionId: string;
  message?: string;
}
```

The client can explicitly send `{ type: 'app:close' }`. On closure or
disconnect, the app server receives `app:disconnect` with the trusted connection
ID, prior admission state, and verified identity.

## Upstream Client Packets

A pending or admitted client sends:

```ts
{
  type: 'client:packet';
  payload?: unknown;
}
```

The client cannot choose a target. Citadel sends only to the app server and adds trusted routing and identity metadata:

```ts
{
  type: 'client:packet';
  from: {
    connectionId: string;
    state: 'pending' | 'admitted';
    identity: {
      subject: string;
    };
  };
  payload?: unknown;
}
```

Identity-like data inside `payload` remains untrusted application data and cannot replace `from.identity`.

## Downstream Server Packets

Only the authenticated current app server can send:

```ts
{
  type: 'server:packet';
  target: 'all' | { connectionId: string };
  payload?: unknown;
}
```

- `target: 'all'` reaches all admitted clients in the app.
- Connection targets may address a pending client for handshake traffic or an admitted client for normal traffic.
- Targets must belong to the authenticated app server.
- App clients cannot send `server:packet`.

Recipients receive:

```ts
{
  type: 'server:packet';
  payload?: unknown;
}
```

The app route is fixed by `app:authenticate` or `app:open`; packet messages
cannot select or restate an app. Citadel does not inspect or validate `payload`.

## Relay Guarantees

- Only the server with an app's configured PSK can register that app.
- An app has at most one live app server.
- Every app open requires a JWT that validates against the one configured issuer and audience.
- Unauthenticated sockets have a five-second setup deadline and cannot probe app availability.
- Pre-authentication garbage and concurrent authentication messages close the socket.
- WebSocket messages are limited to 64 KiB.
- Verified client identity is immutable for an app session and never grants admission by itself.
- Citadel forwards only the verified subject to that app server and never forwards the original JWT or other claims.
- Client packets travel only to the app server.
- Only app servers can unicast or broadcast downstream.
- Broadcasts exclude pending and rejected clients.
- The relay, not `hello` or payload data, supplies trusted connection and client identity.
- Losing an app server closes every connection for its app.
- Relay state is in memory and disappears when the process exits.

## Errors

Protocol and routing failures use:

```ts
{ type: 'error:notice'; message: string }
```

Authentication failures use WebSocket close code `4401`; oversized messages use `1009`. IP-based rate limiting and connection quotas belong at the deployment edge rather than in the app-routing protocol.
