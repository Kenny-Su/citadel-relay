import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type CitadelDatabase = {
  database: DatabaseSync;
  close(): void;
};

export function openCitadelDatabase(dbPath: string): CitadelDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const database = new DatabaseSync(dbPath);

  return {
    database,
    close() {
      database.close();
    }
  };
}
