import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const firstPartyWorkspaceApps = [
  {
    appId: 'chat',
    packageName: '@citadel/app-chat',
    packagePath: 'packages/apps/chat',
    sourcePath: 'packages/apps/chat/src',
    viewFile: 'ChatView.tsx',
    shimFiles: [
      'ChatView.tsx',
      'client.tsx',
      'index.ts',
      'manifest.ts',
      'messageStore.ts',
      'server.ts',
      'serverEntry.ts',
      'shared.ts',
      'validation.ts'
    ]
  },
  {
    appId: 'chess',
    packageName: '@citadel/app-chess',
    packagePath: 'packages/apps/chess',
    sourcePath: 'packages/apps/chess/src',
    viewFile: 'ChessView.tsx',
    shimFiles: [
      'ChessView.tsx',
      'client.tsx',
      'index.ts',
      'manifest.ts',
      'repository.ts',
      'server.ts',
      'serverEntry.ts',
      'shared.ts'
    ]
  },
  {
    appId: 'snake',
    packageName: '@citadel/app-snake',
    packagePath: 'packages/apps/snake',
    sourcePath: 'packages/apps/snake/src',
    viewFile: 'SnakeView.tsx',
    shimFiles: [
      'SnakeView.tsx',
      'client.tsx',
      'index.ts',
      'manifest.ts',
      'server.ts',
      'serverEntry.ts',
      'shared.ts'
    ]
  }
] as const;
const firstPartyAppIds = firstPartyWorkspaceApps.map((app) => app.appId);
type FirstPartyAppId = (typeof firstPartyWorkspaceApps)[number]['appId'];
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
  'src/server/chatServer.ts',
  'src/server/legacyAppRepositories.ts',
  'src/server/legacyChatServer.ts',
  'src/server/messageStore.ts',
  'src/server/validation.ts',
  'src/shared/chat.ts',
  'src/shared/platform.ts'
] as const;

const bundledAppAssemblyFiles = [
  'bundled-apps.json',
  'local-external-apps.json',
  'src/bundledApps/config.ts',
  'src/bundledApps/definitions.ts',
  'src/bundledApps/generatedAppCatalog.ts',
  'src/bundledApps/resolver.ts',
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
  version: string;
  files?: string[];
  exports: Record<string, PackageExportTarget>;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  citadel?: CitadelPackageMetadata;
};

type BundledAppsJson = {
  packages: string[];
};

type LocalExternalAppsJson = {
  packages: Array<{
    packageName: string;
    sourcePath: string;
  }>;
};

type RootPackageJson = {
  workspaces: string[];
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

type RootPackageLock = {
  packages: Record<string, {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    link?: boolean;
    resolved?: string;
  }>;
};

type CitadelPackageMetadata = {
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

const expectedCitadelMetadataByAppId = {
  chat: {
    appId: 'chat',
    label: 'Chat',
    defaultSpaceId: 'general',
    persistence: 'sqlite',
    version: '0.1.0',
    client: {
      subpath: './client',
      registrationExport: 'chatClientRegistration'
    },
    server: {
      subpath: './server',
      registrationExport: 'chatServerRegistration'
    }
  },
  chess: {
    appId: 'chess',
    label: 'Chess',
    defaultSpaceId: 'general',
    persistence: 'sqlite',
    version: '0.1.0',
    client: {
      subpath: './client',
      registrationExport: 'chessClientRegistration'
    },
    server: {
      subpath: './server',
      registrationExport: 'chessServerRegistration'
    }
  },
  snake: {
    appId: 'snake',
    label: 'Snake',
    defaultSpaceId: 'general',
    persistence: 'none',
    version: '0.1.0',
    client: {
      subpath: './client',
      registrationExport: 'snakeClientRegistration'
    },
    server: {
      subpath: './server',
      registrationExport: 'snakeServerRegistration'
    }
  }
} as const satisfies Record<FirstPartyAppId, CitadelPackageMetadata>;

const firstPartyAppPackagePaths = [
  'packages/apps/chat',
  'packages/apps/chess',
  'packages/apps/snake'
] as const;

const workspacePackagePaths = [
  'packages/platform',
  ...firstPartyAppPackagePaths
] as const;

const publicRuntimeExports = {
  '@citadel/platform/app': [
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
  '@citadel/platform/client': [],
  '@citadel/platform/server-app': [],
  '@citadel/platform/persistence': ['openCitadelDatabase'],
  '@citadel/platform/server': ['createPlatformServer'],
  '@citadel/platform/validation': ['validateDisplayName'],
  '@citadel/app-chat': ['MESSAGE_HISTORY_LIMIT', 'MESSAGE_MAX_LENGTH', 'chatAppPackage', 'chatManifest'],
  '@citadel/app-chat/client': ['chatClientApp', 'chatClientRegistration'],
  '@citadel/app-chat/server': [
    'chatServerBundle',
    'chatServerRegistration',
    'createChatServerAppFromServices',
    'createChatRepository',
    'createSqliteMessageStore',
    'resolveChatRepository'
  ],
  '@citadel/app-chat/validation': ['validateMessageBody'],
  '@citadel/app-chess': ['chessAppPackage', 'chessManifest'],
  '@citadel/app-chess/client': ['chessClientApp', 'chessClientRegistration'],
  '@citadel/app-chess/server': [
    'chessServerBundle',
    'chessServerRegistration',
    'createChessRepository',
    'createChessServerAppFromServices',
    'resolveChessRepository'
  ],
  '@citadel/app-snake': ['snakeAppPackage', 'snakeManifest'],
  '@citadel/app-snake/client': ['snakeClientApp', 'snakeClientRegistration'],
  '@citadel/app-snake/server': [
    'createSnakeServerAppFromServices',
    'snakeServerBundle',
    'snakeServerRegistration'
  ]
} as const satisfies Record<string, readonly string[]>;

const forbiddenPackageExportPattern =
  /(?:^\.(?:\/src|\/dist\/src)(?:\/|$)|(?:View|repository|messageStore|serverEntry|manifest|shared)\.(?:js|ts|tsx)$|(?:^|\/)(?:ChatView|ChessView|SnakeView|repository|messageStore|serverEntry|manifest|shared)(?:$|\/))/;

function firstPartyApp(appId: FirstPartyAppId) {
  const app = firstPartyWorkspaceApps.find((candidate) => candidate.appId === appId);

  if (!app) {
    throw new Error(`Unknown first-party app: ${appId}`);
  }

  return app;
}

function firstPartyWorkspaceAppForPackageName(packageName: string) {
  const app = firstPartyWorkspaceApps.find((candidate) => candidate.packageName === packageName);

  if (!app) {
    throw new Error(`Unknown first-party app package: ${packageName}`);
  }

  return app;
}

function appImplementationPath(appId: FirstPartyAppId, fileName: string) {
  return `${firstPartyApp(appId).sourcePath}/${fileName}`;
}

function installedPackageJsonPath(packageName: string) {
  return `node_modules/${packageName}/package.json`;
}

function installedPackageJson(packageName: string) {
  return jsonSource<PackageJson>(installedPackageJsonPath(packageName));
}

function installedCitadelMetadata(packageName: string) {
  const metadata = installedPackageJson(packageName).citadel;

  if (!metadata) {
    throw new Error(`Installed app package ${packageName} must declare citadel metadata`);
  }

  return metadata;
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
    expect(source('packages/platform/src/shared.ts')).not.toMatch(/'chat'|'chess'|'snake'/);
    expect(source('packages/platform/src/server.ts')).not.toMatch(/'chat'|'chess'|'snake'/);
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

  it('keeps app-owned state machine rules out of platform and host assembly', () => {
    const forbiddenAppStateMachineLogic =
      /snake:ready|SnakeStage|stage: ['"](?:waiting|playing)['"]|['"](?:waiting|playing|checkmate|typing)['"]|requiredReadyCount|readyCount|spectatorCount|lobby|ready|checkmate/;
    const hostRuntimeFiles = [
      'src/bundledApps/serverRegistry.ts',
      'src/bundledApps/catalog.ts',
      'src/client/appRegistry.tsx',
      'src/server/citadelServer.ts',
      'src/server/index.ts',
      'src/bundledApps/serverServices.ts'
    ];

    for (const moduleName of platformSourceModuleNames) {
      expect(source(`packages/platform/src/${moduleName}.ts`)).not.toMatch(forbiddenAppStateMachineLogic);
    }

    for (const fileName of hostRuntimeFiles) {
      expect(source(fileName)).not.toMatch(forbiddenAppStateMachineLogic);
    }

    expect(source(appImplementationPath('snake', 'server.ts'))).toContain('snake:ready');
    expect(source(appImplementationPath('snake', 'shared.ts'))).toContain('SnakeStage');
  });

  it('keeps concrete app view styles inside app packages', () => {
    const hostStyles = source('src/client/styles.css');

    expect(hostStyles).not.toMatch(
      /\.message(?:\b|[.-])|\.message-list|\.message-meta|\.typing-indicator|\.composer(?:\b|[.-])|\.chess-|\.snake-|\.game-surface|\.game-status|\.game-meta/
    );
    expect(source(appImplementationPath('chat', 'ChatView.tsx'))).toContain('.message-list');
    expect(source(appImplementationPath('chess', 'ChessView.tsx'))).toContain('.chess-board');
    expect(source(appImplementationPath('snake', 'SnakeView.tsx'))).toContain('.snake-board');
  });

  it('keeps neutral app indexes limited to manifests and shared types', () => {
    for (const appId of firstPartyAppIds) {
      const indexSource = source(appImplementationPath(appId, 'index.ts'));

      expect(indexSource).toContain(`export { ${appId}Manifest } from './manifest.js'`);
      expect(indexSource).toContain(`export const ${appId}AppPackage`);
      expect(indexSource).toContain("} from './shared.js'");
      expect(indexSource).not.toMatch(/from ['"]\.\/client(?:\.js)?['"]/);
      expect(indexSource).not.toMatch(/from ['"]\.\/serverEntry(?:\.js)?['"]/);
      expect(indexSource.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '')).not.toMatch(
        /ServerBundle|Repository|messageStore|repository|validation|create[A-Z].*App/
      );
    }
  });

  it('keeps client registry wired to real app packages and platform client contracts', () => {
    const bundledApps = jsonSource<BundledAppsJson>('bundled-apps.json');
    const registry = source('src/client/appRegistry.tsx');
    const generatedCatalog = source('src/bundledApps/generatedAppCatalog.ts');

    expect(registry).toContain("from '../bundledApps/catalog'");
    expect(registry).toContain("from '../bundledApps/generatedAppCatalog'");
    expect(registry).toContain("from '@citadel/platform/app'");
    expect(registry).toContain("from '@citadel/platform/client'");
    for (const packageName of bundledApps.packages) {
      const metadata = installedCitadelMetadata(packageName);
      const clientImportPath = `${packageName}/${metadata.client.subpath.slice(2)}`;

      expect(generatedCatalog).toContain(`from '${clientImportPath}'`);
      expect(generatedCatalog).toContain(metadata.client.registrationExport);
      expect(registry).not.toContain(`${packageName}/client`);
      expect(registry).not.toContain(metadata.client.registrationExport);
      expect(registry).not.toContain(`${packageName}/server`);
      expect(registry).not.toContain(`@citadel/apps/${metadata.appId}`);
    }
    expect(registry).not.toMatch(/chatClientApp|chessClientApp|snakeClientApp/);
    expect(registry).not.toMatch(/'chat'|'chess'|'snake'/);
    expect(registry).not.toMatch(
      /\.\/(?:chat|chess|snake)\/(?:client|server|manifest|shared|repository|messageStore|validation|ChatView|ChessView|SnakeView)\.js/
    );
  });

  it('keeps bundled server registry wired to real app server packages', () => {
    const bundledApps = jsonSource<BundledAppsJson>('bundled-apps.json');
    const registry = source('src/bundledApps/serverRegistry.ts');
    const generatedCatalog = source('src/bundledApps/generatedAppCatalog.ts');

    expect(registry).toContain("from './catalog.js'");
    expect(registry).toContain("from '@citadel/platform/server-app'");
    expect(registry).toContain("from './generatedAppCatalog.js'");
    for (const packageName of bundledApps.packages) {
      const metadata = installedCitadelMetadata(packageName);
      const serverImportPath = `${packageName}/${metadata.server.subpath.slice(2)}`;

      expect(generatedCatalog).toContain(`from '${serverImportPath}'`);
      expect(generatedCatalog).toContain(metadata.server.registrationExport);
      expect(registry).not.toContain(metadata.server.registrationExport);
      expect(registry).not.toContain(`${packageName}/client`);
      expect(registry).not.toContain(`${packageName}/server`);
      expect(registry).not.toContain(`@citadel/apps/${metadata.appId}`);
    }
    expect(registry).not.toMatch(
      /\.\/(?:chat|chess|snake)\/(?:client|server|manifest|shared|repository|messageStore|validation|ChatView|ChessView|SnakeView)\.js/
    );
    expect(registry).not.toMatch(/ChatServerAppServices|ChessServerAppServices/);
    expect(registry).not.toMatch(/chatRepository|chessRepository|messageStore|messageRateLimit/);
    expect(registry).not.toMatch(/chatServerBundle|chessServerBundle|snakeServerBundle/);
    expect(registry).not.toMatch(
      /createChatServerAppFromServices|createChessServerAppFromServices|createSnakeServerAppFromServices/
    );
    expect(registry).not.toMatch(/resolveChatRepository|resolveChessRepository|resolveBundledRepositories/);
  });

  it('keeps host server wiring generic and free of legacy app repository coupling', () => {
    const citadelServer = source('src/server/citadelServer.ts');
    const serverIndex = source('src/server/index.ts');
    const socketTest = source('tests/server/socket.test.ts');

    expect(serverIndex).toContain("from './citadelServer.js'");
    expect(serverIndex).not.toContain('@citadel/platform/server');
    expect(serverIndex).not.toContain('../bundledApps/serverRegistry');
    expect(citadelServer).toContain("from '../bundledApps/serverRegistry.js'");
    expect(citadelServer).not.toContain('./legacyAppRepositories');
    expect(`${serverIndex}\n${citadelServer}`).not.toMatch(
      /createChatServer|legacyAppRepositories|legacyChatServer|chatRepository|chessRepository|messageStore|messageRateLimit|CHAT_DB_PATH/
    );
    expect(socketTest).toContain('../../src/server/citadelServer.js');
    expect(socketTest).not.toContain('../../src/server/chatServer.js');
    expect(socketTest).not.toMatch(
      /@citadel\/app-(?:chat|chess)\/server|chatRepository|chessRepository|messageStore|messageRateLimit|createChatRepository|createChessRepository/
    );
  });

  it('keeps app client code away from server-only surfaces', () => {
    const forbiddenClientImports =
      /(?:serverEntry|serverAppContract|messageStore|repository|node:fs|node:path|node:sqlite|from ['"]\.\/server(?:\.js)?['"])/;

    for (const appId of firstPartyAppIds) {
      expect(source(appImplementationPath(appId, 'client.tsx'))).not.toMatch(forbiddenClientImports);
      expect(source(appImplementationPath(appId, firstPartyApp(appId).viewFile))).not.toMatch(
        forbiddenClientImports
      );
    }
  });

  it('keeps app server entrypoints away from client-only surfaces', () => {
    const forbiddenServerImports = /(?:\.\/client|clientAppContract|ChatView|ChessView|SnakeView|react)/;

    for (const appId of firstPartyAppIds) {
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

    for (const appId of firstPartyAppIds) {
      const manifest = source(appImplementationPath(appId, 'manifest.ts'));
      const client = source(appImplementationPath(appId, 'client.tsx'));
      const view = source(appImplementationPath(appId, firstPartyApp(appId).viewFile));
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

  it('declares installed local app artifacts and local workspace package exports', () => {
    const bundledApps = jsonSource<BundledAppsJson>('bundled-apps.json');
    const localExternalApps = jsonSource<LocalExternalAppsJson>('local-external-apps.json');
    const rootPackage = jsonSource<RootPackageJson>('package.json');
    const packageLock = jsonSource<RootPackageLock>('package-lock.json');
    const platformPackage = jsonSource<PackageJson>('packages/platform/package.json');
    const bundledPackageNames = new Set(bundledApps.packages);
    const localExternalPackageNames = localExternalApps.packages.map((app) => app.packageName);

    expect(rootPackage.workspaces).toEqual(['packages/platform']);
    expect(rootPackage.dependencies['@citadel/platform']).toBe(platformPackage.version);
    expect(rootPackage.dependencies.express).toBeUndefined();
    expect(rootPackage.dependencies.nanoid).toBeUndefined();
    expect(rootPackage.dependencies['socket.io']).toBeUndefined();
    expect(rootPackage.dependencies['chess.js']).toBeUndefined();
    expect(rootPackage.devDependencies['chess.js']).toBe('^1.4.0');
    expect(packageLock.packages[''].dependencies?.['chess.js']).toBeUndefined();
    expect(packageLock.packages[''].devDependencies?.['chess.js']).toBe(rootPackage.devDependencies['chess.js']);
    expect(localExternalApps.packages).toEqual([
      { packageName: '@citadel/app-chat', sourcePath: 'packages/apps/chat' },
      { packageName: '@citadel/app-chess', sourcePath: 'packages/apps/chess' },
      { packageName: '@citadel/app-snake', sourcePath: 'packages/apps/snake' }
    ]);
    expect(localExternalPackageNames).toEqual(bundledApps.packages);
    for (const packageName of bundledApps.packages) {
      const appPackage = installedPackageJson(packageName);

      expect(appPackage.name).toBe(packageName);
      expect(rootPackage.dependencies[packageName]).toBeUndefined();
      expect(packageLock.packages[''].dependencies?.[packageName]).toBeUndefined();
      expect(packageLock.packages[`node_modules/${packageName}`]).toBeUndefined();
    }
    for (const { packageName, sourcePath } of localExternalApps.packages) {
      const app = firstPartyWorkspaceAppForPackageName(packageName);

      expect(bundledPackageNames.has(packageName)).toBe(true);
      expect(sourcePath).toBe(app.packagePath);
      expect(rootPackage.workspaces).not.toContain(app.packagePath);
      expect(rootPackage.dependencies[packageName]).toBeUndefined();
      expect(packageLock.packages[`node_modules/${packageName}`]).toBeUndefined();
      expect(packageLock.packages[sourcePath]).toBeUndefined();
      expect(lstatSync(join(process.cwd(), 'node_modules', ...packageName.split('/'))).isSymbolicLink()).toBe(false);
      expect(readdirSync(join(process.cwd(), 'node_modules', ...packageName.split('/'))).sort()).toEqual(
        app.appId === 'snake' ? ['dist', 'package.json'] : ['dist', 'node_modules', 'package.json']
      );
    }
    expect(packageLock.packages[''].dependencies?.['@citadel/platform']).toBe(platformPackage.version);
    expect(packageLock.packages['node_modules/@citadel/platform']).toMatchObject({
      link: true
    });
    expect(rootPackage.scripts.typecheck).toBe(
      'npm run typecheck:client && npm run typecheck:server && npm run typecheck:packages'
    );
    expect(rootPackage.scripts['typecheck:packages']).toBe('npm run typecheck -w @citadel/platform');
    expect(rootPackage.scripts['generate:bundled-apps']).toBe('node scripts/generate-bundled-apps.mjs');
    expect(rootPackage.scripts['check:bundled-apps']).toBe('node scripts/generate-bundled-apps.mjs --check');
    expect(rootPackage.scripts.predev).toBe('npm run build:packages && npm run generate:bundled-apps');
    expect(rootPackage.scripts.dev).toBe(
      'concurrently "npm run dev:packages" "npm run dev:server" "npm run dev:client"'
    );
    expect(rootPackage.scripts['dev:packages']).toBe('npm run build:watch -w @citadel/platform');
    expect(rootPackage.scripts['dev:server']).toBe('tsx watch src/server/index.ts');
    expect(rootPackage.scripts['dev:client']).toBe('vite --host 0.0.0.0');
    expect(rootPackage.scripts.prestart).toBe('npm run build:packages && npm run generate:bundled-apps');
    expect(rootPackage.scripts.pretest).toBe('npm run build:packages && npm run generate:bundled-apps');
    expect(rootPackage.scripts.test).toBe('npm run check:bundled-apps && vitest run');
    expect(rootPackage.scripts.build).toBe(
      'npm run build:packages && npm run generate:bundled-apps && npm run typecheck && npm run build:client'
    );
    expect(rootPackage.scripts['build:packages']).toBe(
      'npm run build:platform && npm run install:local-external-apps'
    );
    expect(rootPackage.scripts['build:platform']).toBe('npm run build -w @citadel/platform');
    expect(rootPackage.scripts['install:local-external-apps']).toBe(
      'node scripts/install-local-external-apps.mjs --skip-platform-build'
    );
    expect(rootPackage.scripts['pack:local-package']).toBe('node scripts/pack-local-package.mjs');
    expect(Object.keys(rootPackage.scripts).some((scriptName) => scriptName.startsWith('pack:app-'))).toBe(false);
    expect(rootPackage.scripts['clean:packages']).toBe('npm run clean -w @citadel/platform');
    expect(rootPackage.workspaces).toContain('packages/platform');
    for (const app of firstPartyWorkspaceApps) {
      expect(rootPackage.workspaces).not.toContain(app.packagePath);
    }
    expect(platformPackage.name).toBe('@citadel/platform');
    expect(platformPackage.files).toEqual(['dist']);
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
    expect(platformPackage.dependencies).toEqual({
      express: '^5.1.0',
      nanoid: '^5.1.5',
      'socket.io': '^4.8.1'
    });

    for (const app of firstPartyWorkspaceApps) {
      const appPackage = jsonSource<PackageJson>(`${app.packagePath}/package.json`);

      expect(appPackage.name).toBe(app.packageName);
      expect(appPackage.files).toEqual(['dist']);
      expect(appPackage.exports).toEqual(
        app.appId === 'chat'
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
      expect(appPackage.citadel).toEqual(expectedCitadelMetadataByAppId[app.appId]);
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
    const bundledApps = jsonSource<BundledAppsJson>('bundled-apps.json');
    const packageJsons = [
      jsonSource<PackageJson>('packages/platform/package.json'),
      ...bundledApps.packages.map((packageName) => installedPackageJson(packageName))
    ];

    for (const packageJson of packageJsons) {
      for (const { subpath, importTarget, typesTarget } of packageExportEntries(packageJson)) {
        expect(subpath).not.toMatch(forbiddenPackageExportPattern);
        expect(importTarget).not.toMatch(forbiddenPackageExportPattern);
        expect(typesTarget ?? '').not.toMatch(forbiddenPackageExportPattern);
      }

      if (packageJson.name.startsWith('@citadel/app-')) {
        for (const otherPackageName of bundledApps.packages) {
          if (packageJson.name !== otherPackageName) {
            expect(JSON.stringify(packageJson.exports)).not.toContain(otherPackageName);
            expect(JSON.stringify(packageJson.exports)).not.toContain(`/apps/${installedCitadelMetadata(otherPackageName).appId}`);
          }
        }
      }
    }
  });

  it('loads only intentional public runtime values from built workspace package artifacts', async () => {
    for (const packagePath of workspacePackagePaths) {
      expect(exists(`${packagePath}/dist`)).toBe(true);
    }

    for (const [specifier, expectedKeys] of Object.entries(publicRuntimeExports)) {
      const module = await import(specifier);

      expect(sortedExportKeys(module)).toEqual([...expectedKeys].sort());
    }
  });

  it('keeps snake lifecycle exports type-only on the neutral package surface', () => {
    const snakeIndex = source(appImplementationPath('snake', 'index.ts'));

    expect(snakeIndex).toContain('export type {');
    expect(snakeIndex).toMatch(/SnakeDirectionPayload,\s+SnakePlayer,\s+SnakeReadyPayload,\s+SnakeSegment,\s+SnakeStage,\s+SnakeState/s);
    expect(publicRuntimeExports['@citadel/app-snake']).toEqual(['snakeAppPackage', 'snakeManifest']);
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

    for (const app of firstPartyWorkspaceApps) {
      const appConfig = jsonSource<PackageTsconfig>(`${app.packagePath}/tsconfig.json`);

      expect(appConfig.extends).toBe('../../../tsconfig.package-base.json');
      expect(appConfig.include).toEqual(['*.ts', 'src/**/*.ts', 'src/**/*.tsx']);
      expect(appConfig.include?.join(' ')).not.toMatch(/\.\.|tests|packages\//);
      expect(appConfig.compilerOptions).toBeUndefined();
    }
  });

  it('builds package artifacts without making dist the source of truth', () => {
    const gitignore = source('.gitignore');
    const packageBuildBase = jsonSource<PackageTsconfig>('tsconfig.package-build-base.json');
    const packLocalPackage = source('scripts/pack-local-package.mjs');
    const installPackedLocalPackage = source('scripts/install-packed-local-package.mjs');
    const installLocalExternalApps = source('scripts/install-local-external-apps.mjs');
    const localExternalAppHelpers = source('scripts/local-external-apps.mjs');

    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.citadel/');
    expect(localExternalAppHelpers).toContain('local-external-apps.json');
    expect(localExternalAppHelpers).toContain('sourcePath');
    expect(localExternalAppHelpers).toContain('validatePackageName');
    expect(packLocalPackage).toContain('.citadel/app-packs');
    expect(packLocalPackage).toContain('.citadel/npm-cache');
    expect(packLocalPackage).toContain("'pack'");
    expect(packLocalPackage).toContain("'--pack-destination'");
    expect(packLocalPackage).toContain('resolveLocalExternalAppSourceDir');
    expect(packLocalPackage).toContain("'--prefix'");
    expect(packLocalPackage).toContain("['run', 'build', '-w', '@citadel/platform']");
    expect(packLocalPackage).not.toContain("['run', 'build', '-w', packageName]");
    expect(installPackedLocalPackage).toContain("join(installRootDir, 'node_modules'");
    expect(installPackedLocalPackage).toContain('installLocalRuntimeDependencies');
    expect(installPackedLocalPackage).toContain("!dependencyName.startsWith('@citadel/')");
    expect(installPackedLocalPackage).toContain("execFileSync('tar'");
    expect(installPackedLocalPackage).toContain("'--strip-components=1'");
    expect(installLocalExternalApps).toContain('readLocalExternalAppsConfig');
    expect(installLocalExternalApps).toContain('installPackedLocalPackage');
    expect(installLocalExternalApps).toContain('--skip-platform-build');
    expect(installLocalExternalApps).toContain("['run', 'build', '-w', '@citadel/platform']");
    expect(installLocalExternalApps).toContain("'--prefix'");
    expect(installLocalExternalApps).not.toContain("['run', 'build', '-w', packageName]");
    expect(installLocalExternalApps).toContain('skipBuild: true');
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

    for (const packagePath of workspacePackagePaths) {
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

    for (const app of firstPartyWorkspaceApps) {
      expect(source(`${app.packagePath}/index.ts`).trim()).toBe("export * from './src/index.js';");
      expect(source(`${app.packagePath}/client.ts`).trim()).toBe("export * from './src/client.js';");
      expect(source(`${app.packagePath}/server.ts`).trim()).toBe("export * from './src/serverEntry.js';");
    }
    expect(source('packages/apps/chat/validation.ts').trim()).toBe("export * from './src/validation.js';");
  });

  it('removes legacy compatibility shim files', () => {
    for (const moduleName of platformEntrypointNames) {
      expect(exists(`src/platform/${moduleName}.ts`)).toBe(false);
    }

    for (const app of firstPartyWorkspaceApps) {
      for (const fileName of app.shimFiles) {
        expect(exists(`src/apps/${app.appId}/${fileName}`)).toBe(false);
      }
    }

    for (const fileName of deletedCompatibilityPaths) {
      expect(exists(fileName)).toBe(false);
    }
  });

  it('keeps bundled app assembly on public app package surfaces', () => {
    const bundledApps = jsonSource<BundledAppsJson>('bundled-apps.json');
    const localExternalApps = jsonSource<LocalExternalAppsJson>('local-external-apps.json');
    const config = source('src/bundledApps/config.ts');
    const definitions = source('src/bundledApps/definitions.ts');
    const generator = source('scripts/generate-bundled-apps.mjs');
    const generatedCatalog = source('src/bundledApps/generatedAppCatalog.ts');
    const resolver = source('src/bundledApps/resolver.ts');
    const catalog = source('src/bundledApps/catalog.ts');
    const serverRegistry = source('src/bundledApps/serverRegistry.ts');
    const clientRegistry = source('src/client/appRegistry.tsx');

    expect(bundledApps.packages).toEqual([
      '@citadel/app-chat',
      '@citadel/app-chess',
      '@citadel/app-snake'
    ]);
    expect(localExternalApps.packages).toEqual([
      { packageName: '@citadel/app-chat', sourcePath: 'packages/apps/chat' },
      { packageName: '@citadel/app-chess', sourcePath: 'packages/apps/chess' },
      { packageName: '@citadel/app-snake', sourcePath: 'packages/apps/snake' }
    ]);
    expect(new Set(localExternalApps.packages.map((app) => app.packageName)).size).toBe(localExternalApps.packages.length);
    expect(config).toContain("from '../../bundled-apps.json'");
    expect(config).not.toContain("'@citadel/app-chat'");
    expect(config).not.toContain("'@citadel/app-chess'");
    expect(config).not.toContain("'@citadel/app-snake'");
    expect(generator).toContain("'node_modules'");
    expect(generator).not.toContain('rootPackagePath');
    expect(generator).not.toContain('readWorkspacePackageManifests');
    expect(generator).not.toContain('root workspaces');
    expect(generator).toContain('is not installed at');
    expect(generator).toContain('node_modules');
    expect(exists('workspace-apps.json')).toBe(false);
    expect(exists('scripts/run-workspace-apps.mjs')).toBe(false);

    for (const packageName of bundledApps.packages) {
      const metadata = installedCitadelMetadata(packageName);
      const clientImportPath = `${packageName}/${metadata.client.subpath.slice(2)}`;
      const serverImportPath = `${packageName}/${metadata.server.subpath.slice(2)}`;

      expect(definitions).not.toContain(`from '${packageName}'`);
      expect(definitions).not.toContain(`${packageName}/client`);
      expect(definitions).not.toContain(`${packageName}/server`);
      expect(generatedCatalog).toContain(`"${packageName}":`);
      expect(generatedCatalog).toContain(`appId: "${metadata.appId}"`);
      expect(generatedCatalog).toContain(`label: "${metadata.label}"`);
      expect(generatedCatalog).toContain(`persistence: "${metadata.persistence}"`);
      expect(generatedCatalog).not.toContain('legacyServices');
      expect(generatedCatalog).not.toContain('capabilities');
      expect(generatedCatalog).toContain(`registrationExport: "${metadata.client.registrationExport}"`);
      expect(generatedCatalog).toContain(`registrationExport: "${metadata.server.registrationExport}"`);
      expect(generatedCatalog).not.toContain(`from '${packageName}'`);
      expect(generatedCatalog).toContain(`from '${clientImportPath}'`);
      expect(generatedCatalog).toContain(metadata.client.registrationExport);
      expect(generatedCatalog).toContain(`from '${serverImportPath}'`);
      expect(generatedCatalog).toContain(metadata.server.registrationExport);
      expect(resolver).not.toContain(`from '${packageName}'`);
      expect(resolver).not.toContain(`${packageName}/client`);
      expect(resolver).not.toContain(`${packageName}/server`);
      expect(catalog).not.toContain(`from '${packageName}'`);
      expect(catalog).not.toContain(`@citadel/apps/${metadata.appId}`);
      expect(serverRegistry).not.toContain(metadata.server.registrationExport);
      expect(serverRegistry).not.toContain(`${packageName}/client`);
      expect(serverRegistry).not.toContain(`${packageName}/server`);
      expect(serverRegistry).not.toContain(`@citadel/apps/${metadata.appId}`);
      expect(clientRegistry).not.toContain(`from '${packageName}'`);
      expect(clientRegistry).not.toContain(`from '${clientImportPath}'`);
      expect(clientRegistry).not.toContain(metadata.client.registrationExport);
      expect(clientRegistry).not.toContain(`${packageName}/server`);
    }
    expect(catalog).toContain("from './definitions.js'");
    expect(catalog).not.toContain("from './config.js'");
    expect(catalog).not.toContain("from './resolver.js'");
    expect(definitions).toContain("from './generatedAppCatalog.js'");
    expect(definitions).not.toContain("from './config.js'");
    expect(definitions).not.toContain("from './resolver.js'");
    expect(resolver).toContain("from './generatedAppCatalog.js'");
    expect(generatedCatalog).toContain('Generated by scripts/generate-bundled-apps.mjs');
    expect(generatedCatalog).toContain('bundledInstalledApps');
    expect(generatedCatalog).toContain('bundledAppDescriptorByPackageName');
    expect(generatedCatalog).toContain('bundledClientRegistrationByPackageName');
    expect(generatedCatalog).toContain('bundledServerRegistrationByPackageName');
    expect(serverRegistry).toContain('bundledAppDefinitions');
    expect(clientRegistry).toContain('bundledAppDefinitions');
    for (const assemblyFile of bundledAppAssemblyFiles) {
      expect(source(assemblyFile)).not.toMatch(/(?:\.\.\/apps|src\/apps|packages\/apps)\/(?:chat|chess|snake)\//);
    }
    expect(catalog).not.toMatch(/(?:\.\.\/apps|src\/apps|packages\/apps)\/(?:chat|chess|snake)\//);
    expect(serverRegistry).not.toMatch(/(?:\.\.\/apps|src\/apps|packages\/apps)\/(?:chat|chess|snake)\//);
  });
});
