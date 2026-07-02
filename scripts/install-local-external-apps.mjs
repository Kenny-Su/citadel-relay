import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageName } from './generate-bundled-apps.mjs';
import { installPackedWorkspaceApp } from './install-packed-workspace-app.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.env.CITADEL_LOCAL_EXTERNAL_APPS_CONFIG
  ? resolve(process.env.CITADEL_LOCAL_EXTERNAL_APPS_CONFIG)
  : join(rootDir, 'local-external-apps.json');
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

export function readLocalExternalAppsConfig(path = configPath) {
  const config = JSON.parse(readFileSync(path, 'utf8'));

  if (!config || typeof config !== 'object' || !Array.isArray(config.packages)) {
    throw new Error('local-external-apps.json must contain a packages array');
  }

  for (const packageName of config.packages) {
    if (typeof packageName !== 'string' || packageName.length === 0) {
      throw new Error('local-external-apps.json packages must contain only non-empty strings');
    }

    validatePackageName(packageName);
  }

  return config;
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

export function buildLocalExternalAppPackages(packageNames, options = {}) {
  const {
    quiet = false,
    runNpmCommand = runNpm,
    skipPlatformBuild = false
  } = options;
  const validPackageNames = packageNames.map((packageName) => {
    validatePackageName(packageName);

    return packageName;
  });

  if (validPackageNames.length === 0) {
    return;
  }

  if (!skipPlatformBuild) {
    runNpmCommand(['run', 'build', '-w', '@citadel/platform'], { quiet });
  }

  for (const packageName of validPackageNames) {
    runNpmCommand(['run', 'build', '-w', packageName], { quiet });
  }
}

export function installLocalExternalApps(options = {}) {
  const installRootDir = options.rootDir ?? rootDir;
  const config = readLocalExternalAppsConfig(options.configPath ?? configPath);
  const quiet = options.quiet ?? false;

  buildLocalExternalAppPackages(config.packages, {
    quiet,
    runNpmCommand: options.runNpmCommand,
    skipPlatformBuild: options.skipPlatformBuild ?? false
  });

  return config.packages.map((packageName) => (options.installPackedApp ?? installPackedWorkspaceApp)({
    packageName,
    installRootDir,
    destinationDir: options.destinationDir,
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
