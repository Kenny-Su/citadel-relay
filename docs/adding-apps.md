# Adding Apps To A Citadel Host

Citadel hosts support build-time bundled apps and trusted runtime extension uploads. Citadel packages in this repo are local `file:` dependencies, so host installs do not require the removed `@citadel-platform` npm registry packages.

## Runtime Extension Uploads

Use the host UI to upload a built extension zip. The server validates and stores it under `data/extensions/<appId>/<version>/`, records it in `data/extensions/installed-apps.json`, and returns a restart-required message. Restart the host to load the extension.

The zip must contain:

- `package.json` with `citadel` metadata.
- `citadel.client.bundle`, pointing to a browser-ready ESM client bundle in the zip.
- `citadel.server.module`, pointing to a Node ESM server module in the zip.

Uploaded extensions are trusted admin code. They execute in the browser and server process after restart.

## Bundled Apps

Bundled apps are local package dependencies selected at build time. Add one or more app packages to `package.json` with `file:` paths:

```bash
npm install ../citadel-app-demo --save
```

Local tarballs and workspace-linked packages are fine as long as they resolve from `node_modules`:

```bash
npm install ../citadel-app-demo/citadel-app-demo-0.1.0.tgz
```

## Select Apps

Edit `bundled-apps.json` in the host. The order controls the app tab order and the default app when the host has at least one app:

```json
{
  "packages": [
    "@your-scope/citadel-app-demo",
    "@your-scope/citadel-app-board"
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

Commit the changed `package.json`, `package-lock.json`, `bundled-apps.json`, and `src/bundledApps/generatedAppCatalog.ts`.

## Enable A Subset At Runtime

`bundled-apps.json` decides which apps are installed into the host build. `CITADEL_ENABLED_APPS` can narrow that set at runtime by app id:

```bash
CITADEL_ENABLED_APPS=chat,snake npm run dev:server
```

Unknown ids are ignored. If nothing valid remains, the host falls back to the installed catalog order.

## Remove An App

Remove the package from `bundled-apps.json`, uninstall or remove the local dependency, regenerate, and rebuild:

```bash
npm uninstall @your-scope/citadel-app-demo
npm run generate:bundled-apps
npm run build
```

## Troubleshooting

- Missing package: run `npm install`; every package in `bundled-apps.json` must exist under `node_modules`.
- Invalid metadata: the app package must declare `package.json#citadel` with `appId`, `label`, `defaultSpaceId`, `persistence`, `version`, `client`, and `server`.
- Missing export: the app package must export `.`, `./client`, and `./server` from built JavaScript.
- Stale catalog: run `npm run generate:bundled-apps`; CI checks this with `npm run check:bundled-apps`.
- Duplicate app id: only one installed package can claim a given `citadel.appId`.
