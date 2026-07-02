import type { AppId, AppManifest } from '@citadel/platform/app';
import type { ServerAppModule, ServerAppRegistration } from '@citadel/platform/server-app';
import {
  bundledAppDefinitions,
  bundledAppIds,
  bundledAppManifests
} from './catalog.js';
import { bundledServerRegistrationByPackageName } from './generatedAppCatalog.js';
import type { ServerAppServices } from './serverServices.js';

export type { ServerAppServices } from './serverServices.js';

export type BundledServerAppServices = ServerAppServices & {
  appServices?: Record<string, unknown>;
  enabledAppIds?: AppId[];
};

export { bundledAppManifests } from './catalog.js';

type BundledServerAppRegistration = ServerAppRegistration<BundledServerAppServices>;

const bundledServerAppDefinitions = bundledAppDefinitions.map((definition) => (
  bundledServerRegistrationByPackageName[definition.packageName]
)) satisfies BundledServerAppRegistration[];
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
