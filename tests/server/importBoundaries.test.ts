import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appIds = ['chat', 'chess', 'snake'] as const;

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('app package import boundaries', () => {
  it('keeps platform core free of concrete app imports', () => {
    expect(source('src/platform/server.ts')).not.toContain('../apps/');
    expect(source('src/platform/appContract.ts')).not.toContain('../apps/');
    expect(source('src/platform/appContract.ts')).not.toContain('react');
  });

  it('keeps platform contracts split by environment', () => {
    expect(source('src/platform/appContract.ts')).not.toMatch(/clientAppContract|serverAppContract|ComponentType/);
    expect(source('src/platform/clientAppContract.ts')).toContain("from 'react'");
    expect(source('src/platform/clientAppContract.ts')).not.toContain('serverAppContract');
    expect(source('src/platform/serverAppContract.ts')).not.toMatch(/clientAppContract|react|ComponentType/);
  });

  it('keeps neutral app indexes limited to manifests and shared types', () => {
    for (const appId of appIds) {
      const indexSource = source(`src/apps/${appId}/index.ts`);

      expect(indexSource).toContain(`export { ${appId}Manifest } from './manifest.js'`);
      expect(indexSource).toContain("} from './shared.js'");
      expect(indexSource).not.toMatch(
        /client|serverEntry|ServerBundle|Repository|messageStore|repository|validation|create[A-Z].*App/
      );
    }
  });

  it('keeps client registry wired only to app client entrypoints and neutral shared types', () => {
    const registry = source('src/client/appRegistry.tsx');

    expect(registry).toContain("from '../apps/catalog'");
    for (const appId of appIds) {
      expect(registry).toContain(`from '../apps/${appId}'`);
      expect(registry).toContain(`from '../apps/${appId}/client'`);
    }
    expect(registry).not.toMatch(
      /\.\.\/apps\/(?:chat|chess|snake)\/(?:serverEntry|server|manifest|messageStore|repository|validation|ChatView|ChessView|SnakeView)/
    );
  });

  it('keeps server registry wired only to app server entrypoints and neutral manifests', () => {
    const registry = source('src/apps/serverRegistry.ts');

    expect(registry).toContain("from './catalog.js'");
    for (const appId of appIds) {
      expect(registry).toContain(`from './${appId}/serverEntry.js'`);
    }
    expect(registry).not.toMatch(
      /\.\/(?:chat|chess|snake)\/(?:client|server|manifest|shared|repository|messageStore|validation|ChatView|ChessView|SnakeView)\.js/
    );
  });

  it('keeps app client code away from server-only surfaces', () => {
    const forbiddenClientImports =
      /(?:serverEntry|serverAppContract|messageStore|repository|node:fs|node:path|node:sqlite|from ['"]\.\/server(?:\.js)?['"])/;

    for (const appId of appIds) {
      expect(source(`src/apps/${appId}/client.tsx`)).not.toMatch(forbiddenClientImports);
      expect(source(`src/apps/${appId}/${appId[0].toUpperCase()}${appId.slice(1)}View.tsx`)).not.toMatch(
        forbiddenClientImports
      );
    }
  });

  it('keeps app server entrypoints away from client-only surfaces', () => {
    const forbiddenServerImports = /(?:\.\/client|clientAppContract|ChatView|ChessView|SnakeView|react)/;

    for (const appId of appIds) {
      expect(source(`src/apps/${appId}/serverEntry.ts`)).not.toMatch(forbiddenServerImports);
    }
  });

  it('keeps shared server services platform-only', () => {
    const services = source('src/apps/serverServices.ts');

    expect(services).toContain('../persistence/sqlite.js');
    expect(services).not.toMatch(/AppId|chat|chess|messageStore|Repository|RateLimit|enabledAppIds/);
  });

  it('keeps app server service types scoped to their own app', () => {
    expect(source('src/apps/chat/serverEntry.ts')).not.toMatch(/chess|Chess/);
    expect(source('src/apps/chess/serverEntry.ts')).not.toMatch(/chat|Chat|messageStore/);
    expect(source('src/apps/snake/serverEntry.ts')).not.toMatch(/chat|Chat|chess|Chess|Repository|messageStore/);
  });

  it('keeps registries on environment-specific platform contracts', () => {
    expect(source('src/client/appRegistry.tsx')).toContain('../platform/clientAppContract');
    expect(source('src/client/appRegistry.tsx')).not.toContain('serverAppContract');
    expect(source('src/apps/serverRegistry.ts')).toContain('../platform/serverAppContract.js');
    expect(source('src/apps/serverRegistry.ts')).not.toContain('clientAppContract');
  });
});
