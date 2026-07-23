# Citadel Relay Communication Protocol

Citadel routes opaque traffic between authenticated clients and authenticated app servers. It enforces exact first-level namespace ownership, packet direction, and client JWT identity. Each namespace owner implements admission, ACLs, subrooms, presence, and application behavior.

## Transport

- WebSocket endpoint: `ws://localhost:3001/ws`
- Health endpoint: `GET /health`
- Maximum WebSocket message size: 65,536 bytes

Messages are JSON objects with a string `type`. Use `wss://` outside local development.

Every connection has five seconds to establish its role. Before authentication, its first valid message must be either `auth:authenticate` for an owner or `namespace:open` with a client JWT. Malformed, unknown, or additional messages while authentication is running close the connection with code `4401`. Messages larger than the maximum close with code `1009`.

## Roles

### App owner

An app owner authenticates with a configured 256-bit PSK and claims its configured path. Only the current owner can accept clients or send downstream packets for that namespace.

### Namespace client

A client presents a JWT from Citadel's configured global issuer. It opens a namespace and receives a relay-generated `connectionId`. While pending, it can exchange opaque handshake packets only with the owner. Once accepted, it can receive owner broadcasts.

## App Owner Configuration

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
    "issuer": "https://identity.example.com/",
    "audience": "citadel-relay",
    "jwksUri": "https://identity.example.com/.well-known/jwks.json",
    "algorithms": ["RS256"]
  }
}
```

Generate a key with `openssl rand -hex 32`. Citadel validates unique names, keys, and paths at startup, decodes each key to exactly 32 bytes, and performs fixed-length constant-time comparisons.

Namespaces are exact first-level paths. `/chat` does not authorize `/chat-admin`, `/chat/private`, or `/files`.

The top-level `clientJwt` block is required and applies to every namespace. Citadel obtains public verification keys from the configured remote JWKS, caches them, and allows the key set to rotate. The JWKS URI must use HTTPS except on loopback development hosts. Only explicitly configured asymmetric algorithms are accepted.

## Owner Authentication And Claim

Owner to relay:

```ts
{
  type: 'auth:authenticate';
  token: string;
}
```

Successful response:

```ts
{
  type: 'auth:state';
  principal: { id: string; name?: string };
}
```

Claim the configured namespace:

```ts
{ type: 'namespace:claim'; namespace: '/chat' }
```

Confirmation:

```ts
{ type: 'namespace:claimed'; namespace: '/chat' }
```

An owner can send `namespace:release`. Disconnecting also releases every owned namespace and closes its clients.

## Opening A Client Connection

Client to relay:

```ts
{
  type: 'namespace:open';
  namespace: '/chat';
  credential: {
    type: 'jwt';
    token: string;
  };
  hello?: unknown;
}
```

Citadel verifies the credential's signature, asymmetric algorithm, issuer, audience, subject, expiration, and optional not-before claim before checking whether the requested namespace is available or creating a pending session. A missing or unverifiable credential closes the connection with WebSocket code `4401`, and the namespace owner is not notified.

The `hello` value is opaque and untrusted to Citadel. It may contain an app resume token or handshake metadata. Identity-like data inside `hello` is not verified client identity.

The client receives:

```ts
{
  type: 'namespace:state';
  namespace: '/chat';
  state: 'pending';
  connectionId: string;
}
```

The owner receives:

```ts
{
  type: 'namespace:connect';
  requestId: string;
  namespace: '/chat';
  connectionId: string;
  identity: {
    subject: string;
  };
  hello?: unknown;
}
```

`identity.subject` is copied from the verified JWT subject and is fixed for that namespace session. Citadel does not forward the original bearer token, issuer, protected header, or other claims. JWT expiration after the session opens does not automatically disconnect the client.

Pending clients cannot receive broadcasts. They can exchange unicast handshake packets with the owner. Verified identity does not change the pending state.

## App-Owned Admission

After applying its authentication and ACL rules, the owner accepts:

```ts
{ type: 'namespace:accept'; requestId: string }
```

Or rejects:

```ts
{
  type: 'namespace:reject';
  requestId: string;
  message?: string;
}
```

Citadel reports `state: 'admitted'` or `state: 'rejected'` to the client. The owner can later revoke either a pending or admitted connection:

```ts
{
  type: 'namespace:revoke';
  connectionId: string;
  message?: string;
}
```

The client can explicitly send `{ type: 'namespace:close' }`. On closure or disconnect, the owner receives `namespace:disconnect` with the trusted connection ID, prior admission state, and verified identity.

## Upstream Client Packets

A pending or admitted client sends:

```ts
{
  type: 'client:packet';
  payload?: unknown;
}
```

The client cannot choose a target. Citadel sends only to the namespace owner and adds trusted routing and identity metadata:

```ts
{
  type: 'client:packet';
  namespace: '/chat';
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

Only the authenticated current owner can send:

```ts
{
  type: 'server:packet';
  namespace: '/chat';
  target: 'all' | { connectionId: string };
  payload?: unknown;
}
```

- `target: 'all'` reaches all admitted clients in the owner's namespace.
- Connection targets may address a pending client for handshake traffic or an admitted client for normal traffic.
- Targets must belong to that exact namespace and owner.
- Namespace clients cannot send `server:packet`.

Recipients receive:

```ts
{
  type: 'server:packet';
  namespace: '/chat';
  payload?: unknown;
}
```

Citadel does not inspect or validate `payload`.

## Relay Guarantees

- Only a configured PSK principal can claim its exact namespace.
- A namespace has at most one live owner.
- Every namespace open requires a JWT that validates against the one configured issuer and audience.
- Unauthenticated sockets have a five-second setup deadline and cannot probe namespace availability.
- Pre-authentication garbage and concurrent authentication messages close the socket.
- WebSocket messages are limited to 64 KiB.
- Verified client identity is immutable for a namespace session and never grants admission by itself.
- Citadel forwards only the verified subject to that namespace owner and never forwards the original JWT or other claims.
- Client packets travel only to the owner.
- Only owners can unicast or broadcast downstream.
- Broadcasts exclude pending and rejected clients.
- The relay, not `hello` or payload data, supplies trusted connection and client identity.
- Losing an owner closes every connection under its namespace.
- Relay state is in memory and disappears when the process exits.

## Errors

Protocol and routing failures use:

```ts
{ type: 'error:notice'; message: string }
```

Authentication failures use WebSocket close code `4401`; oversized messages use `1009`. IP-based rate limiting and connection quotas belong at the deployment edge rather than in the namespace-routing protocol.
