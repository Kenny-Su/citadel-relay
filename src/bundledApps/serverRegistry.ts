import type { AppId, AppManifest } from '../platform/app.js';
import type { ServerAppModule, ServerAppServices } from '../platform/server-app.js';
import {
  bundledAppIds,
  bundledAppManifests,
  bundledServerRegistrations
} from './catalog.js';

export type BundledServerAppServices = ServerAppServices & {
  enabledAppIds?: AppId[];
};

export { bundledAppManifests } from './catalog.js';

const bundledServerAppDefinitions = bundledServerRegistrations;
const bundledAppIdSet = new Set<AppId>(bundledAppIds);

export const bundledServerAppBundles = bundledServerAppDefinitions.map((definition) => definition.bundle);

export function getEnabledAppIds(input?: string): AppId[] {
  if (!input?.trim()) {
    return [...bundledAppIds];
  }

  const enabledAppIds: AppId[] = [];
  const seen = new Set<AppId>();

  for (const token of input.split(',')) {
    const appId = token.trim();

    if (!bundledAppIdSet.has(appId) || seen.has(appId)) {
      continue;
    }

    enabledAppIds.push(appId);
    seen.add(appId);
  }

  return enabledAppIds.length > 0 ? enabledAppIds : [...bundledAppIds];
}

export function filterServerAppBundles(enabledAppIds: AppId[]) {
  return filterServerAppDefinitions(enabledAppIds).map((definition) => definition.bundle);
}

export function filterAppManifests(enabledAppIds: AppId[]) {
  return enabledAppIds
    .map((appId) => bundledAppManifests.find((manifest) => manifest.appId === appId))
    .filter((manifest): manifest is AppManifest => Boolean(manifest));
}

function filterServerAppDefinitions(enabledAppIds: AppId[]) {
  return enabledAppIds
    .map((appId) => bundledServerAppDefinitions.find((definition) => definition.appId === appId))
    .filter((definition): definition is (typeof bundledServerAppDefinitions)[number] => Boolean(definition));
}

export function createBundledServerApps(services: BundledServerAppServices): ServerAppModule[] {
  const definitions = services.enabledAppIds
    ? filterServerAppDefinitions(services.enabledAppIds)
    : bundledServerAppDefinitions;

  return definitions.map((definition) => definition.createServerApp(services));
}
