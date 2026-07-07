import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCitadelDatabase } from '../../src/platform/persistence.js';

describe('citadel sqlite database', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('opens a database and creates parent directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-sqlite-'));
    const dbPath = join(tempDir, 'nested', 'citadel.sqlite');
    const connection = openCitadelDatabase(dbPath);

    connection.database.exec('CREATE TABLE smoke (id TEXT PRIMARY KEY)');
    connection.database.prepare('INSERT INTO smoke (id) VALUES (?)').run('ok');

    expect(connection.database.prepare('SELECT id FROM smoke').get()).toEqual({ id: 'ok' });
    connection.close();
  });
});
