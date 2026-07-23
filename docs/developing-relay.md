# Developing The Relay Server

The reusable router lives under `src/relay`:

- `app.ts` and `shared.ts`: public asymmetric routing contract.
- `auth.ts`: app-server PSK authentication and global client JWT verification.
- `server.ts`: app registration, pending tunnels, admission state, and packet routing.
- `trafficLog.ts`: opt-in routing diagnostics.

Process startup lives in `src/server/index.ts`. The untracked `relay.config.json`
contains app-server keys, exact app IDs, and the required global client JWT
issuer, audience, local public-key path, and fixed signing algorithm.

Verify changes with:

```bash
npm run typecheck
npm test
```

Keep client token issuance, ACLs, subrooms, presence, app validation, persistence, and domain behavior in app servers. The relay verifies global client JWT identity and forwards only the trusted subject; identity must never imply admission or authorization.

Keep IP rate limits, concurrent-connection quotas, TLS termination, and volumetric abuse controls at the reverse proxy or network edge. The relay only enforces its short authentication deadline, first-message role gate, and message-size bound.
