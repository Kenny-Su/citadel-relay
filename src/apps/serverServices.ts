import type { CitadelDatabase } from '../persistence/sqlite.js';

export type ServerAppServices = {
  database: CitadelDatabase;
};
