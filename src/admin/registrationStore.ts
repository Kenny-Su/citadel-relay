import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  openSync
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isAppId } from '../relay/shared.js';

const DEFAULT_DATABASE_PATH = 'relay.sqlite';
const DATABASE_FILE_MODE = 0o600;
const DATABASE_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const PRE_SHARED_KEY_BYTES = 32;
const PRE_SHARED_KEY_PATTERN = /^[0-9a-f]{64}$/;
const LEGACY_MIGRATION_KEY = 'legacy-app-registrations-v1';

export type AppRegistration = {
  appId: string;
  createdAt: string;
  rotatedAt: string | null;
};

export type AppRegistrationWithCredential = AppRegistration & {
  preSharedKey: string;
};

export type AuthenticatedAppRegistration = {
  appId: string;
};

export type LegacyAppRegistration = {
  appId: string;
  preSharedKey: string;
};

export type LegacyMigrationResult = {
  migrated: boolean;
  importedCount: number;
};

export type RegistrationStoreOptions = {
  databasePath?: string;
};

export type RegistrationStoreErrorCode =
  | 'INVALID_APP_ID'
  | 'INVALID_PRE_SHARED_KEY'
  | 'APP_EXISTS'
  | 'APP_NOT_FOUND'
  | 'MIGRATION_CONFLICT';

export class RegistrationStoreError extends Error {
  readonly code: RegistrationStoreErrorCode;

  constructor(code: RegistrationStoreErrorCode, message: string) {
    super(message);
    this.name = 'RegistrationStoreError';
    this.code = code;
  }
}

type RegistrationRow = {
  app_id: string;
  created_at: string;
  rotated_at: string | null;
};

type CredentialRow = RegistrationRow & {
  psk_digest: Uint8Array;
};

/**
 * Persistent app-server registrations.
 *
 * Methods are synchronous because node:sqlite's DatabaseSync API is synchronous.
 * Only SHA-256 digests are bound to SQLite; plaintext credentials are returned to
 * the caller once, on creation or rotation.
 */
export class RegistrationStore {
  readonly databasePath: string;

  private readonly database: DatabaseSync;

  constructor(options: RegistrationStoreOptions = {}) {
    this.databasePath = options.databasePath
      ?? process.env.RELAY_DATABASE_PATH
      ?? DEFAULT_DATABASE_PATH;

    if (this.databasePath.length === 0) {
      throw new Error('Registration database path must not be empty.');
    }

    if (this.databasePath !== ':memory:') {
      const descriptor = openSync(this.databasePath, 'a', DATABASE_FILE_MODE);
      closeSync(descriptor);
      chmodSync(this.databasePath, DATABASE_FILE_MODE);
    }

    this.database = new DatabaseSync(this.databasePath, {
      timeout: DATABASE_BUSY_TIMEOUT_MILLISECONDS
    });

    try {
      this.initializeSchema();
      if (this.databasePath !== ':memory:') {
        chmodSync(this.databasePath, DATABASE_FILE_MODE);
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  list(): AppRegistration[] {
    const rows = this.database.prepare(`
      SELECT app_id, created_at, rotated_at
      FROM app_registrations
      ORDER BY app_id
    `).all();

    return rows.map((row) => registrationFromRow(row as RegistrationRow));
  }

  create(appId: string): AppRegistrationWithCredential {
    assertAppId(appId);

    return this.inTransaction(() => {
      if (this.findRegistrationRow(appId)) {
        throw new RegistrationStoreError(
          'APP_EXISTS',
          `An app registration already exists for "${appId}".`
        );
      }

      const preSharedKey = generatePreSharedKey();
      const createdAt = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO app_registrations (
          app_id,
          psk_digest,
          created_at,
          rotated_at
        ) VALUES (?, ?, ?, NULL)
      `).run(appId, digestPreSharedKey(preSharedKey), createdAt);

      return {
        appId,
        preSharedKey,
        createdAt,
        rotatedAt: null
      };
    });
  }

  rotateKey(appId: string): AppRegistrationWithCredential {
    assertAppId(appId);

    return this.inTransaction(() => {
      const existing = this.findRegistrationRow(appId);
      if (!existing) {
        throw new RegistrationStoreError(
          'APP_NOT_FOUND',
          `No app registration exists for "${appId}".`
        );
      }

      const preSharedKey = generatePreSharedKey();
      const rotatedAt = new Date().toISOString();
      this.database.prepare(`
        UPDATE app_registrations
        SET psk_digest = ?, rotated_at = ?
        WHERE app_id = ?
      `).run(digestPreSharedKey(preSharedKey), rotatedAt, appId);

      return {
        appId,
        preSharedKey,
        createdAt: existing.created_at,
        rotatedAt
      };
    });
  }

  delete(appId: string): boolean {
    assertAppId(appId);
    const result = this.database.prepare(`
      DELETE FROM app_registrations
      WHERE app_id = ?
    `).run(appId);

    return result.changes > 0;
  }

  authenticate(preSharedKey: string): AuthenticatedAppRegistration | null {
    if (!isPreSharedKey(preSharedKey)) return null;

    const row = this.database.prepare(`
      SELECT app_id
      FROM app_registrations
      WHERE psk_digest = ?
    `).get(digestPreSharedKey(preSharedKey));

    return typeof row?.app_id === 'string'
      ? { appId: row.app_id }
      : null;
  }

  hasCompletedLegacyMigration(): boolean {
    return this.database.prepare(`
      SELECT 1
      FROM registration_store_metadata
      WHERE key = ?
    `).get(LEGACY_MIGRATION_KEY) !== undefined;
  }

  migrateLegacyApps(apps: readonly LegacyAppRegistration[]): LegacyMigrationResult {
    const validatedApps = validateLegacyApps(apps);

    return this.inTransaction(() => {
      if (this.hasCompletedLegacyMigration()) {
        return {
          migrated: false,
          importedCount: 0
        };
      }

      let importedCount = 0;
      for (const app of validatedApps) {
        const existing = this.findCredentialRow(app.appId);
        const digest = digestPreSharedKey(app.preSharedKey);

        if (existing) {
          if (!Buffer.from(existing.psk_digest).equals(digest)) {
            throw new RegistrationStoreError(
              'MIGRATION_CONFLICT',
              `App "${app.appId}" already exists with a different credential.`
            );
          }
          continue;
        }

        const digestOwner = this.database.prepare(`
          SELECT app_id
          FROM app_registrations
          WHERE psk_digest = ?
        `).get(digest);
        if (typeof digestOwner?.app_id === 'string') {
          throw new RegistrationStoreError(
            'MIGRATION_CONFLICT',
            `The credential for "${app.appId}" is already assigned to another app.`
          );
        }

        this.database.prepare(`
          INSERT INTO app_registrations (
            app_id,
            psk_digest,
            created_at,
            rotated_at
          ) VALUES (?, ?, ?, NULL)
        `).run(app.appId, digest, new Date().toISOString());
        importedCount += 1;
      }

      this.database.prepare(`
        INSERT INTO registration_store_metadata (key, value)
        VALUES (?, ?)
      `).run(LEGACY_MIGRATION_KEY, JSON.stringify({
        completedAt: new Date().toISOString(),
        appCount: validatedApps.length
      }));

      return {
        migrated: true,
        importedCount
      };
    });
  }

  close(): void {
    this.database.close();
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS app_registrations (
        app_id TEXT PRIMARY KEY NOT NULL,
        psk_digest BLOB NOT NULL UNIQUE CHECK (length(psk_digest) = 32),
        created_at TEXT NOT NULL,
        rotated_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS registration_store_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      ) STRICT;
    `);
  }

  private findRegistrationRow(appId: string): RegistrationRow | undefined {
    return this.database.prepare(`
      SELECT app_id, created_at, rotated_at
      FROM app_registrations
      WHERE app_id = ?
    `).get(appId) as RegistrationRow | undefined;
  }

  private findCredentialRow(appId: string): CredentialRow | undefined {
    return this.database.prepare(`
      SELECT app_id, psk_digest, created_at, rotated_at
      FROM app_registrations
      WHERE app_id = ?
    `).get(appId) as CredentialRow | undefined;
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function registrationFromRow(row: RegistrationRow): AppRegistration {
  return {
    appId: row.app_id,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at
  };
}

function assertAppId(appId: string): void {
  if (!isAppId(appId)) {
    throw new RegistrationStoreError(
      'INVALID_APP_ID',
      'App IDs must be lowercase identifiers such as "chat".'
    );
  }
}

function isPreSharedKey(value: unknown): value is string {
  return typeof value === 'string' && PRE_SHARED_KEY_PATTERN.test(value);
}

function digestPreSharedKey(preSharedKey: string): Buffer {
  return createHash('sha256')
    .update(Buffer.from(preSharedKey, 'hex'))
    .digest();
}

function generatePreSharedKey(): string {
  return randomBytes(PRE_SHARED_KEY_BYTES).toString('hex');
}

function validateLegacyApps(
  apps: readonly LegacyAppRegistration[]
): readonly LegacyAppRegistration[] {
  const appIds = new Set<string>();
  const preSharedKeys = new Set<string>();

  for (const app of apps) {
    assertAppId(app.appId);
    if (!isPreSharedKey(app.preSharedKey)) {
      throw new RegistrationStoreError(
        'INVALID_PRE_SHARED_KEY',
        'Legacy pre-shared keys must be 32 random bytes encoded as lowercase hexadecimal.'
      );
    }
    if (appIds.has(app.appId)) {
      throw new RegistrationStoreError(
        'MIGRATION_CONFLICT',
        `Legacy app "${app.appId}" is configured more than once.`
      );
    }
    if (preSharedKeys.has(app.preSharedKey)) {
      throw new RegistrationStoreError(
        'MIGRATION_CONFLICT',
        'Each legacy app must have a unique pre-shared key.'
      );
    }

    appIds.add(app.appId);
    preSharedKeys.add(app.preSharedKey);
  }

  return apps;
}
