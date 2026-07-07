# Developing The Host Platform

The reusable Citadel contracts and runtime now live inside this host repo under `src/platform`.

Use this area when changing:

- public app metadata and wire payload types in `src/platform/app.ts` and `src/platform/shared.ts`
- client app registration shape in `src/platform/client.ts`
- server app context, module, factory, and service shapes in `src/platform/server-app.ts`
- persistence helpers in `src/platform/persistence.ts`
- the Socket.IO/Express host runtime in `src/platform/server.ts`
- host validation helpers in `src/platform/validation.ts`

External apps do not need to import these modules. They follow the documented metadata, module export shapes, and Socket.IO protocol. Keep those docs updated whenever a platform contract change affects app authors.

Verify host platform changes from this repo:

```bash
npm run generate:bundled-apps
npm run typecheck
npm test
```
