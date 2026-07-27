# Developing The Relay Server

The reusable router lives under `src/relay`:

- `app.ts` and `shared.ts`: public asymmetric routing contract.
- `auth.ts`: static authenticator compatibility and global client JWT verification.
- `server.ts`: app registration, pending tunnels, admission state, and packet routing.
- `trafficLog.ts`: opt-in routing diagnostics.

The admin control plane lives under `src/admin`. Its SQLite store owns app
registrations, while its React client is built and served at `/admin/`. Process
startup lives in `src/server/index.ts`.

After any first-start migration, the untracked `relay.config.json` contains only
the compatibility-only client JWT issuer and audience, local public-key path, and fixed
verification algorithm. Legacy app entries are imported into SQLite once and
removed from the file.

Verify changes with:

```bash
npm run typecheck
npm test
npm run build
```

Keep client token issuance in the identity server. Keep ACLs, subrooms,
presence, app validation, persistence, and domain behavior in app servers. The
relay loads only the public key, verifies each client JWT without interpreting
its claims, and forwards the valid token to the selected app; verification must never imply admission or
authorization.

Keep IP rate limits, concurrent-connection quotas, TLS termination, and volumetric abuse controls at the reverse proxy or network edge. The relay only enforces its short authentication deadline, first-message role gate, and message-size bound.
