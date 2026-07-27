import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRelayConfig } from '../../src/admin/legacyConfigMigration.js';
import { RegistrationStore } from '../../src/admin/registrationStore.js';

const temporaryDirectories = new Set<string>();

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'citadel-config-migration-'));
  temporaryDirectories.add(directory);
  return {
    configPath: join(directory, 'relay.config.json'),
    databasePath: join(directory, 'relay.sqlite')
  };
}

function key(fill: number) {
  return Buffer.alloc(32, fill).toString('hex');
}

function config(apps?: unknown) {
  return {
    ...(apps === undefined ? {} : { apps }),
    clientJwt: {
      issuer: 'citadel-local',
      audience: 'citadel-relay',
      publicKeyPath: './client-jwt-public.pem',
      algorithm: 'RS256'
    }
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe('legacy relay config migration', () => {
  it('imports legacy registrations once and removes their plaintext config', () => {
    const paths = fixture();
    const chatKey = key(1);
    const filesKey = key(2);
    writeFileSync(paths.configPath, JSON.stringify(config([
      { appId: 'chat', preSharedKey: chatKey },
      { appId: 'files', preSharedKey: filesKey }
    ])));
    const store = new RegistrationStore({ databasePath: paths.databasePath });

    const prepared = prepareRelayConfig(paths.configPath, store);

    expect(prepared.migratedLegacyApps).toBe(2);
    expect(store.authenticate(chatKey)).toEqual({ appId: 'chat' });
    expect(store.authenticate(filesKey)).toEqual({ appId: 'files' });
    expect(JSON.parse(readFileSync(paths.configPath, 'utf8'))).toEqual(config());
    expect(readFileSync(paths.configPath, 'utf8')).not.toContain(chatKey);
    expect(statSync(paths.configPath).mode & 0o777).toBe(0o600);

    expect(prepareRelayConfig(paths.configPath, store).migratedLegacyApps).toBe(0);
    expect(store.list().map(({ appId }) => appId)).toEqual(['chat', 'files']);
    store.close();
  });

  it('supports a first startup with no configured apps', () => {
    const paths = fixture();
    writeFileSync(paths.configPath, JSON.stringify(config()));
    const store = new RegistrationStore({ databasePath: paths.databasePath });

    const prepared = prepareRelayConfig(paths.configPath, store);

    expect(prepared.migratedLegacyApps).toBe(0);
    expect(store.hasCompletedLegacyMigration()).toBe(true);
    expect(store.list()).toEqual([]);
    store.close();
  });

  it('retries config cleanup safely after the parent directory becomes writable', () => {
    const paths = fixture();
    const chatKey = key(3);
    writeFileSync(paths.configPath, JSON.stringify(config([
      { appId: 'chat', preSharedKey: chatKey }
    ])));
    const directory = dirname(paths.configPath);
    const databaseDirectory = mkdtempSync(join(tmpdir(), 'citadel-migration-db-'));
    temporaryDirectories.add(databaseDirectory);
    const store = new RegistrationStore({
      databasePath: join(databaseDirectory, 'relay.sqlite')
    });

    chmodSync(directory, 0o500);
    try {
      expect(() => prepareRelayConfig(paths.configPath, store)).toThrow();
    } finally {
      chmodSync(directory, 0o700);
    }

    expect(store.hasCompletedLegacyMigration()).toBe(true);
    expect(store.authenticate(chatKey)).toEqual({ appId: 'chat' });
    expect(JSON.parse(readFileSync(paths.configPath, 'utf8')).apps).toHaveLength(1);

    const retried = prepareRelayConfig(paths.configPath, store);
    expect(retried.migratedLegacyApps).toBe(0);
    expect(JSON.parse(readFileSync(paths.configPath, 'utf8'))).toEqual(config());
    expect(store.authenticate(chatKey)).toEqual({ appId: 'chat' });
    store.close();
  });
});
