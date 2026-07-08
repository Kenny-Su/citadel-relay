import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as relayContract from '../../src/relay/app.js';
import * as serverRuntime from '../../src/relay/server.js';
import * as validationContract from '../../src/relay/validation.js';

type PackageJson = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[];
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

describe('relay server import boundaries', () => {
  it('keeps only relay entrypoints in source', () => {
    expect(exists('src/relay/app.ts')).toBe(true);
    expect(exists('src/relay/server.ts')).toBe(true);
    expect(exists('src/relay/shared.ts')).toBe(true);
    expect(exists('src/relay/validation.ts')).toBe(true);

    expect(exists('src/client')).toBe(false);
    expect(exists('src/bundledApps')).toBe(false);
    expect(exists('src/server/extensions.ts')).toBe(false);
    expect(exists('src/platform')).toBe(false);
    expect(exists('src/relay/persistence.ts')).toBe(false);
    expect(exists('scripts/generate-bundled-apps.mjs')).toBe(false);
    expect(exists('bundled-apps.json')).toBe(false);
  });

  it('removes app-host dependencies and keeps raw websocket dependencies', () => {
    const rootPackage = jsonSource<PackageJson>('package.json');
    const dependencies = rootPackage.dependencies ?? {};
    const devDependencies = rootPackage.devDependencies ?? {};

    expect(rootPackage.name).toBe('citadel-relay');
    expect(rootPackage.workspaces).toBeUndefined();
    expect(dependencies.ws).toBeDefined();
    expect(devDependencies['@types/ws']).toBeDefined();

    for (const packageName of [
      '@vitejs/plugin-react',
      'concurrently',
      'react',
      'react-dom',
      'socket.io',
      'socket.io-client',
      'vite'
    ]) {
      expect(dependencies[packageName]).toBeUndefined();
      expect(devDependencies[packageName]).toBeUndefined();
    }

    expect(rootPackage.scripts).not.toHaveProperty('generate:bundled-apps');
    expect(rootPackage.scripts).not.toHaveProperty('build:client');
    expect(rootPackage.scripts).not.toHaveProperty('dev:client');
  });

  it('exports relay contracts and runtime values', () => {
    expect(sortedExportKeys(relayContract)).toEqual([
      'DEFAULT_SPACE_ID',
      'DISPLAY_NAME_MAX_LENGTH',
      'GUEST_ID_MAX_LENGTH',
      'GUEST_ID_PATTERN',
      'SPACE_ID_MAX_LENGTH',
      'SPACE_ID_PATTERN',
      'normalizeGuestId',
      'normalizeSpaceId'
    ].sort());
    expect(sortedExportKeys(serverRuntime)).toEqual(['createRelayServer']);
    expect(sortedExportKeys(validationContract)).toEqual(['validateDisplayName']);
  });

  it('documents a network-only relay protocol instead of installable apps', () => {
    const readme = source('README.md');
    const protocol = source('docs/communication-protocol.md');

    expect(readme).toContain('raw WebSocket relay server');
    expect(protocol).toContain('WebSocket endpoint');
    expect(protocol).toContain('/ws');
    expect(readme).not.toContain('bundled apps');
    expect(protocol).not.toContain('installed app catalog');
  });
});
