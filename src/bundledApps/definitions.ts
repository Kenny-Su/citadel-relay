import type { AppId, AppManifest, AppPackageDescriptor, InstalledAppCatalogEntry } from '@citadel/platform/app';
import type { ClientAppRegistration } from '@citadel/platform/client';
import type { ServerAppRegistration } from '@citadel/platform/server-app';
import { bundledInstalledApps as generatedBundledInstalledApps } from './generatedAppCatalog.js';

export type BundledAppDefinition = AppPackageDescriptor;
export type BundledInstalledApp = InstalledAppCatalogEntry;

export const bundledInstalledApps: BundledInstalledApp[] = generatedBundledInstalledApps;

export const bundledAppDefinitions: BundledAppDefinition[] =
  bundledInstalledApps.map((app) => app.descriptor);

export const bundledClientRegistrations: ClientAppRegistration<any>[] =
  bundledInstalledApps.map((app) => app.clientRegistration);

export const bundledServerRegistrations: ServerAppRegistration<any>[] =
  bundledInstalledApps.map((app) => app.serverRegistration);

export const bundledAppIds: AppId[] = bundledAppDefinitions.map((definition) => definition.appId);

export const bundledAppManifests: AppManifest[] = bundledAppDefinitions.map((definition) => definition.manifest);

export function getBundledAppDefinition(appId: AppId): BundledAppDefinition | undefined {
  return bundledAppDefinitions.find((definition) => definition.appId === appId);
}

export function getBundledAppManifest(appId: AppId): AppManifest | undefined {
  return getBundledAppDefinition(appId)?.manifest;
}

export function orderBundledAppEntries<T>(entriesById: Record<string, T>) {
  return bundledAppDefinitions.map((definition) => entriesById[definition.appId]) as T[];
}
