# Developing The Platform

The reusable Citadel SDK/runtime lives outside this host repo at:

```text
/Users/suwenhao/citadel-platform
```

That repository publishes `@citadel-platform/platform`, which provides the contracts and runtime helpers used by hosts and app packages.

Use the platform repo when changing:

- public app contracts under `@citadel-platform/platform/app`
- client app contracts under `@citadel-platform/platform/client`
- server app contracts under `@citadel-platform/platform/server-app`
- persistence helpers under `@citadel-platform/platform/persistence`
- the reusable Socket.IO server runtime under `@citadel-platform/platform/server`
- the `citadel-generate-app-metadata` CLI

Verify platform changes in that repo:

```bash
npm install
npm run build
npm run typecheck
npm test
npm pack --dry-run
```

After publishing a new `@citadel-platform/platform` version, update this host's dependency and run the host verification suite.
