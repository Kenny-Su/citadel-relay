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
  it('keeps the relay core isolated from the admin control plane', () => {
    expect(exists('src/relay/app.ts')).toBe(true);
    expect(exists('src/relay/server.ts')).toBe(true);
    expect(exists('src/relay/shared.ts')).toBe(true);
    expect(exists('src/relay/auth.ts')).toBe(true);
    expect(exists('src/relay/validation.ts')).toBe(false);

    expect(exists('src/client')).toBe(false);
    expect(exists('src/admin/client/App.tsx')).toBe(true);
    expect(exists('src/admin/adminApi.ts')).toBe(true);
    expect(exists('src/admin/registrationStore.ts')).toBe(true);
    expect(exists('src/bundledApps')).toBe(false);
    expect(exists('src/server/extensions.ts')).toBe(false);
    expect(exists('src/platform')).toBe(false);
    expect(exists('src/relay/persistence.ts')).toBe(false);
    expect(exists('scripts/generate-bundled-apps.mjs')).toBe(false);
    expect(exists('bundled-apps.json')).toBe(false);
  });

  it('keeps raw websocket dependencies and adds only the admin UI stack', () => {
    const rootPackage = jsonSource<PackageJson>('package.json');
    const dependencies = rootPackage.dependencies ?? {};
    const devDependencies = rootPackage.devDependencies ?? {};

    expect(rootPackage.name).toBe('citadel-relay');
    expect(rootPackage.workspaces).toBeUndefined();
    expect(dependencies.ws).toBeDefined();
    expect(devDependencies['@types/ws']).toBeDefined();

    expect(dependencies.react).toBeDefined();
    expect(dependencies['react-dom']).toBeDefined();
    expect(devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(devDependencies.vite).toBeDefined();
    expect(devDependencies.concurrently).toBeDefined();

    for (const packageName of ['socket.io', 'socket.io-client']) {
      expect(dependencies[packageName]).toBeUndefined();
      expect(devDependencies[packageName]).toBeUndefined();
    }

    expect(rootPackage.scripts).not.toHaveProperty('generate:bundled-apps');
    expect(rootPackage.scripts).toHaveProperty('build:admin');
    expect(rootPackage.scripts).toHaveProperty('dev:admin');
  });

  it('exports relay contracts and runtime values', () => {
    expect(sortedExportKeys(relayContract)).toEqual([
      'APP_ID_MAX_LENGTH',
      'APP_ID_PATTERN',
      'AUTH_TOKEN_MAX_LENGTH',
      'CLIENT_JWT_CLOCK_TOLERANCE_SECONDS',
      'CLIENT_SUBJECT_MAX_LENGTH',
      'PRE_SHARED_KEY_BYTES',
      'PRE_SHARED_KEY_ENCODED_LENGTH',
      'createAppServerAuthenticator',
      'createJwtClientAuthenticator',
      'isAppId',
      'parseRelayConfig',
      'validateAuthenticatedAppServer',
      'validateClientJwtConfig',
      'validateRelayConfig',
      'validateVerifiedClientIdentity'
    ].sort());
    expect(sortedExportKeys(serverRuntime)).toEqual(['createRelayServer']);
  });

  it('documents an authenticated app relay instead of bundled apps', () => {
    const readme = source('README.md');
    const protocol = source('docs/communication-protocol.md');

    expect(readme).toContain('authenticated app router');
    expect(protocol).toContain('WebSocket endpoint');
    expect(protocol).toContain('/ws');
    expect(protocol).toContain('app server');
    expect(protocol).toContain('app:accept');
    expect(protocol).toContain('server:packet');
    expect(readme).not.toContain('bundled apps');
    expect(protocol).not.toContain('installed app catalog');
  });

  it('keeps JWT signing and private keys out of the relay control plane', () => {
    const adminApi = source('src/admin/adminApi.ts');
    const startup = source('src/server/index.ts');
    const exampleConfig = source('relay.config.example.json');

    for (const content of [adminApi, startup, exampleConfig]) {
      expect(content).not.toContain('SignJWT');
      expect(content).not.toContain('privateKeyPath');
      expect(content).not.toContain('/tokens');
    }
    expect(exampleConfig).toContain('publicKeyPath');
  });
});
