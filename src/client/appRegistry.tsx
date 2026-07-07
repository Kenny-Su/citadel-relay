import type { AppEventEnvelope, AppId, AppManifest } from '@citadel-platform/platform/app';
import type { ClientAppModule, ClientAppRegistration } from '@citadel-platform/platform/client';
import { bundledClientRegistrations } from '../bundledApps/catalog';

export type { AppViewProps, ClientAppModule } from '@citadel-platform/platform/client';

type ClientAppRegistryOptions = {
  loadModule?: (url: string) => Promise<Record<string, unknown>>;
};

export function createClientAppRegistry(
  registrations: ClientAppRegistration<unknown>[],
  options: ClientAppRegistryOptions = {}
) {
  const allClientApps = registrations.map(
    (registration) => registration.clientApp
  ) satisfies ClientAppModule<unknown>[];
  const appById = new Map<AppId, ClientAppModule<unknown>>(allClientApps.map((app) => [app.appId, app]));
  const appIdSet = new Set<AppId>(allClientApps.map((app) => app.appId));

  function filterClientApps(enabledAppIds: AppId[]) {
    const enabled = new Set(enabledAppIds);
    const apps = allClientApps.filter((app) => enabled.has(app.appId));

    return apps.length > 0 ? apps : allClientApps;
  }

  function createClientAppsFromManifests(
    manifests: unknown,
    enabledAppIds?: AppId[]
  ): ClientAppModule<unknown>[] | null {
    if (!Array.isArray(manifests)) {
      return null;
    }

    const enabled = enabledAppIds ? new Set(enabledAppIds) : null;
    const seen = new Set<AppId>();
    const apps: ClientAppModule<unknown>[] = [];

    for (const manifest of manifests) {
      if (!isClientManifest(manifest, appIdSet) || seen.has(manifest.appId)) {
        continue;
      }

      if (enabled && !enabled.has(manifest.appId)) {
        continue;
      }

      const localApp = appById.get(manifest.appId);

      if (!localApp) {
        continue;
      }

      apps.push({
        appId: manifest.appId,
        label: manifest.label,
        defaultSpaceId: manifest.defaultSpaceId,
        View: localApp.View
      });
      seen.add(manifest.appId);
    }

    return apps.length > 0 ? apps : null;
  }

  async function createClientAppsFromConfig(
    manifests: unknown,
    enabledAppIds?: AppId[]
  ): Promise<ClientAppModule<unknown>[] | null> {
    if (!Array.isArray(manifests)) {
      return null;
    }

    const enabled = enabledAppIds ? new Set(enabledAppIds) : null;
    const seen = new Set<AppId>();
    const apps: ClientAppModule<unknown>[] = [];

    for (const manifest of manifests) {
      if (!isClientManifest(manifest, appIdSet) && !isExtensionManifest(manifest)) {
        continue;
      }

      if (seen.has(manifest.appId) || (enabled && !enabled.has(manifest.appId))) {
        continue;
      }

      const localApp = appById.get(manifest.appId);

      if (localApp) {
        apps.push({
          appId: manifest.appId,
          label: manifest.label,
          defaultSpaceId: manifest.defaultSpaceId,
          View: localApp.View
        });
        seen.add(manifest.appId);
        continue;
      }

      if (isExtensionManifest(manifest)) {
        const loadedApp = await loadExtensionClientApp(manifest, options.loadModule);

        if (loadedApp) {
          apps.push(loadedApp);
          seen.add(manifest.appId);
        }
      }
    }

    return apps.length > 0 ? apps : null;
  }

  return {
    allClientApps,
    appById,
    filterClientApps,
    createClientAppsFromManifests,
    createClientAppsFromConfig
  };
}

const defaultClientAppRegistry = createClientAppRegistry(bundledClientRegistrations);

export const allClientApps = defaultClientAppRegistry.allClientApps;
export const clientApps = allClientApps;
export const appById = defaultClientAppRegistry.appById;
export const filterClientApps = defaultClientAppRegistry.filterClientApps;
export const createClientAppsFromManifests = defaultClientAppRegistry.createClientAppsFromManifests;
export const createClientAppsFromConfig = defaultClientAppRegistry.createClientAppsFromConfig;

function isClientManifest(
  value: unknown,
  appIdSet: Set<AppId>
): value is Pick<AppManifest, 'appId' | 'label' | 'defaultSpaceId'> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Partial<AppManifest>;

  return (
    typeof manifest.appId === 'string' &&
    appIdSet.has(manifest.appId) &&
    typeof manifest.label === 'string' &&
    typeof manifest.defaultSpaceId === 'string'
  );
}

type ExtensionClientManifest = Pick<AppManifest, 'appId' | 'label' | 'defaultSpaceId'> & {
  clientModuleUrl: string;
};

function isExtensionManifest(value: unknown): value is ExtensionClientManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Partial<ExtensionClientManifest>;

  return (
    typeof manifest.appId === 'string' &&
    typeof manifest.label === 'string' &&
    typeof manifest.defaultSpaceId === 'string' &&
    typeof manifest.clientModuleUrl === 'string' &&
    manifest.clientModuleUrl.startsWith('/extensions/')
  );
}

async function loadExtensionClientApp(
  manifest: ExtensionClientManifest,
  loadModule: ClientAppRegistryOptions['loadModule'] = (url) => import(/* @vite-ignore */ url)
): Promise<ClientAppModule<unknown> | null> {
  try {
    const module = await loadModule(manifest.clientModuleUrl);
    const clientApp = findClientAppExport(module, manifest.appId);

    if (!clientApp) {
      return null;
    }

    return {
      appId: manifest.appId,
      label: manifest.label,
      defaultSpaceId: manifest.defaultSpaceId,
      View: clientApp.View
    };
  } catch {
    return null;
  }
}

function findClientAppExport(module: Record<string, unknown>, appId: AppId): ClientAppModule<unknown> | null {
  for (const value of Object.values(module)) {
    if (isClientAppModule(value, appId)) {
      return value;
    }

    if (value && typeof value === 'object') {
      const registration = value as Partial<ClientAppRegistration<unknown>>;

      if (isClientAppModule(registration.clientApp, appId)) {
        return registration.clientApp;
      }
    }
  }

  return null;
}

function isClientAppModule(value: unknown, appId: AppId): value is ClientAppModule<unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const app = value as Partial<ClientAppModule<unknown>>;

  return app.appId === appId && typeof app.View === 'function';
}

export type KnownAppState = unknown;

export function isKnownAppEvent(event: unknown): event is AppEventEnvelope {
  return Boolean(event && typeof event === 'object' && 'appId' in event && 'type' in event);
}
