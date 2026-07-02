import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageName } from './generate-bundled-apps.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export const defaultLocalExternalAppsConfigPath = process.env.CITADEL_LOCAL_EXTERNAL_APPS_CONFIG
  ? resolve(process.env.CITADEL_LOCAL_EXTERNAL_APPS_CONFIG)
  : join(rootDir, 'local-external-apps.json');
const hasExplicitLocalExternalAppsConfigPath = Boolean(process.env.CITADEL_LOCAL_EXTERNAL_APPS_CONFIG);

function validateSourcePath(packageName, sourcePath) {
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    throw new Error(`local-external-apps.json entry for ${packageName} must declare a sourcePath string`);
  }

  if (isAbsolute(sourcePath)) {
    throw new Error(`local-external-apps.json sourcePath for ${packageName} must be relative to the host root`);
  }

  if (sourcePath.split(/[\\/]+/).some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`local-external-apps.json sourcePath for ${packageName} must not contain empty, current, or parent path segments`);
  }

  return sourcePath;
}

export function normalizeLocalExternalAppEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('local-external-apps.json packages must contain objects with packageName and sourcePath');
  }

  const { packageName, sourcePath } = entry;

  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('local-external-apps.json packages must contain packageName strings');
  }

  validatePackageName(packageName);

  return {
    packageName,
    sourcePath: validateSourcePath(packageName, sourcePath)
  };
}

export function readLocalExternalAppsConfig(path = defaultLocalExternalAppsConfigPath, options = {}) {
  if (!existsSync(path)) {
    if (options.optional || (path === defaultLocalExternalAppsConfigPath && !hasExplicitLocalExternalAppsConfigPath)) {
      return {
        packages: []
      };
    }

    throw new Error(`local-external-apps.json not found at ${path}`);
  }

  const config = JSON.parse(readFileSync(path, 'utf8'));

  if (!config || typeof config !== 'object' || !Array.isArray(config.packages)) {
    throw new Error('local-external-apps.json must contain a packages array');
  }

  const packages = config.packages.map(normalizeLocalExternalAppEntry);
  const seenPackageNames = new Set();

  for (const { packageName } of packages) {
    if (seenPackageNames.has(packageName)) {
      throw new Error(`Duplicate local external app package: ${packageName}`);
    }

    seenPackageNames.add(packageName);
  }

  return {
    packages
  };
}

export function resolveLocalExternalAppSourceDir(packageName, options = {}) {
  validatePackageName(packageName);

  const sourceRootDir = options.rootDir ?? rootDir;
  const config = readLocalExternalAppsConfig(options.configPath ?? defaultLocalExternalAppsConfigPath);
  const entry = config.packages.find((app) => app.packageName === packageName);

  if (!entry) {
    return undefined;
  }

  return resolve(sourceRootDir, entry.sourcePath);
}
