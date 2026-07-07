import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as appContract from '../../src/platform/app.js';
import * as persistenceContract from '../../src/platform/persistence.js';
import * as serverRuntime from '../../src/platform/server.js';
import * as validationContract from '../../src/platform/validation.js';

const platformEntrypointNames = ['app', 'client', 'persistence', 'server', 'server-app', 'validation'] as const;

type PackageJson = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
  scripts?: Record<string, string>;
};

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function jsonSource<T>(path: string) {
  return JSON.parse(source(path)) as T;
}

function exists(path: string) {
  return existsSync(join(process.cwd(), path));
}

function sortedExportKeys(module: Record<string, unknown>) {
  return Object.keys(module).sort();
}

describe('app package import boundaries', () => {
  it('keeps the platform contract inside the host source tree', () => {
    for (const entrypoint of platformEntrypointNames) {
      expect(exists(`src/platform/${entrypoint}.ts`)).toBe(true);
    }

    expect(exists('vendor/citadel-platform/platform')).toBe(false);
    expect(source('docs/communication-protocol.md')).toContain('a string app id known to the installed app catalog');
  });

  it('removes external platform package coupling from the host', () => {
    const rootPackage = jsonSource<PackageJson>('package.json');
    const packageLock = source('package-lock.json');

    expect(rootPackage.name).toBe('citadel-host');
    expect(rootPackage.workspaces).toBeUndefined();
    expect(rootPackage.dependencies?.['@citadel-platform/platform']).toBeUndefined();
    expect(rootPackage.dependencies?.['@citadel-platform/app-snake']).toBeUndefined();
    expect(packageLock).not.toContain('@citadel-platform/platform');
    expect(packageLock).not.toContain('vendor/citadel-platform/platform');
    expect(packageLock).not.toContain('registry.npmjs.org/@citadel-platform');
    expect(rootPackage.scripts).not.toHaveProperty('build:platform');
    expect(rootPackage.scripts).not.toHaveProperty('dev:packages');
  });

  it('keeps bundled app assembly on protocol-following installed package imports', () => {
    const bundledApps = jsonSource<{ packages: string[] }>('bundled-apps.json');
    const generatedCatalog = source('src/bundledApps/generatedAppCatalog.ts');
    const definitions = source('src/bundledApps/definitions.ts');
    const serverRegistry = source('src/bundledApps/serverRegistry.ts');
    const clientRegistry = source('src/client/appRegistry.tsx');
    const generator = source('scripts/generate-bundled-apps.mjs');

    expect(bundledApps.packages).toEqual([]);
    expect(definitions).toContain("from './generatedAppCatalog.js'");
    expect(serverRegistry).toContain("from './catalog.js'");
    expect(clientRegistry).toContain("from '../bundledApps/catalog'");
    expect(generatedCatalog).toContain("from '../platform/app.js'");
    expect(generatedCatalog).toContain('export const bundledInstalledApps = [');
    expect(generatedCatalog).not.toMatch(/@citadel-platform\/platform/);
    expect(generatedCatalog).not.toMatch(/@citadel-platform\/app-/);
    expect(generator).not.toContain('root surface must export an app package descriptor');
    expect(generator).toContain('must be a client app registration');
    expect(generator).toContain('must be a server app factory, registration, or module');
  });

  it('loads intentional host-owned platform runtime values', () => {
    expect(sortedExportKeys(appContract)).toEqual([
      'APP_ID_MAX_LENGTH',
      'APP_ID_PATTERN',
      'DEFAULT_SPACE_ID',
      'DISPLAY_NAME_MAX_LENGTH',
      'GUEST_ID_MAX_LENGTH',
      'GUEST_ID_PATTERN',
      'SPACE_ID_MAX_LENGTH',
      'SPACE_ID_PATTERN',
      'isAppId',
      'normalizeGuestId',
      'normalizeSpaceId'
    ].sort());
    expect(sortedExportKeys(persistenceContract)).toEqual(['openCitadelDatabase']);
    expect(sortedExportKeys(serverRuntime)).toEqual(['createPlatformServer']);
    expect(sortedExportKeys(validationContract)).toEqual(['validateDisplayName']);
  });

  it('keeps app implementation source and old package tooling out of the host platform', () => {
    expect(exists('packages/platform')).toBe(false);
    expect(exists('packages/apps')).toBe(false);
    expect(exists('local-external-apps.json')).toBe(false);
    expect(exists('scripts/pack-local-package.mjs')).toBe(false);
    expect(exists('scripts/install-packed-local-package.mjs')).toBe(false);
    expect(exists('scripts/install-local-external-apps.mjs')).toBe(false);
    expect(exists('scripts/local-external-apps.mjs')).toBe(false);
    expect(exists('src/apps')).toBe(false);
    expect(exists('src/server/chatServer.ts')).toBe(false);
    expect(exists('src/server/legacyAppRepositories.ts')).toBe(false);
  });
});
