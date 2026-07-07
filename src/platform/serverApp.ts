import type { CitadelDatabase } from './persistence.js';

export type {
  ServerAppBundle,
  ServerAppContext,
  ServerAppFactory,
  ServerAppModule,
  ServerAppProtocolExport,
  ServerAppRegistration
} from './serverAppContract.js';

export type ServerAppServices = {
  database: CitadelDatabase;
};
