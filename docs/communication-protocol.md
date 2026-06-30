# Platform Communication Protocol

Citadel uses Socket.IO so the browser and server can keep a live connection open. The platform protocol is app-neutral: clients join an app space, receive presence and app state, then exchange app events through a shared envelope.

## Transport

- Client: React browser app
- Server: Express and Socket.IO
- Local backend: `http://localhost:3001`
- Local frontend: `http://localhost:5173`
- Socket path: `/socket.io`

In development, Vite forwards Socket.IO traffic from the frontend to the backend.

## Platform Concepts

- `appId`: one of `chat`, `chess`, or `snake`
- `spaceId`: lowercase letters, numbers, and hyphens; invalid values normalize to `general`
- `participant`: `{ id: string; socketId?: string; name: string }`

`participant.id` is a stable guest id stored by the browser. `socketId` is the current live connection id and can change after reconnect.

Routes use `/apps/:appId/spaces/:spaceId`. Legacy `/rooms/:spaceId` links are normalized by the client into `/apps/chat/spaces/:spaceId`.

## Platform Events

### Client To Server

`space:join`

```ts
{
  appId: "chat" | "chess" | "snake";
  spaceId?: string;
  guestId?: string;
  name: string;
}
```

`app:event`

```ts
{
  appId: "chat" | "chess" | "snake";
  type: string;
  payload?: unknown;
}
```

### Server To Client

`space:state`

```ts
{
  appId: "chat" | "chess" | "snake";
  spaceId: string;
  participants: Participant[];
  appState: unknown;
}
```

`participant:joined` and `participant:left`

```ts
{
  id: string;
  type: "participant:joined" | "participant:left";
  appId: "chat" | "chess" | "snake";
  spaceId: string;
  participant: Participant;
  createdAt: string;
}
```

`app:event`

```ts
{
  appId: "chat" | "chess" | "snake";
  type: string;
  payload?: unknown;
}
```

`error:notice`

```ts
{
  message: string;
}
```

## Bundled App Events

Chat:

- client `chat:message:send` with `{ body: string }`
- client `chat:typing:start`
- client `chat:typing:stop`
- server `chat:message:new`
- server `chat:typing:update`
- server `chat:notice`

Chat history is persisted in app-owned `chat_messages` rows.

Chess:

- client `chess:move` with `{ from: string; to: string; promotion?: string }`
- server `chess:state`
- server `chess:notice`

Chess games and moves are persisted by space, so stable guest ids preserve white/black ownership across reconnects.

Snake:

- client `snake:direction` with `{ direction: "up" | "down" | "left" | "right" }`
- server `snake:state`

Snake state is live-only in this version.

## Validation

- Display names cannot be empty.
- Display names must be 24 characters or fewer.
- Space IDs can use lowercase letters, numbers, and hyphens.
- Space IDs must be 32 characters or fewer.
- Chat messages cannot be empty.
- Chat messages must be 500 characters or fewer.
