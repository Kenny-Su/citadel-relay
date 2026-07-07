import type { AppId, AppManifest, AppPackageDescriptor, InstalledAppCatalogEntry } from '../platform/app.js';
import type { ClientAppRegistration } from '../platform/client.js';
import type { ServerAppModule, ServerAppProtocolExport, ServerAppRegistration } from '../platform/server-app.js';
import { bundledInstalledApps as generatedBundledInstalledApps } from './generatedAppCatalog.js';

export type BundledAppDefinition = AppPackageDescriptor;
export type BundledInstalledApp = InstalledAppCatalogEntry;

export const bundledInstalledApps: BundledInstalledApp[] = generatedBundledInstalledApps;

export const bundledAppDefinitions: BundledAppDefinition[] =
  bundledInstalledApps.map((app) => app.descriptor);

export const bundledClientRegistrations: ClientAppRegistration<any>[] =
  bundledInstalledApps.map((app) => app.clientRegistration);

export const bundledServerRegistrations: ServerAppRegistration<any>[] =
  bundledInstalledApps.map((app) => normalizeServerRegistration(app.descriptor, app.serverRegistration));

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

function isServerAppModule(value: ServerAppProtocolExport<any>): value is ServerAppModule {
  return (
    typeof value === 'object'
    && 'getInitialState' in value
    && typeof value.getInitialState === 'function'
    && 'handleEvent' in value
    && typeof value.handleEvent === 'function'
  );
}

function normalizeServerRegistration(
  descriptor: AppPackageDescriptor,
  serverExport: ServerAppProtocolExport<any>
): ServerAppRegistration<any> {
  if (typeof serverExport === 'function') {
    return {
      appId: descriptor.appId,
      bundle: {
        appId: descriptor.appId,
        createServerApp: serverExport
      },
      createServerApp: serverExport
    };
  }

  if (isServerAppModule(serverExport)) {
    const createServerApp = () => serverExport;

    return {
      appId: descriptor.appId,
      bundle: {
        appId: descriptor.appId,
        createServerApp
      },
      createServerApp
    };
  }

  const createServerApp = typeof serverExport.createServerApp === 'function'
    ? serverExport.createServerApp
    : 'bundle' in serverExport && typeof serverExport.bundle?.createServerApp === 'function'
      ? serverExport.bundle.createServerApp
      : undefined;

  if (typeof createServerApp !== 'function') {
    throw new Error(`Bundled app ${descriptor.appId} server export must create a server app`);
  }

  return {
    appId: descriptor.appId,
    bundle: {
      appId: descriptor.appId,
      createServerApp: createServerApp.bind(serverExport)
    },
    createServerApp: createServerApp.bind(serverExport)
  };
}
