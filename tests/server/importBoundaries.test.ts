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

    for (const appId of appIds) {
      expect(registry).toContain(`from './${appId}/index.js'`);
      expect(registry).toContain(`from './${appId}/serverEntry.js'`);
    }
    expect(registry).not.toMatch(
      /\.\/(?:chat|chess|snake)\/(?:client|server|manifest|shared|repository|messageStore|validation|ChatView|ChessView|SnakeView)\.js/
    );
  });

  it('keeps app client code away from server-only surfaces', () => {
    const forbiddenClientImports =
      /(?:serverEntry|messageStore|repository|node:fs|node:path|node:sqlite|from ['"]\.\/server(?:\.js)?['"])/;

    for (const appId of appIds) {
      expect(source(`src/apps/${appId}/client.tsx`)).not.toMatch(forbiddenClientImports);
      expect(source(`src/apps/${appId}/${appId[0].toUpperCase()}${appId.slice(1)}View.tsx`)).not.toMatch(
        forbiddenClientImports
      );
    }
  });

  it('keeps app server entrypoints away from client-only surfaces', () => {
    const forbiddenServerImports = /(?:\.\/client|ChatView|ChessView|SnakeView|react)/;

    for (const appId of appIds) {
      expect(source(`src/apps/${appId}/serverEntry.ts`)).not.toMatch(forbiddenServerImports);
    }
  });
});
