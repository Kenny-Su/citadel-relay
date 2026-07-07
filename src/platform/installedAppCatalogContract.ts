import type { AppPackageDescriptor } from './appContract.js';
import type { ClientAppRegistration } from './clientAppContract.js';
import type { ServerAppProtocolExport } from './serverAppContract.js';

export type InstalledAppCatalogEntry<
  TState = any,
  TServices = any
> = {
  descriptor: AppPackageDescriptor;
  clientRegistration: ClientAppRegistration<TState>;
  serverRegistration: ServerAppProtocolExport<TServices>;
};
