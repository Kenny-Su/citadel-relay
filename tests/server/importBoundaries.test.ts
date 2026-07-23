import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as relayContract from '../../src/relay/app.js';
import * as serverRuntime from '../../src/relay/server.js';

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
    expect(exists('src/relay/auth.ts')).toBe(true);
    expect(exists('src/relay/validation.ts')).toBe(false);

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
      'AUTH_TOKEN_MAX_LENGTH',
      'NAMESPACE_MAX_LENGTH',
      'NAMESPACE_PATTERN',
      'PRE_SHARED_KEY_BYTES',
      'PRE_SHARED_KEY_ENCODED_LENGTH',
      'PRINCIPAL_ID_MAX_LENGTH',
      'createPreSharedKeyAuthenticator',
      'isNamespace',
      'parsePreSharedKeyConfig',
      'validateAuthenticatedPrincipal',
      'validatePreSharedKeyConfig'
    ].sort());
    expect(sortedExportKeys(serverRuntime)).toEqual(['createRelayServer']);
  });

  it('documents an authenticated namespace relay instead of installable apps', () => {
    const readme = source('README.md');
    const protocol = source('docs/communication-protocol.md');

    expect(readme).toContain('authenticated first-level namespace router');
    expect(protocol).toContain('WebSocket endpoint');
    expect(protocol).toContain('/ws');
    expect(protocol).toContain('namespace owner');
    expect(protocol).toContain('namespace:accept');
    expect(protocol).toContain('server:packet');
    expect(readme).not.toContain('bundled apps');
    expect(protocol).not.toContain('installed app catalog');
  });
});
