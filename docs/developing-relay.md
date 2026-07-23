# Developing The Relay Server

The reusable relay contracts and runtime live under `src/relay`.

Use this area when changing:

- Wire message types and helpers in `src/relay/app.ts` and `src/relay/shared.ts`.
- App-owner PSK authentication in `src/relay/auth.ts`.
- Display name and space validation in `src/relay/validation.ts`.
- The Express and raw WebSocket runtime in `src/relay/server.ts`.
- Process startup in `src/server/index.ts`.

Verify relay changes from this repo:

```bash
npm run typecheck
npm test
```

Keep app ACLs, UI, state, validation, persistence, and domain rules outside this server. The relay only authenticates configured owners and records exact namespace claims.
