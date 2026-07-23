# Citadel Relay Communication Protocol

Citadel routes opaque traffic between anonymous browser connections and authenticated app servers. It enforces exact first-level namespace ownership and packet direction. Each namespace owner implements browser authentication, ACLs, subrooms, presence, and application behavior.

## Transport

- WebSocket endpoint: `ws://localhost:3001/ws`
- Health endpoint: `GET /health`

Messages are JSON objects with a string `type`. Use `wss://` outside local development.

## Roles

### App owner

An app owner authenticates with a configured 256-bit PSK and claims its configured path. Only the current owner can accept clients or send downstream packets for that namespace.

### Namespace client

A browser is anonymous to Citadel. It opens a namespace and receives a relay-generated `connectionId`. While pending, it can exchange opaque handshake packets only with the owner. Once accepted, it can receive owner broadcasts.

## App Owner Configuration

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

Generate a key with `openssl rand -hex 32`. Citadel validates unique names, keys, and paths at startup, decodes each key to exactly 32 bytes, and performs fixed-length constant-time comparisons.

Namespaces are exact first-level paths. `/chat` does not authorize `/chat-admin`, `/chat/private`, or `/files`.

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

## Opening A Browser Connection

Browser to relay:

```ts
{
  type: 'namespace:open';
  namespace: '/chat';
  hello?: unknown;
}
```

The `hello` value is opaque to Citadel. It may contain an app resume token, guest request, or handshake metadata.

The browser receives:

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
  hello?: unknown;
}
```

Pending clients cannot receive broadcasts. They can exchange unicast handshake packets with the owner.

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

Citadel reports `state: 'admitted'` or `state: 'rejected'` to the browser. The owner can later revoke either a pending or admitted connection:

```ts
{
  type: 'namespace:revoke';
  connectionId: string;
  message?: string;
}
```

The browser can explicitly send `{ type: 'namespace:close' }`. On browser closure or disconnect, the owner receives `namespace:disconnect` with the trusted connection ID and prior admission state.

## Upstream Client Packets

A pending or admitted browser sends:

```ts
{
  type: 'client:packet';
  payload?: unknown;
}
```

The browser cannot choose a target. Citadel sends only to the namespace owner and adds trusted routing metadata:

```ts
{
  type: 'client:packet';
  namespace: '/chat';
  from: {
    connectionId: string;
    state: 'pending' | 'admitted';
  };
  payload?: unknown;
}
```

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
- Client packets travel only to the owner.
- Only owners can unicast or broadcast downstream.
- Broadcasts exclude pending and rejected clients.
- The relay, not payload data, supplies connection identity.
- Losing an owner closes every connection under its namespace.
- Relay state is in memory and disappears when the process exits.

## Errors

Protocol and routing failures use:

```ts
{ type: 'error:notice'; message: string }
```
