import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RegistrationStore,
  RegistrationStoreError
} from '../../src/admin/registrationStore.js';

const temporaryDirectories = new Set<string>();

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citadel-registration-store-'));
  temporaryDirectories.add(directory);
  return join(directory, 'relay.sqlite');
}

function legacyKey(fill: number): string {
  return Buffer.alloc(32, fill).toString('hex');
}

function expectStoreError(
  operation: () => unknown,
  code: RegistrationStoreError['code']
): void {
  try {
    operation();
    throw new Error('Expected registration store operation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(RegistrationStoreError);
    expect((error as RegistrationStoreError).code).toBe(code);
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe('RegistrationStore', () => {
  it('starts with zero apps and protects the database file', () => {
    const databasePath = temporaryDatabasePath();
    const store = new RegistrationStore({ databasePath });

    expect(store.list()).toEqual([]);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);

    store.close();
  });

  it('creates and authenticates a registration without persisting its plaintext key', () => {
    const databasePath = temporaryDatabasePath();
    const store = new RegistrationStore({ databasePath });

    const registration = store.create('chat');

    expect(registration).toMatchObject({
      appId: 'chat',
      rotatedAt: null
    });
    expect(registration.preSharedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(registration.createdAt))).toBe(false);
    expect(store.authenticate(registration.preSharedKey)).toEqual({ appId: 'chat' });
    expect(store.authenticate(legacyKey(9))).toBeNull();
    expect(store.authenticate('not-a-key')).toBeNull();
    expect(store.list()).toEqual([{
      appId: 'chat',
      createdAt: registration.createdAt,
      rotatedAt: null
    }]);

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const columns = inspection.prepare(
      'PRAGMA table_info(app_registrations)'
    ).all().map((column) => column.name);
    const row = inspection.prepare(
      'SELECT hex(psk_digest) AS digest FROM app_registrations WHERE app_id = ?'
    ).get('chat');
    inspection.close();

    expect(columns).toContain('psk_digest');
    expect(columns).not.toContain('pre_shared_key');
    expect(columns).not.toContain('preSharedKey');
    expect(row?.digest).toBe(
      createHash('sha256')
        .update(Buffer.from(registration.preSharedKey, 'hex'))
        .digest('hex')
        .toUpperCase()
    );
    expect(readFileSync(databasePath).includes(registration.preSharedKey)).toBe(false);

    store.close();
  });

  it('orders registration metadata and rejects invalid or duplicate app IDs', () => {
    const store = new RegistrationStore({ databasePath: temporaryDatabasePath() });
    const zeta = store.create('zeta');
    const chat = store.create('chat');

    expect(store.list()).toEqual([
      {
        appId: 'chat',
        createdAt: chat.createdAt,
        rotatedAt: null
      },
      {
        appId: 'zeta',
        createdAt: zeta.createdAt,
        rotatedAt: null
      }
    ]);
    expectStoreError(() => store.create('/invalid'), 'INVALID_APP_ID');
    expectStoreError(() => store.create('chat'), 'APP_EXISTS');

    store.close();
  });

  it('rotates credentials immediately and preserves creation metadata', () => {
    const store = new RegistrationStore({ databasePath: temporaryDatabasePath() });
    const original = store.create('chat');
    const rotated = store.rotateKey('chat');

    expect(rotated.preSharedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.preSharedKey).not.toBe(original.preSharedKey);
    expect(rotated.createdAt).toBe(original.createdAt);
    expect(rotated.rotatedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(rotated.rotatedAt as string))).toBe(false);
    expect(store.authenticate(original.preSharedKey)).toBeNull();
    expect(store.authenticate(rotated.preSharedKey)).toEqual({ appId: 'chat' });
    expect(store.list()).toEqual([{
      appId: 'chat',
      createdAt: original.createdAt,
      rotatedAt: rotated.rotatedAt
    }]);
    expectStoreError(() => store.rotateKey('missing'), 'APP_NOT_FOUND');

    store.close();
  });

  it('deletes registrations and persists mutations across restarts', () => {
    const databasePath = temporaryDatabasePath();
    const firstStore = new RegistrationStore({ databasePath });
    const registration = firstStore.create('chat');
    firstStore.close();

    const secondStore = new RegistrationStore({ databasePath });
    expect(secondStore.authenticate(registration.preSharedKey)).toEqual({ appId: 'chat' });
    expect(secondStore.delete('chat')).toBe(true);
    expect(secondStore.delete('chat')).toBe(false);
    expect(secondStore.authenticate(registration.preSharedKey)).toBeNull();
    secondStore.close();

    const thirdStore = new RegistrationStore({ databasePath });
    expect(thirdStore.list()).toEqual([]);
    thirdStore.close();
  });

  it('makes mutations visible to other store connections immediately', () => {
    const databasePath = temporaryDatabasePath();
    const firstStore = new RegistrationStore({ databasePath });
    const secondStore = new RegistrationStore({ databasePath });

    const created = firstStore.create('chat');
    expect(secondStore.authenticate(created.preSharedKey)).toEqual({ appId: 'chat' });
    expectStoreError(() => secondStore.create('chat'), 'APP_EXISTS');

    const rotated = secondStore.rotateKey('chat');
    expect(firstStore.authenticate(created.preSharedKey)).toBeNull();
    expect(firstStore.authenticate(rotated.preSharedKey)).toEqual({ appId: 'chat' });

    expect(firstStore.delete('chat')).toBe(true);
    expect(secondStore.list()).toEqual([]);

    secondStore.close();
    firstStore.close();
  });

  it('imports legacy credentials once and records a durable migration marker', () => {
    const databasePath = temporaryDatabasePath();
    const chatKey = legacyKey(1);
    const filesKey = legacyKey(2);
    const store = new RegistrationStore({ databasePath });

    expect(store.hasCompletedLegacyMigration()).toBe(false);
    expect(store.migrateLegacyApps([
      { appId: 'chat', preSharedKey: chatKey },
      { appId: 'files', preSharedKey: filesKey }
    ])).toBe(2);
    expect(store.hasCompletedLegacyMigration()).toBe(true);
    expect(store.authenticate(chatKey)).toEqual({ appId: 'chat' });
    expect(store.authenticate(filesKey)).toEqual({ appId: 'files' });

    expect(store.migrateLegacyApps([
      { appId: 'chat', preSharedKey: legacyKey(3) }
    ])).toBe(0);
    expect(store.authenticate(chatKey)).toEqual({ appId: 'chat' });
    expect(store.authenticate(legacyKey(3))).toBeNull();
    store.close();

    const reopened = new RegistrationStore({ databasePath });
    expect(reopened.hasCompletedLegacyMigration()).toBe(true);
    expect(reopened.migrateLegacyApps([])).toBe(0);
    expect(reopened.authenticate(chatKey)).toEqual({ appId: 'chat' });
    reopened.close();
  });

  it('can mark an empty legacy migration as complete', () => {
    const store = new RegistrationStore({ databasePath: temporaryDatabasePath() });

    expect(store.migrateLegacyApps([])).toBe(0);
    expect(store.hasCompletedLegacyMigration()).toBe(true);
    expect(store.list()).toEqual([]);

    store.close();
  });

  it('rolls back the entire legacy migration on conflicts', () => {
    const store = new RegistrationStore({ databasePath: temporaryDatabasePath() });
    const current = store.create('chat');

    expectStoreError(() => store.migrateLegacyApps([
      { appId: 'files', preSharedKey: legacyKey(4) },
      { appId: 'chat', preSharedKey: legacyKey(5) }
    ]), 'MIGRATION_CONFLICT');

    expect(store.hasCompletedLegacyMigration()).toBe(false);
    expect(store.list().map(({ appId }) => appId)).toEqual(['chat']);
    expect(store.authenticate(current.preSharedKey)).toEqual({ appId: 'chat' });
    expect(store.authenticate(legacyKey(4))).toBeNull();

    store.close();
  });

  it('validates all legacy entries before changing the store', () => {
    const store = new RegistrationStore({ databasePath: temporaryDatabasePath() });

    expectStoreError(() => store.migrateLegacyApps([
      { appId: 'chat', preSharedKey: 'ABC' }
    ]), 'INVALID_PRE_SHARED_KEY');
    expectStoreError(() => store.migrateLegacyApps([
      { appId: 'chat', preSharedKey: legacyKey(6) },
      { appId: 'chat', preSharedKey: legacyKey(7) }
    ]), 'MIGRATION_CONFLICT');
    expectStoreError(() => store.migrateLegacyApps([
      { appId: 'chat', preSharedKey: legacyKey(8) },
      { appId: 'files', preSharedKey: legacyKey(8) }
    ]), 'MIGRATION_CONFLICT');

    expect(store.list()).toEqual([]);
    expect(store.hasCompletedLegacyMigration()).toBe(false);

    store.close();
  });
});
