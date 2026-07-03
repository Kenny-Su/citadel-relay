# Adding Apps To A Citadel Host

Citadel hosts compose apps at install time. You do not edit host source code to add an app; you install an npm package, list it in `bundled-apps.json`, regenerate the generated catalog, and rebuild the host.

## Install Apps

Install one or more app packages into the host:

```bash
npm install @citadel-platform/app-chat @citadel-platform/app-chess @citadel-platform/app-snake
```

Private packages, git dependencies, local tarballs, and workspace-linked packages are fine as long as they resolve from `node_modules`:

```bash
npm install @your-scope/citadel-app-demo
npm install ../citadel-app-demo/citadel-app-demo-0.1.0.tgz
npm install git+ssh://git@github.com/your-org/citadel-app-demo.git
```

## Select Apps

Edit `bundled-apps.json` in the host. The order controls the app tab order and the default app when the host has at least one app:

```json
{
  "packages": [
    "@citadel-platform/app-chat",
    "@citadel-platform/app-chess",
    "@citadel-platform/app-snake"
  ]
}
```

Keep package names here, not app ids. The generator reads each installed package's `package.json#citadel.appId`.

## Regenerate And Build

Regenerate the host catalog after changing `bundled-apps.json` or changing app package versions:

```bash
npm run generate:bundled-apps
npm run build
```

For production, commit the changed `package.json`, `package-lock.json`, `bundled-apps.json`, and `src/bundledApps/generatedAppCatalog.ts`.

## Enable A Subset At Runtime

`bundled-apps.json` decides which apps are installed into the host build. `CITADEL_ENABLED_APPS` can narrow that set at runtime by app id:

```bash
CITADEL_ENABLED_APPS=chat,snake npm start
```

Unknown ids are ignored. If nothing valid remains, the host falls back to the installed catalog order. With the checked-in empty host, no apps are enabled.

## Remove An App

Remove the package from `bundled-apps.json`, uninstall it, regenerate, and rebuild:

```bash
npm uninstall @citadel-platform/app-chat
npm run generate:bundled-apps
npm run build
```

## Troubleshooting

- Missing package: run `npm install`; every package in `bundled-apps.json` must exist under `node_modules`.
- Invalid metadata: the app package must declare `package.json#citadel` with `appId`, `label`, `defaultSpaceId`, `persistence`, `version`, `client`, and `server`.
- Missing export: the app package must export `.`, `./client`, and `./server` from built JavaScript.
- Stale catalog: run `npm run generate:bundled-apps`; CI checks this with `npm run check:bundled-apps`.
- Duplicate app id: only one installed package can claim a given `citadel.appId`.
