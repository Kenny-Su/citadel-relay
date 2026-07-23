# Developing The Relay Server

The reusable router lives under `src/relay`:

- `app.ts` and `shared.ts`: public asymmetric routing contract.
- `auth.ts`: app-owner PSK authentication and global client JWT verification.
- `server.ts`: namespace claims, pending tunnels, admission state, and packet routing.
- `trafficLog.ts`: opt-in routing diagnostics.

Process startup lives in `src/server/index.ts`. The untracked `relay.config.json` contains app-owner keys, exact claimed paths, and required global client JWT issuer/JWKS settings.

Verify changes with:

```bash
npm run typecheck
npm test
```

Keep client token issuance, ACL interpretation, subrooms, presence, app validation, persistence, and domain behavior in namespace owners. The relay may verify global client JWT identity and forward trusted claims, but identity must never imply admission or authorization.

Keep IP rate limits, concurrent-connection quotas, TLS termination, and volumetric abuse controls at the reverse proxy or network edge. The relay only enforces its short authentication deadline, first-message role gate, and message-size bound.
