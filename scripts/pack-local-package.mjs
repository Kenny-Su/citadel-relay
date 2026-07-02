import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageName } from './generate-bundled-apps.mjs';
import { defaultLocalExternalAppsConfigPath, resolveLocalExternalAppSourceDir } from './local-external-apps.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDestinationDir = join(rootDir, '.citadel/app-packs');
const defaultNpmCacheDir = join(rootDir, '.citadel/npm-cache');

function npmEnv() {
  return {
    ...process.env,
    npm_config_cache: process.env.CITADEL_PACK_NPM_CACHE ?? defaultNpmCacheDir
  };
}

function usage() {
  return [
    'Usage: node scripts/pack-local-package.mjs <package-name> [--destination <dir>] [--skip-build] [--json]',
    '',
    'Builds a local package source directory, then writes an npm package tarball for external-app install tests.'
  ].join('\n');
}

export function parseArgs(argv) {
  let packageName;
  let destinationDir = defaultDestinationDir;
  let skipBuild = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--destination') {
      const value = argv[index + 1];

      if (!value) {
        throw new Error('--destination requires a directory path');
      }

      destinationDir = resolve(rootDir, value);
      index += 1;
      continue;
    }

    if (token === '--skip-build') {
      skipBuild = true;
      continue;
    }

    if (token === '--json') {
      json = true;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    }

    if (packageName) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    packageName = token;
  }

  if (!packageName) {
    throw new Error(usage());
  }

  validatePackageName(packageName);

  return {
    packageName,
    destinationDir,
    skipBuild,
    json
  };
}

function runNpm(args, options = {}) {
  execFileSync('npm', args, {
    cwd: rootDir,
    env: npmEnv(),
    stdio: options.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit'
  });
}

function generateAppMetadata(packageSourceDir, options = {}) {
  execFileSync(process.execPath, [
    join(rootDir, 'packages/platform/dist/generateAppMetadataCli.js'),
    '--package-dir',
    packageSourceDir
  ], {
    cwd: rootDir,
    env: npmEnv(),
    stdio: options.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit'
  });
}

function readNpmOutput(args, options = {}) {
  return execFileSync('npm', args, {
    cwd: options.cwd ?? rootDir,
    env: npmEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
}

export function packLocalPackage(options) {
  const {
    packageName,
    configPath = defaultLocalExternalAppsConfigPath,
    destinationDir = defaultDestinationDir,
    sourceRootDir = rootDir,
    skipBuild = false,
    quiet = false
  } = options;

  validatePackageName(packageName);
  mkdirSync(destinationDir, { recursive: true });

  const packageSourceDir = packageName === '@citadel/platform'
    ? join(rootDir, 'packages/platform')
    : resolveLocalExternalAppSourceDir(packageName, { configPath, rootDir: sourceRootDir });

  if (!packageSourceDir) {
    throw new Error(`${packageName} must be declared in local-external-apps.json with a sourcePath before it can be packed`);
  }

  if (!skipBuild) {
    if (packageName !== '@citadel/platform') {
      runNpm(['run', 'build', '-w', '@citadel/platform'], { quiet });
      generateAppMetadata(packageSourceDir, { quiet });
    }

    runNpm(['run', 'build', '--ignore-scripts', '--prefix', packageSourceDir], { quiet });
  }

  const packOutput = readNpmOutput([
    'pack',
    '--json',
    '--pack-destination',
    destinationDir
  ], { cwd: packageSourceDir });
  const [packResult] = JSON.parse(packOutput);

  if (!packResult?.filename || !Array.isArray(packResult.files)) {
    throw new Error(`npm pack did not return a package result for ${packageName}`);
  }

  return {
    packageName,
    destinationDir,
    filename: packResult.filename,
    tarballPath: join(destinationDir, packResult.filename),
    files: packResult.files.map((file) => file.path)
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = packLocalPackage({
      packageName: args.packageName,
      destinationDir: args.destinationDir,
      skipBuild: args.skipBuild,
      quiet: args.json
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Packed ${result.packageName} to ${result.tarballPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
