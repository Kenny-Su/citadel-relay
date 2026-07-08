# Citadel Relay Communication Protocol

Citadel is a network-only relay. Apps connect over raw WebSocket, join a space, send packets, and receive packets from other participants in that space.

Citadel does not install apps, load app code, persist app state, or validate app-specific payloads.

## Transport

- HTTP server: `http://localhost:3001`
- WebSocket endpoint: `ws://localhost:3001/ws`
- Health endpoint: `GET /health`

## Relay Concepts

- `spaceId`: lowercase letters, numbers, and hyphens; invalid values normalize to `general`.
- `participant`: `{ id: string; connectionId: string; name: string }`.
- `participant.id`: stable guest id supplied by the client when valid, otherwise the generated connection id.
- `connectionId`: generated per WebSocket connection.

## Client To Server

Join or move to a space:

```ts
{
  type: 'space:join';
  spaceId?: string;
  guestId?: string;
  name: string;
}
```

Send an app-owned packet:

```ts
{
  type: 'space:packet';
  topic?: string;
  payload?: unknown;
  target?: 'space' | 'others';
}
```

Leave the current space:

```ts
{
  type: 'space:leave';
}
```

## Server To Client

Current space participants:

```ts
{
  type: 'space:state';
  spaceId: string;
  participants: Participant[];
}
```

Presence:

```ts
{
  type: 'participant:joined' | 'participant:left';
  spaceId: string;
  participant: Participant;
  createdAt: string;
}
```

Relayed packet:

```ts
{
  type: 'space:packet';
  spaceId: string;
  from: Participant;
  topic?: string;
  payload?: unknown;
  createdAt: string;
}
```

Error notice:

```ts
{
  type: 'error:notice';
  message: string;
}
```

## Relay Behavior

- A connection must join a space before sending `space:packet`.
- `target: 'space'` broadcasts to everyone in the space, including the sender.
- `target: 'others'` broadcasts to everyone in the space except the sender.
- Missing `target` defaults to `space`.
- Citadel validates only the relay envelope. Payload shape and meaning are app-owned.
- Relay state is in memory and disappears when the server process exits.
