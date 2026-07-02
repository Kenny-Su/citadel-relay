import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPackedLocalPackage } from './install-packed-local-package.mjs';
import {
  normalizeLocalExternalAppEntry,
  readLocalExternalAppsConfig
} from './local-external-apps.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultCacheDir = join(rootDir, '.citadel/npm-cache');

function usage() {
  return [
    'Usage: node scripts/install-local-external-apps.mjs [--skip-platform-build] [--json]',
    '',
    'Builds configured local external app packages, packs them, then installs their built artifacts into node_modules.'
  ].join('\n');
}

export function parseArgs(argv) {
  let json = false;
  let skipPlatformBuild = false;

  for (const token of argv) {
    if (token === '--json') {
      json = true;
      continue;
    }

    if (token === '--skip-platform-build') {
      skipPlatformBuild = true;
      continue;
    }

    throw new Error(`${usage()}\n\nUnknown option: ${token}`);
  }

  return {
    json,
    skipPlatformBuild
  };
}

function npmEnv() {
  return {
    ...process.env,
    npm_config_cache: process.env.CITADEL_PACK_NPM_CACHE ?? process.env.npm_config_cache ?? defaultCacheDir,
    CITADEL_PACK_NPM_CACHE: process.env.CITADEL_PACK_NPM_CACHE ?? process.env.npm_config_cache ?? defaultCacheDir
  };
}

function runNpm(args, options = {}) {
  execFileSync('npm', args, {
    cwd: rootDir,
    env: npmEnv(),
    stdio: options.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit'
  });
}

export function buildLocalExternalAppPackages(packageEntries, options = {}) {
  const {
    quiet = false,
    runNpmCommand = runNpm,
    sourceRootDir = rootDir,
    skipPlatformBuild = false
  } = options;
  const localExternalApps = packageEntries.map(normalizeLocalExternalAppEntry);

  if (localExternalApps.length === 0) {
    return;
  }

  if (!skipPlatformBuild) {
    runNpmCommand(['run', 'build', '-w', '@citadel/platform'], { quiet });
  }

  for (const app of localExternalApps) {
    runNpmCommand(['run', 'build', '--prefix', resolve(sourceRootDir, app.sourcePath)], { quiet });
  }
}

export function installLocalExternalApps(options = {}) {
  const installRootDir = options.rootDir ?? rootDir;
  const sourceRootDir = options.sourceRootDir ?? rootDir;
  const selectedConfigPath = options.configPath ?? join(installRootDir, 'local-external-apps.json');
  const config = readLocalExternalAppsConfig(selectedConfigPath, { optional: !options.configPath });
  const quiet = options.quiet ?? false;

  buildLocalExternalAppPackages(config.packages, {
    quiet,
    runNpmCommand: options.runNpmCommand,
    sourceRootDir,
    skipPlatformBuild: options.skipPlatformBuild ?? false
  });

  return config.packages.map((app) => (options.installPackedApp ?? installPackedLocalPackage)({
    packageName: app.packageName,
    configPath: selectedConfigPath,
    installRootDir,
    destinationDir: options.destinationDir,
    sourceRootDir,
    skipBuild: true,
    quiet
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const results = installLocalExternalApps({
      quiet: args.json,
      skipPlatformBuild: args.skipPlatformBuild
    });

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
