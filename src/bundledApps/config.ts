import bundledAppsConfigJson from '../../bundled-apps.json' with { type: 'json' };

export type BundledAppPackageName = string;

export type BundledAppsConfig = {
  packages: BundledAppPackageName[];
};

export function parseBundledAppsConfig(input: unknown): BundledAppsConfig {
  if (!input || typeof input !== 'object' || !('packages' in input)) {
    throw new Error('Bundled apps config must contain a packages array');
  }

  const packages = (input as Partial<BundledAppsConfig>).packages;

  if (!Array.isArray(packages)) {
    throw new Error('Bundled apps config packages must be an array');
  }

  if (!packages.every((packageName) => typeof packageName === 'string')) {
    throw new Error('Bundled apps config packages must contain only strings');
  }

  return { packages };
}

export const bundledAppsConfig = parseBundledAppsConfig(bundledAppsConfigJson);

export const bundledAppPackageNames = bundledAppsConfig.packages;
