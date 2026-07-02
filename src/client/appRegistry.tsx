import type { AppEventEnvelope, AppId, AppManifest } from '@citadel/platform/app';
import type { ClientAppModule } from '@citadel/platform/client';
import { bundledClientRegistrations } from '../bundledApps/catalog';

export type { AppViewProps, ClientAppModule } from '@citadel/platform/client';

export const allClientApps = bundledClientRegistrations.map(
  (registration) => registration.clientApp
) satisfies ClientAppModule<unknown>[];

export const clientApps = allClientApps;

export const appById = new Map<AppId, ClientAppModule<unknown>>(allClientApps.map((app) => [app.appId, app]));
const appIdSet = new Set<AppId>(allClientApps.map((app) => app.appId));

export function filterClientApps(enabledAppIds: AppId[]) {
  const enabled = new Set(enabledAppIds);
  const apps = allClientApps.filter((app) => enabled.has(app.appId));

  return apps.length > 0 ? apps : allClientApps;
}

export function createClientAppsFromManifests(
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
    if (!isClientManifest(manifest) || seen.has(manifest.appId)) {
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

function isClientManifest(value: unknown): value is Pick<AppManifest, 'appId' | 'label' | 'defaultSpaceId'> {
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

export type KnownAppState = unknown;

export function isKnownAppEvent(event: unknown): event is AppEventEnvelope {
  return Boolean(event && typeof event === 'object' && 'appId' in event && 'type' in event);
}
