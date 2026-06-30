import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appIds = ['chat', 'chess', 'snake'] as const;
const packageOwnedAppIds = ['chat', 'chess', 'snake'] as const;
const packageOwnedAppFiles = {
  chat: [
    'index.ts',
    'manifest.ts',
    'shared.ts',
    'client.tsx',
    'ChatView.tsx',
    'server.ts',
    'serverEntry.ts',
    'messageStore.ts',
    'validation.ts'
  ],
  chess: [
    'index.ts',
    'manifest.ts',
    'shared.ts',
    'client.tsx',
    'ChessView.tsx',
    'server.ts',
    'serverEntry.ts',
    'repository.ts'
  ],
  snake: [
    'index.ts',
    'manifest.ts',
    'shared.ts',
    'client.tsx',
    'SnakeView.tsx',
    'server.ts',
    'serverEntry.ts'
  ]
} as const;
const platformModuleNames = [
  'app',
  'appContract',
  'client',
  'clientAppContract',
  'persistence',
  'server',
  'serverApp',
  'serverAppContract',
  'validation',
  'version'
] as const;

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function jsonSource<T>(path: string) {
  return JSON.parse(source(path)) as T;
}

function appImplementationPath(appId: (typeof appIds)[number], fileName: string) {
  return (packageOwnedAppIds as readonly string[]).includes(appId)
    ? `packages/apps/${appId}/src/${fileName}`
    : `src/apps/${appId}/${fileName}`;
}

describe('app package import boundaries', () => {
  it('keeps platform core free of concrete app imports', () => {
    for (const moduleName of platformModuleNames) {
      expect(source(`packages/platform/src/${moduleName}.ts`)).not.toContain('../apps/');
      expect(source(`packages/platform/src/${moduleName}.ts`)).not.toContain('../../../src/apps/');
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

  it('keeps client registry wired only to app client entrypoints and neutral shared types', () => {
    const registry = source('src/client/appRegistry.tsx');

    expect(registry).toContain("from '@citadel/apps/catalog'");
    for (const appId of appIds) {
      expect(registry).toContain(`from '@citadel/apps/${appId}'`);
      expect(registry).toContain(`from '@citadel/apps/${appId}/client'`);
      expect(registry).not.toContain(`@citadel/apps/${appId}/server`);
    }
    expect(registry).not.toMatch(
      /\.\.\/apps\/(?:chat|chess|snake)\/(?:serverEntry|server|manifest|messageStore|repository|validation|ChatView|ChessView|SnakeView)/
    );
  });

  it('keeps server registry wired only to app server entrypoints and neutral manifests', () => {
    const registry = source('src/apps/serverRegistry.ts');

    expect(registry).toContain("from '@citadel/apps/catalog'");
    for (const appId of appIds) {
      expect(registry).toContain(`from '@citadel/apps/${appId}/server'`);
      expect(registry).not.toContain(`@citadel/apps/${appId}/client`);
    }
    expect(registry).not.toMatch(
      /\.\/(?:chat|chess|snake)\/(?:client|server|manifest|shared|repository|messageStore|validation|ChatView|ChessView|SnakeView)\.js/
    );
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
    const services = source('src/apps/serverServices.ts');

    expect(services).toContain('../platform/serverApp.js');
    expect(services).not.toMatch(/AppId|chat|chess|messageStore|Repository|RateLimit|enabledAppIds/);
  });

  it('keeps app server service types scoped to their own app', () => {
    expect(source(appImplementationPath('chat', 'serverEntry.ts'))).not.toMatch(/chess|Chess/);
    expect(source(appImplementationPath('chess', 'serverEntry.ts'))).not.toMatch(/chat|Chat|messageStore/);
    expect(source(appImplementationPath('snake', 'serverEntry.ts'))).not.toMatch(
      /chat|Chat|chess|Chess|Repository|messageStore/
    );
  });

  it('keeps registries on environment-specific platform contracts', () => {
    expect(source('src/client/appRegistry.tsx')).toContain('../platform/clientAppContract');
    expect(source('src/client/appRegistry.tsx')).not.toContain('serverAppContract');
    expect(source('src/apps/serverRegistry.ts')).toContain('../platform/serverAppContract.js');
    expect(source('src/apps/serverRegistry.ts')).not.toContain('clientAppContract');
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
      expect(serverEntry).not.toContain('../serverServices.js');
    }

    expect(source('packages/apps/chat/src/shared.ts')).toContain('@citadel/platform/app');
    expect(source('packages/apps/chat/src/shared.ts')).not.toMatch(forbiddenDeepAppImports);
    expect(source('packages/apps/chat/src/validation.ts')).toContain('@citadel/platform/app');
    expect(source('packages/apps/chat/src/validation.ts')).not.toMatch(forbiddenDeepAppImports);
    expect(source('packages/apps/chat/src/messageStore.ts')).toContain('@citadel/platform/app');
    expect(source('packages/apps/chat/src/messageStore.ts')).toContain('@citadel/platform/persistence');
    expect(source('packages/apps/chat/src/messageStore.ts')).not.toMatch(forbiddenDeepAppImports);
  });

  it('declares package-shaped aliases for TypeScript and Vite', () => {
    const tsconfig = source('tsconfig.json');
    const viteConfig = source('vite.config.ts');

    for (const alias of [
      '@citadel/platform/app',
      '@citadel/platform/client',
      '@citadel/platform/server-app',
      '@citadel/platform/persistence',
      '@citadel/apps/catalog',
      '@citadel/apps/chat',
      '@citadel/apps/chat/client',
      '@citadel/apps/chat/server',
      '@citadel/apps/chess',
      '@citadel/apps/chess/client',
      '@citadel/apps/chess/server',
      '@citadel/apps/snake',
      '@citadel/apps/snake/client',
      '@citadel/apps/snake/server',
      '@citadel/app-chat',
      '@citadel/app-chat/client',
      '@citadel/app-chat/server',
      '@citadel/app-chess',
      '@citadel/app-chess/client',
      '@citadel/app-chess/server',
      '@citadel/app-snake',
      '@citadel/app-snake/client',
      '@citadel/app-snake/server'
    ]) {
      expect(tsconfig).toContain(alias);
      expect(viteConfig).toContain(alias);
    }

    expect(tsconfig).toContain('packages/platform/app.ts');
    expect(tsconfig).toContain('packages/apps/chat/index.ts');
    expect(viteConfig).toContain('./packages/platform/app.ts');
    expect(viteConfig).toContain('./packages/apps/chat/index.ts');
  });

  it('declares workspace package shells for platform and bundled apps', () => {
    const rootPackage = jsonSource<{ workspaces: string[] }>('package.json');
    const platformPackage = jsonSource<{ name: string; exports: Record<string, string> }>(
      'packages/platform/package.json'
    );

    expect(rootPackage.workspaces).toEqual([
      'packages/platform',
      'packages/apps/chat',
      'packages/apps/chess',
      'packages/apps/snake'
    ]);
    expect(platformPackage.name).toBe('@citadel/platform');
    expect(platformPackage.exports).toEqual({
      './app': './app.ts',
      './client': './client.ts',
      './server-app': './server-app.ts',
      './persistence': './persistence.ts'
    });

    for (const appId of appIds) {
      const appPackage = jsonSource<{
        name: string;
        exports: Record<string, string>;
        dependencies?: Record<string, string>;
      }>(`packages/apps/${appId}/package.json`);

      expect(appPackage.name).toBe(`@citadel/app-${appId}`);
      expect(appPackage.exports).toEqual({
        '.': './index.ts',
        './client': './client.ts',
        './server': './server.ts'
      });
      expect(appPackage.dependencies?.['@citadel/platform']).toBe('0.1.0');
    }
  });

  it('keeps workspace package entrypoints as thin source re-export shims', () => {
    expect(source('packages/platform/app.ts').trim()).toBe("export * from './src/app.js';");
    expect(source('packages/platform/client.ts').trim()).toBe("export * from './src/client.js';");
    expect(source('packages/platform/server-app.ts').trim()).toBe("export * from './src/serverApp.js';");
    expect(source('packages/platform/persistence.ts').trim()).toBe("export * from './src/persistence.js';");

    for (const appId of appIds) {
      if ((packageOwnedAppIds as readonly string[]).includes(appId)) {
        expect(source(`packages/apps/${appId}/index.ts`).trim()).toBe("export * from './src/index.js';");
        expect(source(`packages/apps/${appId}/client.ts`).trim()).toBe("export * from './src/client.js';");
        expect(source(`packages/apps/${appId}/server.ts`).trim()).toBe("export * from './src/serverEntry.js';");
      } else {
        expect(source(`packages/apps/${appId}/index.ts`).trim()).toBe(
          `export * from '../../../src/apps/${appId}/index.js';`
        );
        expect(source(`packages/apps/${appId}/client.ts`).trim()).toBe(
          `export * from '../../../src/apps/${appId}/client.js';`
        );
        expect(source(`packages/apps/${appId}/server.ts`).trim()).toBe(
          `export * from '../../../src/apps/${appId}/serverEntry.js';`
        );
      }
    }
  });

  it('keeps src platform files as thin compatibility shims', () => {
    for (const moduleName of platformModuleNames) {
      expect(source(`src/platform/${moduleName}.ts`).trim()).toBe(
        `export * from '../../packages/platform/src/${moduleName}.js';`
      );
    }
  });

  it('keeps moved app src files as thin compatibility shims', () => {
    for (const appId of packageOwnedAppIds) {
      for (const fileName of packageOwnedAppFiles[appId]) {
        const exportName = fileName.replace(/\.tsx?$/, '.js');

        expect(source(`src/apps/${appId}/${fileName}`).trim()).toBe(
          `export * from '../../../packages/apps/${appId}/src/${exportName}';`
        );
      }
    }
  });
});
