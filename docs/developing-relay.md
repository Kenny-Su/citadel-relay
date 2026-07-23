# Developing The Relay Server

The reusable router lives under `src/relay`:

- `app.ts` and `shared.ts`: public asymmetric routing contract.
- `auth.ts`: app-owner PSK configuration and authentication.
- `server.ts`: namespace claims, pending tunnels, admission state, and packet routing.
- `trafficLog.ts`: opt-in routing diagnostics.

Process startup lives in `src/server/index.ts`. The untracked `relay.config.json` contains app-owner keys and exact claimed paths.

Verify changes with:

```bash
npm run typecheck
npm test
```

Keep browser identity, ACLs, subrooms, presence, app validation, persistence, and domain behavior in namespace owners. The relay should only authenticate owners and route opaque traffic across exact first-level boundaries.
