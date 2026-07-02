#!/usr/bin/env node
import { generateAppMetadata } from './appPackageMetadata.js';

function usage() {
  return [
    'Usage: citadel-generate-app-metadata [--check] [--package-dir <dir>]',
    '',
    'Generates app runtime metadata source from package.json#citadel.'
  ].join('\n');
}

function parseArgs(argv: string[]) {
  const packageDirs: string[] = [];
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--check') {
      check = true;
      continue;
    }

    if (token === '--package-dir') {
      const packageDir = argv[index + 1];

      if (!packageDir) {
        throw new Error(`${usage()}\n\n--package-dir requires a value`);
      }

      packageDirs.push(packageDir);
      index += 1;
      continue;
    }

    throw new Error(`${usage()}\n\nUnknown option: ${token}`);
  }

  return {
    check,
    packageDirs
  };
}

try {
  generateAppMetadata(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
