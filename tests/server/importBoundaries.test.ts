import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appIds = ['chat', 'chess', 'snake'] as const;
const appShimFilesById = {
  chat: [
    'ChatView.tsx',
    'client.tsx',
    'index.ts',
    'manifest.ts',
    'messageStore.ts',
    'server.ts',
    'serverEntry.ts',
    'shared.ts',
    'validation.ts'
  ],
  chess: [
    'ChessView.tsx',
    'client.tsx',
    'index.ts',
    'manifest.ts',
    'repository.ts',
    'server.ts',
    'serverEntry.ts',
    'shared.ts'
  ],
  snake: [
    'SnakeView.tsx',
    'client.tsx',
    'index.ts',
    'manifest.ts',
    'server.ts',
    'serverEntry.ts',
    'shared.ts'
  ]
} as const;
const platformEntrypointNames = ['app', 'client', 'persistence', 'server', 'server-app', 'validation'] as const;
const platformSourceModuleNames = [
  'app',
  'appContract',
  'client',
  'clientAppContract',
  'persistence',
  'server',
  'serverApp',
  'serverAppContract',
  'shared',
  'sqlite',
  'validation',
  'version'
] as const;
const deletedCompatibilityPaths = [
  'src/apps/catalog.ts',
  'src/apps/serverRegistry.ts',
  'src/apps/serverServices.ts',
  'src/persistence/sqlite.ts',
  'src/server/messageStore.ts',
  'src/server/validation.ts',
  'src/shared/chat.ts',
  'src/shared/platform.ts'
] as const;

const bundledAppAssemblyFiles = [
  'src/bundledApps/definitions.ts',
  'src/bundledApps/catalog.ts',
  'src/bundledApps/serverRegistry.ts',
  'src/client/appRegistry.tsx'
] as const;

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function jsonSource<T>(path: string) {
  return JSON.parse(source(path)) as T;
}

type PackageTsconfig = {
  extends?: string;
  include?: string[];
  compilerOptions?: Record<string, unknown>;
};

type PackageExportTarget = string | {
  types: string;
  import: string;
};

type PackageJson = {
  name: string;
  exports: Record<string, PackageExportTarget>;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
};

const packagePaths = [
  'packages/platform',
  'packages/apps/chat',
  'packages/apps/chess',
  'packages/apps/snake'
] as const;

const publicRuntimeExports = {
  '@citadel/platform/app': [
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
  '@citadel/platform/client': [],
  '@citadel/platform/server-app': [],
  '@citadel/platform/persistence': ['openCitadelDatabase'],
  '@citadel/platform/server': ['createPlatformServer'],
  '@citadel/platform/validation': ['validateDisplayName'],
  '@citadel/app-chat': ['MESSAGE_HISTORY_LIMIT', 'MESSAGE_MAX_LENGTH', 'chatManifest'],
  '@citadel/app-chat/client': ['chatClientApp'],
  '@citadel/app-chat/server': [
    'chatServerBundle',
    'createChatServerAppFromServices',
    'createChatRepository',
    'createSqliteMessageStore',
    'resolveChatRepository'
  ],
  '@citadel/app-chat/validation': ['validateMessageBody'],
  '@citadel/app-chess': ['chessManifest'],
  '@citadel/app-chess/client': ['chessClientApp'],
  '@citadel/app-chess/server': [
    'chessServerBundle',
    'createChessRepository',
    'createChessServerAppFromServices',
    'resolveChessRepository'
  ],
  '@citadel/app-snake': ['snakeManifest'],
  '@citadel/app-snake/client': ['snakeClientApp'],
  '@citadel/app-snake/server': ['createSnakeServerAppFromServices', 'snakeServerBundle']
} as const satisfies Record<string, readonly string[]>;

const forbiddenPackageExportPattern =
  /(?:^\.(?:\/src|\/dist\/src)(?:\/|$)|(?:View|repository|messageStore|serverEntry|manifest|shared)\.(?:js|ts|tsx)$|(?:^|\/)(?:ChatView|ChessView|SnakeView|repository|messageStore|serverEntry|manifest|shared)(?:$|\/))/;

function appImplementationPath(appId: (typeof appIds)[number], fileName: string) {
  return `packages/apps/${appId}/src/${fileName}`;
}

function exists(path: string) {
  return existsSync(join(process.cwd(), path));
}

function sortedExportKeys(module: Record<string, unknown>) {
  return Object.keys(module).sort();
}

function packageExportEntries(packageJson: Pick<PackageJson, 'exports'>) {
  return Object.entries(packageJson.exports).map(([subpath, target]) => ({
    subpath,
    importTarget: typeof target === 'string' ? target : target.import,
    typesTarget: typeof target === 'string' ? undefined : target.types
  }));
}

describe('app package import boundaries', () => {
  it('keeps platform core free of concrete apps and root compatibility imports', () => {
    for (const moduleName of platformSourceModuleNames) {
      const moduleSource = source(`packages/platform/src/${moduleName}.ts`);

      expect(moduleSource).not.toContain('../apps/');
      expect(moduleSource).not.toContain('../../../src/');
    }
    expect(source('packages/platform/src/appContract.ts')).not.toContain('react');
  });

  it('keeps platform contracts split by environment', () => {
    expect(source('packages/platform/src/appContract.ts')).not.toMatch(
      /clientAppContract|serverAppContract|ComponentType/
    );
    expect(source('packages/platform/src/clientAppContract.ts')).toContain("from 'react'");
    expect(source('packages/platform/src/clientAppContract.ts')).not.toContain('serverAppContract');
    expect(source('packages/platform/src/serverAppContract.ts')).not.toMatch(
      /clientAppContract|react|ComponentType/
    );
  });

  it('keeps neutral app indexes limited to manifests and shared types', () => {
    for (const appId of appIds) {
      const indexSource = source(appImplementationPath(appId, 'index.ts'));

      expect(indexSource).toContain(`export { ${appId}Manifest } from './manifest.js'`);
      expect(indexSource).toContain("} from './shared.js'");
      expect(indexSource).not.toMatch(
        /client|serverEntry|ServerBundle|Repository|messageStore|repository|validation|create[A-Z].*App/
      );
    }
  });

  it('keeps client registry wired to real app packages and platform client contracts', () => {
    const registry = source('src/client/appRegistry.tsx');

    expect(registry).toContain("from '../bundledApps/catalog'");
    expect(registry).toContain("from '@citadel/platform/app'");
    expect(registry).toContain("from '@citadel/platform/client'");
    for (const appId of appIds) {
      expect(registry).toContain(`from '@citadel/app-${appId}'`);
      expect(registry).toContain(`from '@citadel/app-${appId}/client'`);
      expect(registry).not.toContain(`@citadel/app-${appId}/server`);
      expect(registry).not.toContain(`@citadel/apps/${appId}`);
    }
  });

  it('keeps bundled server registry wired to real app server packages', () => {
    const registry = source('src/bundledApps/serverRegistry.ts');

    expect(registry).toContain("from './catalog.js'");
    expect(registry).toContain("from '@citadel/platform/server-app'");
    for (const appId of appIds) {
      expect(registry).toContain(`from '@citadel/app-${appId}/server'`);
      expect(registry).not.toContain(`@citadel/app-${appId}/client`);
      expect(registry).not.toContain(`@citadel/apps/${appId}`);
    }
    expect(registry).not.toMatch(
      /\.\/(?:chat|chess|snake)\/(?:client|server|manifest|shared|repository|messageStore|validation|ChatView|ChessView|SnakeView)\.js/
    );
    expect(registry).not.toMatch(/ChatServerAppServices|ChessServerAppServices/);
    expect(registry).not.toMatch(/resolveChatRepository|resolveChessRepository|resolveBundledRepositories/);
  });

  it('keeps app client code away from server-only surfaces', () => {
    const forbiddenClientImports =
      /(?:serverEntry|serverAppContract|messageStore|repository|node:fs|node:path|node:sqlite|from ['"]\.\/server(?:\.js)?['"])/;

    for (const appId of appIds) {
      expect(source(appImplementationPath(appId, 'client.tsx'))).not.toMatch(forbiddenClientImports);
      expect(source(appImplementationPath(appId, `${appId[0].toUpperCase()}${appId.slice(1)}View.tsx`))).not.toMatch(
        forbiddenClientImports
      );
    }
  });

  it('keeps app server entrypoints away from client-only surfaces', () => {
    const forbiddenServerImports = /(?:\.\/client|clientAppContract|ChatView|ChessView|SnakeView|react)/;

    for (const appId of appIds) {
      expect(source(appImplementationPath(appId, 'serverEntry.ts'))).not.toMatch(forbiddenServerImports);
    }
  });

  it('keeps shared server services platform-only', () => {
    const services = source('src/bundledApps/serverServices.ts');

    expect(services).toContain('@citadel/platform/server-app');
    expect(services).not.toMatch(/AppId|chat|chess|messageStore|Repository|RateLimit|enabledAppIds/);
  });

  it('keeps app server service types scoped to their own app', () => {
    expect(source(appImplementationPath('chat', 'serverEntry.ts'))).not.toMatch(/chess|Chess/);
    expect(source(appImplementationPath('chess', 'serverEntry.ts'))).not.toMatch(/chat|Chat|messageStore/);
    expect(source(appImplementationPath('snake', 'serverEntry.ts'))).not.toMatch(
      /chat|Chat|chess|Chess|Repository|messageStore/
    );
  });

  it('keeps app code on platform facade imports', () => {
    const forbiddenDeepAppImports =
      /\.\.\/\.\.\/(?:shared\/platform|platform\/(?:app|client|serverApp|persistence|appContract|clientAppContract|serverAppContract|validation)|persistence\/sqlite)\.js?/;

    for (const appId of appIds) {
      const manifest = source(appImplementationPath(appId, 'manifest.ts'));
      const client = source(appImplementationPath(appId, 'client.tsx'));
      const view = source(appImplementationPath(appId, `${appId[0].toUpperCase()}${appId.slice(1)}View.tsx`));
      const server = source(appImplementationPath(appId, 'server.ts'));
      const serverEntry = source(appImplementationPath(appId, 'serverEntry.ts'));

      expect(manifest).toContain('@citadel/platform/app');
      expect(manifest).not.toMatch(forbiddenDeepAppImports);
      expect(client).toContain('@citadel/platform/client');
      expect(client).not.toContain('@citadel/platform/server-app');
      expect(client).not.toMatch(forbiddenDeepAppImports);
      expect(view).toContain('@citadel/platform/client');
      expect(view).not.toContain('@citadel/platform/server-app');
      expect(view).not.toMatch(forbiddenDeepAppImports);
      expect(server).toContain('@citadel/platform/');
      expect(server).not.toContain('@citadel/platform/client');
      expect(server).not.toMatch(forbiddenDeepAppImports);
      expect(serverEntry).toContain('@citadel/platform/server-app');
      expect(serverEntry).not.toContain('@citadel/platform/client');
      expect(serverEntry).not.toMatch(forbiddenDeepAppImports);
    }
  });

  it('resolves package imports through workspace package manifests instead of source aliases', () => {
    const tsconfig = jsonSource<PackageTsconfig>('tsconfig.json');
    const packageBase = jsonSource<PackageTsconfig>('tsconfig.package-base.json');
    const viteConfig = source('vite.config.ts');

    expect(tsconfig.compilerOptions).not.toHaveProperty('paths');
    expect(packageBase.compilerOptions).not.toHaveProperty('paths');
    expect(viteConfig).not.toContain('resolve:');
    expect(viteConfig).not.toContain('alias:');
    expect(viteConfig).not.toContain('packages/apps/');
    expect(viteConfig).not.toContain('packages/platform/');
  });

  it('declares workspace package exports for platform and bundled apps', () => {
    const rootPackage = jsonSource<{ workspaces: string[]; scripts: Record<string, string> }>('package.json');
    const platformPackage = jsonSource<PackageJson>('packages/platform/package.json');

    expect(rootPackage.scripts.typecheck).toBe(
      'npm run typecheck:client && npm run typecheck:server && npm run typecheck:packages'
    );
    expect(rootPackage.scripts['typecheck:packages']).toBe('npm run typecheck --workspaces --if-present');
    expect(rootPackage.scripts.predev).toBe('npm run build:packages');
    expect(rootPackage.scripts.dev).toBe(
      'concurrently "npm run dev:packages" "npm run dev:server" "npm run dev:client"'
    );
    expect(rootPackage.scripts['dev:packages']).toBe(
      'concurrently "npm run build:watch -w @citadel/platform" "npm run build:watch -w @citadel/app-chat" "npm run build:watch -w @citadel/app-chess" "npm run build:watch -w @citadel/app-snake"'
    );
    expect(rootPackage.scripts['dev:server']).toBe('tsx watch src/server/index.ts');
    expect(rootPackage.scripts['dev:client']).toBe('vite --host 0.0.0.0');
    expect(rootPackage.scripts.prestart).toBe('npm run build:packages');
    expect(rootPackage.scripts.pretest).toBe('npm run build:packages');
    expect(rootPackage.scripts.build).toBe('npm run build:packages && npm run typecheck && npm run build:client');
    expect(rootPackage.scripts['build:packages']).toBe('npm run build:platform && npm run build:apps');
    expect(rootPackage.scripts['build:platform']).toBe('npm run build -w @citadel/platform');
    expect(rootPackage.scripts['build:apps']).toBe(
      'npm run build -w @citadel/app-chat && npm run build -w @citadel/app-chess && npm run build -w @citadel/app-snake'
    );
    expect(rootPackage.scripts['clean:packages']).toBe('npm run clean --workspaces --if-present');
    expect(rootPackage.workspaces).toEqual([...packagePaths]);
    expect(platformPackage.name).toBe('@citadel/platform');
    expect(platformPackage.exports).toEqual({
      './app': { types: './dist/app.d.ts', import: './dist/app.js' },
      './client': { types: './dist/client.d.ts', import: './dist/client.js' },
      './server-app': { types: './dist/server-app.d.ts', import: './dist/server-app.js' },
      './persistence': { types: './dist/persistence.d.ts', import: './dist/persistence.js' },
      './server': { types: './dist/server.d.ts', import: './dist/server.js' },
      './validation': { types: './dist/validation.d.ts', import: './dist/validation.js' }
    });
    expect(Object.values(platformPackage.exports).every((entry) => typeof entry !== 'string')).toBe(true);
    expect(Object.values(platformPackage.exports).every((entry) => typeof entry !== 'string' && entry.import.startsWith('./dist/'))).toBe(true);
    expect(platformPackage.scripts.build).toBe('tsc -p tsconfig.build.json');
    expect(platformPackage.scripts['build:watch']).toBe(
      'tsc -p tsconfig.build.json --watch --preserveWatchOutput'
    );
    expect(platformPackage.scripts.clean).toBe("node -e \"fs.rmSync('dist', { recursive: true, force: true })\"");
    expect(platformPackage.scripts.typecheck).toBe('tsc -p tsconfig.json --noEmit');

    for (const appId of appIds) {
      const appPackage = jsonSource<PackageJson>(`packages/apps/${appId}/package.json`);

      expect(appPackage.name).toBe(`@citadel/app-${appId}`);
      expect(appPackage.exports).toEqual(
        appId === 'chat'
          ? {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './client': { types: './dist/client.d.ts', import: './dist/client.js' },
            './server': { types: './dist/server.d.ts', import: './dist/server.js' },
            './validation': { types: './dist/validation.d.ts', import: './dist/validation.js' }
          }
          : {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './client': { types: './dist/client.d.ts', import: './dist/client.js' },
            './server': { types: './dist/server.d.ts', import: './dist/server.js' }
          }
      );
      expect(Object.values(appPackage.exports).every((entry) => typeof entry !== 'string')).toBe(true);
      expect(Object.values(appPackage.exports).every((entry) => typeof entry !== 'string' && entry.import.startsWith('./dist/'))).toBe(true);
      expect(appPackage.scripts.build).toBe('tsc -p tsconfig.build.json');
      expect(appPackage.scripts['build:watch']).toBe(
        'tsc -p tsconfig.build.json --watch --preserveWatchOutput'
      );
      expect(appPackage.scripts.clean).toBe("node -e \"fs.rmSync('dist', { recursive: true, force: true })\"");
      expect(appPackage.scripts.typecheck).toBe('tsc -p tsconfig.json --noEmit');
      expect(appPackage.dependencies?.['@citadel/platform']).toBe('0.1.0');
    }
  });

  it('does not expose package subpaths for source, build, view, or implementation internals', () => {
    const packageJsonPaths = [
      'packages/platform/package.json',
      'packages/apps/chat/package.json',
      'packages/apps/chess/package.json',
      'packages/apps/snake/package.json'
    ] as const;

    for (const packageJsonPath of packageJsonPaths) {
      const packageJson = jsonSource<PackageJson>(packageJsonPath);

      for (const { subpath, importTarget, typesTarget } of packageExportEntries(packageJson)) {
        expect(subpath).not.toMatch(forbiddenPackageExportPattern);
        expect(importTarget).not.toMatch(forbiddenPackageExportPattern);
        expect(typesTarget ?? '').not.toMatch(forbiddenPackageExportPattern);
      }

      if (packageJson.name.startsWith('@citadel/app-')) {
        for (const otherAppId of appIds) {
          if (packageJson.name !== `@citadel/app-${otherAppId}`) {
            expect(JSON.stringify(packageJson.exports)).not.toContain(`app-${otherAppId}`);
            expect(JSON.stringify(packageJson.exports)).not.toContain(`/apps/${otherAppId}`);
          }
        }
      }
    }
  });

  it('loads only intentional public runtime values from built workspace package artifacts', async () => {
    for (const packagePath of packagePaths) {
      expect(exists(`${packagePath}/dist`)).toBe(true);
    }

    for (const [specifier, expectedKeys] of Object.entries(publicRuntimeExports)) {
      const module = await import(specifier);

      expect(sortedExportKeys(module)).toEqual([...expectedKeys].sort());
    }
  });

  it('checks each package through a package-local no-emit tsconfig', () => {
    const packageBase = jsonSource<PackageTsconfig>('tsconfig.package-base.json');

    expect(packageBase.compilerOptions?.noEmit).toBe(true);
    expect(packageBase.compilerOptions).not.toHaveProperty('paths');
    expect(packageBase.compilerOptions).not.toHaveProperty('declaration');
    expect(packageBase.compilerOptions).not.toHaveProperty('emitDeclarationOnly');
    expect(packageBase.compilerOptions).not.toHaveProperty('outDir');

    const platformConfig = jsonSource<PackageTsconfig>('packages/platform/tsconfig.json');
    expect(platformConfig.extends).toBe('../../tsconfig.package-base.json');
    expect(platformConfig.include).toEqual(['*.ts', 'src/**/*.ts']);
    expect(platformConfig.include?.join(' ')).not.toMatch(/\.\.|tests|packages\//);

    for (const appId of appIds) {
      const appConfig = jsonSource<PackageTsconfig>(`packages/apps/${appId}/tsconfig.json`);

      expect(appConfig.extends).toBe('../../../tsconfig.package-base.json');
      expect(appConfig.include).toEqual(['*.ts', 'src/**/*.ts', 'src/**/*.tsx']);
      expect(appConfig.include?.join(' ')).not.toMatch(/\.\.|tests|packages\//);
      expect(appConfig.compilerOptions).toBeUndefined();
    }
  });

  it('builds package artifacts without making dist the source of truth', () => {
    const gitignore = source('.gitignore');
    const packageBuildBase = jsonSource<PackageTsconfig>('tsconfig.package-build-base.json');

    expect(gitignore).toContain('dist/');
    expect(packageBuildBase.extends).toBe('./tsconfig.package-base.json');
    expect(packageBuildBase.compilerOptions).toMatchObject({
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: false,
      noEmit: false,
      noEmitOnError: true,
      sourceMap: true
    });
    expect(packageBuildBase.compilerOptions).not.toHaveProperty('outDir');

    for (const packagePath of packagePaths) {
      const buildConfig = jsonSource<PackageTsconfig>(`${packagePath}/tsconfig.build.json`);

      expect(buildConfig.extends).toMatch(/tsconfig\.package-build-base\.json$/);
      if (packagePath === 'packages/platform') {
        expect(buildConfig.compilerOptions).toEqual({ outDir: 'dist', rootDir: '.' });
      } else {
        expect(buildConfig.compilerOptions?.outDir).toBe('dist');
        expect(buildConfig.compilerOptions?.rootDir).toBe('.');
        expect(buildConfig.compilerOptions).not.toHaveProperty('paths');
      }
      expect(buildConfig.include?.join(' ')).not.toMatch(/\.\.|tests|packages\//);
    }
  });

  it('keeps workspace package entrypoints as thin source re-export shims', () => {
    expect(source('packages/platform/app.ts').trim()).toBe("export * from './src/app.js';");
    expect(source('packages/platform/client.ts').trim()).toBe("export * from './src/client.js';");
    expect(source('packages/platform/server-app.ts').trim()).toBe("export * from './src/serverApp.js';");
    expect(source('packages/platform/persistence.ts').trim()).toBe("export * from './src/persistence.js';");
    expect(source('packages/platform/server.ts').trim()).toBe("export * from './src/server.js';");
    expect(source('packages/platform/validation.ts').trim()).toBe("export * from './src/validation.js';");

    for (const appId of appIds) {
      expect(source(`packages/apps/${appId}/index.ts`).trim()).toBe("export * from './src/index.js';");
      expect(source(`packages/apps/${appId}/client.ts`).trim()).toBe("export * from './src/client.js';");
      expect(source(`packages/apps/${appId}/server.ts`).trim()).toBe("export * from './src/serverEntry.js';");
    }
    expect(source('packages/apps/chat/validation.ts').trim()).toBe("export * from './src/validation.js';");
  });

  it('removes legacy compatibility shim files', () => {
    for (const moduleName of platformEntrypointNames) {
      expect(exists(`src/platform/${moduleName}.ts`)).toBe(false);
    }

    for (const appId of appIds) {
      for (const fileName of appShimFilesById[appId]) {
        expect(exists(`src/apps/${appId}/${fileName}`)).toBe(false);
      }
    }

    for (const fileName of deletedCompatibilityPaths) {
      expect(exists(fileName)).toBe(false);
    }
  });

  it('keeps bundled app assembly on public app package surfaces', () => {
    const definitions = source('src/bundledApps/definitions.ts');
    const catalog = source('src/bundledApps/catalog.ts');
    const serverRegistry = source('src/bundledApps/serverRegistry.ts');
    const clientRegistry = source('src/client/appRegistry.tsx');

    for (const appId of appIds) {
      expect(definitions).toContain(`from '@citadel/app-${appId}'`);
      expect(definitions).not.toContain(`@citadel/app-${appId}/client`);
      expect(definitions).not.toContain(`@citadel/app-${appId}/server`);
      expect(catalog).not.toContain(`from '@citadel/app-${appId}'`);
      expect(catalog).not.toContain(`@citadel/apps/${appId}`);
      expect(serverRegistry).toContain(`from '@citadel/app-${appId}/server'`);
      expect(serverRegistry).not.toContain(`@citadel/app-${appId}/client`);
      expect(serverRegistry).not.toContain(`@citadel/apps/${appId}`);
      expect(clientRegistry).toContain(`from '@citadel/app-${appId}/client'`);
      expect(clientRegistry).not.toContain(`@citadel/app-${appId}/server`);
    }
    expect(catalog).toContain("from './definitions.js'");
    expect(serverRegistry).toContain('orderBundledAppEntries');
    expect(clientRegistry).toContain('orderBundledAppEntries');
    for (const assemblyFile of bundledAppAssemblyFiles) {
      expect(source(assemblyFile)).not.toMatch(/(?:\.\.\/apps|src\/apps|packages\/apps)\/(?:chat|chess|snake)\//);
    }
    expect(catalog).not.toMatch(/(?:\.\.\/apps|src\/apps|packages\/apps)\/(?:chat|chess|snake)\//);
    expect(serverRegistry).not.toMatch(/(?:\.\.\/apps|src\/apps|packages\/apps)\/(?:chat|chess|snake)\//);
  });
});
