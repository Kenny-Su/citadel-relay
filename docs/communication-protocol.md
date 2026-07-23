# Citadel Relay Communication Protocol

Version `0.2.0` adds authenticated first-level namespace registration for app owners while retaining the existing raw WebSocket space relay.

## Transport

- WebSocket endpoint: `ws://localhost:3001/ws`
- Health endpoint: `GET /health`

## App Owner Authentication

The default runtime reads `relay.config.json`. Each app has a unique name, a 256-bit lowercase hexadecimal pre-shared key, and one exact first-level claimed path.

```ts
{ type: 'auth:authenticate'; token: string }
```

Successful response:

```ts
{ type: 'auth:state'; principal: { id: string; name?: string } }
```

Claim and release:

```ts
{ type: 'namespace:claim'; namespace: '/chat' }
{ type: 'namespace:release'; namespace: '/chat' }
```

The relay accepts a claim only when the authenticated principal is configured for the exact path and no other live connection owns it. Owner disconnect releases the claim.

## Browser Space Traffic

Browser space traffic remains unauthenticated in this release:

```ts
{
  type: 'space:join';
  spaceId?: string;
  guestId?: string;
  name: string;
}
```

```ts
{
  type: 'space:packet';
  topic?: string;
  payload?: unknown;
  target?: 'space' | 'others' | { connectionId: string };
}
```

Citadel validates the routing envelope but does not inspect app payloads.
