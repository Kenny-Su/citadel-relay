import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const platformEntrypointNames = ['app', 'client', 'persistence', 'server', 'server-app', 'validation'] as const;
const platformSourceModuleNames = [
  'app',
  'appContract',
  'appPackageMetadata',
  'client',
  'clientAppContract',
  'installedAppCatalogContract',
  'persistence',
  'server',
  'serverApp',
  'serverAppContract',
  'shared',
  'sqlite',
  'validation',
  'version'
] as const;

type PackageExportTarget = string | {
  types?: string;
  import?: string;
};

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  exports: Record<string, PackageExportTarget>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  citadel?: {
    appId: string;
    label: string;
    defaultSpaceId: string;
    persistence: 'none' | 'sqlite';
    version: string;
    client: {
      subpath: string;
      registrationExport: string;
    };
    server: {
      subpath: string;
      registrationExport: string;
    };
  };
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

function packageExportEntries(packageJson: Pick<PackageJson, 'exports'>) {
  return Object.entries(packageJson.exports).map(([subpath, target]) => ({
    subpath,
    importTarget: typeof target === 'string' ? target : target.import ?? '',
    typesTarget: typeof target === 'string' ? '' : target.types ?? ''
  }));
}

function sortedExportKeys(module: Record<string, unknown>) {
  return Object.keys(module).sort();
}

const publicRuntimeExports = {
  '@citadel-platform/platform/app': [
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
  ],
  '@citadel-platform/platform/client': [],
  '@citadel-platform/platform/server-app': [],
  '@citadel-platform/platform/persistence': ['openCitadelDatabase'],
  '@citadel-platform/platform/server': ['createPlatformServer'],
  '@citadel-platform/platform/validation': ['validateDisplayName']
} as const satisfies Record<string, readonly string[]>;

describe('app package import boundaries', () => {
  it('keeps platform core free of concrete apps and root compatibility imports', () => {
    for (const moduleName of platformSourceModuleNames) {
      const moduleSource = source(`packages/platform/src/${moduleName}.ts`);

      expect(moduleSource).not.toContain('../apps/');
      expect(moduleSource).not.toContain('../../../src/');
      expect(moduleSource).not.toMatch(/@citadel\/app-(?:chat|chess|snake)/);
    }

    expect(source('packages/platform/src/shared.ts')).not.toMatch(/'chat'|'chess'|'snake'/);
    expect(source('packages/platform/src/server.ts')).not.toMatch(/'chat'|'chess'|'snake'/);
    expect(source('packages/platform/src/appContract.ts')).not.toContain('react');
    expect(source('docs/communication-protocol.md')).toContain('a string app id known to the installed app catalog');
  });

  it('keeps platform contracts split by environment', () => {
    expect(source('packages/platform/src/appContract.ts')).not.toMatch(
      /clientAppContract|serverAppContract|ComponentType/
    );
    expect(source('packages/platform/src/installedAppCatalogContract.ts')).toContain('ClientAppRegistration');
    expect(source('packages/platform/src/installedAppCatalogContract.ts')).toContain('ServerAppRegistration');
    expect(source('packages/platform/src/installedAppCatalogContract.ts')).not.toMatch(/from 'react'|ComponentType/);
    expect(source('packages/platform/src/clientAppContract.ts')).toContain("from 'react'");
    expect(source('packages/platform/src/clientAppContract.ts')).not.toContain('serverAppContract');
    expect(source('packages/platform/src/serverAppContract.ts')).not.toMatch(
      /clientAppContract|react|ComponentType/
    );
  });

  it('removes platform-local app source and local external app migration tooling', () => {
    expect(exists('packages/apps')).toBe(false);
    expect(exists('local-external-apps.json')).toBe(false);
    expect(exists('scripts/pack-local-package.mjs')).toBe(false);
    expect(exists('scripts/install-packed-local-package.mjs')).toBe(false);
    expect(exists('scripts/install-local-external-apps.mjs')).toBe(false);
    expect(exists('scripts/local-external-apps.mjs')).toBe(false);
  });

  it('keeps the host empty by default and platform as the only workspace', () => {
    const rootPackage = jsonSource<PackageJson>('package.json');
    const platformPackage = jsonSource<PackageJson>('packages/platform/package.json');

    expect(rootPackage.workspaces).toEqual(['packages/platform']);
    expect(rootPackage.dependencies?.['@citadel-platform/platform']).toBe(platformPackage.version);
    expect(Object.keys(rootPackage.dependencies ?? {}).filter((name) => name.startsWith('@citadel-platform/app-'))).toEqual([]);
    expect(rootPackage.scripts?.['build:packages']).toBe('npm run build:platform');
    expect(rootPackage.scripts?.['test:packages']).toBe('npm run test -w @citadel-platform/platform');
    expect(rootPackage.scripts).not.toHaveProperty('install:local-external-apps');
    expect(rootPackage.scripts).not.toHaveProperty('pack:local-package');
  });

  it('keeps bundled app assembly on generated installed package imports', () => {
    const bundledApps = jsonSource<{ packages: string[] }>('bundled-apps.json');
    const generatedCatalog = source('src/bundledApps/generatedAppCatalog.ts');
    const definitions = source('src/bundledApps/definitions.ts');
    const serverRegistry = source('src/bundledApps/serverRegistry.ts');
    const clientRegistry = source('src/client/appRegistry.tsx');

    expect(bundledApps.packages).toEqual([]);
    expect(definitions).toContain("from './generatedAppCatalog.js'");
    expect(serverRegistry).toContain("from './catalog.js'");
    expect(clientRegistry).toContain("from '../bundledApps/catalog'");
    expect(serverRegistry).not.toContain('generatedAppCatalog');
    expect(clientRegistry).not.toContain('generatedAppCatalog');
    expect(generatedCatalog).toContain('export const bundledInstalledApps = [');
    expect(generatedCatalog).not.toMatch(/@citadel-platform\/app-/);
  });

  it('does not expose platform package subpaths for source or implementation internals', () => {
    const forbiddenPackageExportPattern =
      /(?:^\.(?:\/src|\/dist\/src)(?:\/|$)|(?:View|repository|messageStore|manifest|shared)\.(?:js|ts|tsx)$|(?:^|\/)(?:ChatView|ChessView|SnakeView|repository|messageStore|manifest|shared)(?:$|\/))/;
    const packageJsons = [
      jsonSource<PackageJson>('packages/platform/package.json')
    ];

    for (const packageJson of packageJsons) {
      for (const { subpath, importTarget, typesTarget } of packageExportEntries(packageJson)) {
        expect(subpath).not.toMatch(forbiddenPackageExportPattern);
        expect(importTarget).not.toMatch(forbiddenPackageExportPattern);
        expect(typesTarget).not.toMatch(forbiddenPackageExportPattern);
      }
    }
  });

  it('loads only intentional public runtime values from built package artifacts', async () => {
    for (const specifier of Object.keys(publicRuntimeExports) as Array<keyof typeof publicRuntimeExports>) {
      const module = await import(specifier);

      expect(sortedExportKeys(module)).toEqual([...publicRuntimeExports[specifier]].sort());
    }
  });

  it('keeps package root source re-export shims and compatibility files removed', () => {
    for (const entrypoint of platformEntrypointNames) {
      expect(exists(`packages/platform/${entrypoint}.ts`)).toBe(false);
      expect(exists(`src/platform/${entrypoint}.ts`)).toBe(false);
    }

    expect(exists('src/apps')).toBe(false);
    expect(exists('src/persistence/sqlite.ts')).toBe(false);
    expect(exists('src/server/chatServer.ts')).toBe(false);
    expect(exists('src/server/legacyAppRepositories.ts')).toBe(false);
    expect(exists('src/shared/chat.ts')).toBe(false);
  });
});
