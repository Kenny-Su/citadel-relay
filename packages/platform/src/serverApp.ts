import type { CitadelDatabase } from './persistence.js';

export type {
  ServerAppBundle,
  ServerAppContext,
  ServerAppModule,
  ServerAppRegistration
} from './serverAppContract.js';

export type ServerAppServices = {
  database: CitadelDatabase;
};
