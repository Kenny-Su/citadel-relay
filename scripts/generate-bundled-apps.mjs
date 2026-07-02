import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, relative } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(rootDir, 'bundled-apps.json');
const outputs = [
  {
    path: join(rootDir, 'src/bundledApps/generatedAppCatalog.ts'),
    generate: generateInstalledAppCatalog
  }
];
const checkOnly = process.argv.includes('--check');

export function readConfig(path = configPath) {
  const config = JSON.parse(readFileSync(path, 'utf8'));

  if (!config || typeof config !== 'object' || !Array.isArray(config.packages)) {
    throw new Error('bundled-apps.json must contain a packages array');
  }

  if (!config.packages.every((packageName) => typeof packageName === 'string')) {
    throw new Error('bundled-apps.json packages must contain only strings');
  }

  return config;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function resolveInstalledPackageJsonPath(packageName, options = {}) {
  validatePackageName(packageName);

  return join(options.rootDir ?? rootDir, 'node_modules', ...packageName.split('/'), 'package.json');
}

export function validatePackageName(packageName) {
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('Bundled app package names must be non-empty strings');
  }

  if (isAbsolute(packageName) || packageName.includes('\\') || packageName.includes('\0')) {
    throw new Error(`Invalid bundled app package name: ${packageName}`);
  }

  const parts = packageName.split('/');
  const isScoped = packageName.startsWith('@');
  const expectedPartCount = isScoped ? 2 : 1;
  const namePattern = isScoped ? /^@[a-z0-9][a-z0-9._~-]*$/i : /^[a-z0-9][a-z0-9._~-]*$/i;
  const segmentPattern = /^[a-z0-9][a-z0-9._~-]*$/i;

  if (parts.length !== expectedPartCount) {
    throw new Error(`Invalid bundled app package name: ${packageName}`);
  }

  for (const part of parts) {
    if (part === '' || part === '.' || part === '..' || part.startsWith('.')) {
      throw new Error(`Invalid bundled app package name: ${packageName}`);
    }
  }

  if (isScoped) {
    if (!namePattern.test(parts[0]) || !segmentPattern.test(parts[1])) {
      throw new Error(`Invalid bundled app package name: ${packageName}`);
    }
  } else if (!namePattern.test(parts[0])) {
    throw new Error(`Invalid bundled app package name: ${packageName}`);
  }
}

export function readInstalledPackageManifest(packageName, options = {}) {
  const packageJsonPath = resolveInstalledPackageJsonPath(packageName, options);

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Bundled app package ${packageName} is not installed at ${relative(options.rootDir ?? rootDir, packageJsonPath)}. Install the package or remove it from bundled-apps.json.`
    );
  }

  return readJson(packageJsonPath);
}

function resolveInstalledPackageDir(packageName, options = {}) {
  return dirname(resolveInstalledPackageJsonPath(packageName, options));
}

export function resolveAppPackages(config, options = {}) {
  const seenAppIds = new Set();

  return config.packages.map((packageName) => {
    const packageJson = readInstalledPackageManifest(packageName, options);
    const descriptor = parseCitadelPackageMetadata(packageName, packageJson);

    if (seenAppIds.has(descriptor.appId)) {
      throw new Error(`Duplicate bundled app id: ${descriptor.appId}`);
    }

    seenAppIds.add(descriptor.appId);
    return descriptor;
  });
}

export function parseCitadelPackageMetadata(packageName, packageJson) {
  if (packageJson.name !== packageName) {
    throw new Error(`Bundled app package mismatch: configured ${packageName}, package.json declares ${packageJson.name}`);
  }

  const metadata = packageJson.citadel;

  if (!metadata || typeof metadata !== 'object') {
    throw new Error(`Bundled app package ${packageName} must declare citadel metadata`);
  }

  const descriptor = {
    appId: readRequiredString(metadata, 'appId', packageName),
    manifest: {
      appId: readRequiredString(metadata, 'appId', packageName),
      label: readRequiredString(metadata, 'label', packageName),
      defaultSpaceId: readRequiredString(metadata, 'defaultSpaceId', packageName),
      persistence: readPersistence(metadata, packageName),
      version: readRequiredString(metadata, 'version', packageName)
    },
    packageName,
    client: readRegistrationMetadata(metadata, 'client', packageName),
    server: readRegistrationMetadata(metadata, 'server', packageName)
  };

  return descriptor;
}

function readRequiredString(metadata, key, packageName) {
  const value = metadata[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Bundled app package ${packageName} citadel.${key} must be a non-empty string`);
  }

  return value;
}

function readPersistence(metadata, packageName) {
  const value = readRequiredString(metadata, 'persistence', packageName);

  if (value !== 'none' && value !== 'sqlite') {
    throw new Error(`Bundled app package ${packageName} citadel.persistence must be "none" or "sqlite"`);
  }

  return value;
}

function readRegistrationMetadata(metadata, environment, packageName) {
  const registration = metadata[environment];

  if (!registration || typeof registration !== 'object') {
    throw new Error(`Bundled app package ${packageName} citadel.${environment} must declare registration metadata`);
  }

  return {
    subpath: readSubpath(registration, environment, packageName),
    registrationExport: readRequiredString(registration, 'registrationExport', packageName)
  };
}

function readSubpath(registration, environment, packageName) {
  const subpath = readRequiredString(registration, 'subpath', packageName);

  if (subpath !== '.' && !subpath.startsWith('./')) {
    throw new Error(`Bundled app package ${packageName} citadel.${environment}.subpath must be "." or start with "./"`);
  }

  return subpath;
}

function importPath(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function resolvePackageExportTarget(packageName, packageJson, subpath) {
  const target = packageJson.exports?.[subpath];

  if (!target) {
    throw new Error(`Bundled app package ${packageName} must export ${subpath}`);
  }

  if (typeof target === 'string') {
    return target;
  }

  if (target && typeof target === 'object' && typeof target.import === 'string') {
    return target.import;
  }

  throw new Error(`Bundled app package ${packageName} export ${subpath} must declare an import target`);
}

function assertDescriptorMatchesMetadata(packageName, descriptor, metadataDescriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    return false;
  }

  return descriptor.appId === metadataDescriptor.appId
    && descriptor.packageName === metadataDescriptor.packageName
    && JSON.stringify(descriptor.manifest) === JSON.stringify(metadataDescriptor.manifest)
    && JSON.stringify(descriptor.client) === JSON.stringify(metadataDescriptor.client)
    && JSON.stringify(descriptor.server) === JSON.stringify(metadataDescriptor.server);
}

async function importPackageSurface(packageName, packageJson, subpath, options = {}) {
  const packageDir = resolveInstalledPackageDir(packageName, options);
  const target = resolvePackageExportTarget(packageName, packageJson, subpath);

  return import(pathToFileURL(join(packageDir, target)).href);
}

export async function validateInstalledAppPackage(appPackage, options = {}) {
  const packageJson = readInstalledPackageManifest(appPackage.packageName, options);
  const rootModule = await importPackageSurface(appPackage.packageName, packageJson, '.', options);
  const clientModule = await importPackageSurface(
    appPackage.packageName,
    packageJson,
    appPackage.client.subpath,
    options
  );
  const serverModule = await importPackageSurface(
    appPackage.packageName,
    packageJson,
    appPackage.server.subpath,
    options
  );
  const rootDescriptors = Object.values(rootModule).filter((value) => (
    assertDescriptorMatchesMetadata(appPackage.packageName, value, appPackage)
  ));

  if (rootDescriptors.length === 0) {
    throw new Error(
      `Bundled app package ${appPackage.packageName} root surface must export an app package descriptor matching citadel metadata`
    );
  }

  if (!(appPackage.client.registrationExport in clientModule)) {
    throw new Error(
      `Bundled app package ${importPath(appPackage.packageName, appPackage.client.subpath)} must export ${appPackage.client.registrationExport}`
    );
  }

  if (!(appPackage.server.registrationExport in serverModule)) {
    throw new Error(
      `Bundled app package ${importPath(appPackage.packageName, appPackage.server.subpath)} must export ${appPackage.server.registrationExport}`
    );
  }
}

export async function validateInstalledAppPackages(appPackages, options = {}) {
  for (const appPackage of appPackages) {
    await validateInstalledAppPackage(appPackage, options);
  }
}

function literal(value) {
  return JSON.stringify(value);
}

function generateDescriptorLiteral(appPackage) {
  return [
    '{',
    `  appId: ${literal(appPackage.appId)},`,
    '  manifest: {',
    `    appId: ${literal(appPackage.manifest.appId)},`,
    `    label: ${literal(appPackage.manifest.label)},`,
    `    defaultSpaceId: ${literal(appPackage.manifest.defaultSpaceId)},`,
    `    persistence: ${literal(appPackage.manifest.persistence)},`,
    `    version: ${literal(appPackage.manifest.version)}`,
    '  },',
    `  packageName: ${literal(appPackage.packageName)},`,
    '  client: {',
    `    subpath: ${literal(appPackage.client.subpath)},`,
    `    registrationExport: ${literal(appPackage.client.registrationExport)}`,
    '  },',
    '  server: {',
    `    subpath: ${literal(appPackage.server.subpath)},`,
    `    registrationExport: ${literal(appPackage.server.registrationExport)}`,
    '  }',
    '}'
  ].join('\n');
}

export function generateInstalledAppCatalog(appPackages) {
  const clientImports = appPackages.map((appPackage, index) => (
    `import { ${appPackage.client.registrationExport} as bundledClientRegistration${index} } from '${importPath(appPackage.packageName, appPackage.client.subpath)}';`
  ));
  const serverImports = appPackages.map((appPackage, index) => (
    `import { ${appPackage.server.registrationExport} as bundledServerRegistration${index} } from '${importPath(appPackage.packageName, appPackage.server.subpath)}';`
  ));
  const descriptors = appPackages.map((appPackage, index) => (
    `const bundledAppDescriptor${index} = ${generateDescriptorLiteral(appPackage)} satisfies AppPackageDescriptor;`
  ));
  const installedApps = appPackages.map((appPackage, index) => (
    [
      '  {',
      `    descriptor: bundledAppDescriptor${index},`,
      `    clientRegistration: bundledClientRegistration${index},`,
      `    serverRegistration: bundledServerRegistration${index}`,
      '  }'
    ].join('\n')
  ));
  const descriptorPackageEntries = appPackages.map((appPackage, index) => (
    `  ${literal(appPackage.packageName)}: bundledAppDescriptor${index}`
  ));
  const descriptorAppIdEntries = appPackages.map((appPackage, index) => (
    `  ${literal(appPackage.appId)}: bundledAppDescriptor${index}`
  ));
  const clientPackageEntries = appPackages.map((appPackage, index) => (
    `  ${literal(appPackage.packageName)}: bundledClientRegistration${index}`
  ));
  const clientAppIdEntries = appPackages.map((appPackage, index) => (
    `  ${literal(appPackage.appId)}: bundledClientRegistration${index}`
  ));
  const serverPackageEntries = appPackages.map((appPackage, index) => (
    `  ${literal(appPackage.packageName)}: bundledServerRegistration${index}`
  ));
  const serverAppIdEntries = appPackages.map((appPackage, index) => (
    `  ${literal(appPackage.appId)}: bundledServerRegistration${index}`
  ));

  return [
    '// Generated by scripts/generate-bundled-apps.mjs. Do not edit by hand.',
    "import type { AppPackageDescriptor } from '@citadel/platform/app';",
    "import type { ClientAppRegistration } from '@citadel/platform/client';",
    "import type { ServerAppRegistration } from '@citadel/platform/server-app';",
    ...clientImports,
    ...serverImports,
    '',
    'export type BundledInstalledApp = {',
    '  descriptor: AppPackageDescriptor;',
    '  clientRegistration: ClientAppRegistration<any>;',
    '  serverRegistration: ServerAppRegistration<any>;',
    '};',
    '',
    descriptors.join('\n\n'),
    '',
    'export const bundledInstalledApps = [',
    installedApps.join(',\n'),
    '] satisfies BundledInstalledApp[];',
    '',
    'export const bundledAppDescriptorByPackageName: Record<string, AppPackageDescriptor> = {',
    descriptorPackageEntries.join(',\n'),
    '};',
    '',
    'export const bundledAppDescriptorByAppId: Record<string, AppPackageDescriptor> = {',
    descriptorAppIdEntries.join(',\n'),
    '};',
    '',
    'export const bundledClientRegistrationByPackageName: Record<string, ClientAppRegistration<any>> = {',
    clientPackageEntries.join(',\n'),
    '};',
    '',
    'export const bundledClientRegistrationByAppId: Record<string, ClientAppRegistration<any>> = {',
    clientAppIdEntries.join(',\n'),
    '};',
    '',
    'export const bundledServerRegistrationByPackageName: Record<string, ServerAppRegistration<any>> = {',
    serverPackageEntries.join(',\n'),
    '};',
    '',
    'export const bundledServerRegistrationByAppId: Record<string, ServerAppRegistration<any>> = {',
    serverAppIdEntries.join(',\n'),
    '};',
    ''
  ].join('\n');
}

export async function runGenerator(options = {}) {
  const generationRootDir = options.rootDir ?? rootDir;
  const generationOutputs = options.outputs ?? outputs;
  const config = readConfig(options.configPath ?? configPath);
  const appPackages = resolveAppPackages(config, { rootDir: generationRootDir });

  await validateInstalledAppPackages(appPackages, { rootDir: generationRootDir });

  if (options.checkOnly ?? checkOnly) {
    for (const output of generationOutputs) {
      if (!existsSync(output.path)) {
        throw new Error(`${relative(generationRootDir, output.path)} is missing. Run npm run generate:bundled-apps.`);
      }

      const currentSource = readFileSync(output.path, 'utf8');
      const nextSource = output.generate(appPackages);

      if (currentSource !== nextSource) {
        throw new Error(`${relative(generationRootDir, output.path)} is stale. Run npm run generate:bundled-apps.`);
      }
    }

    return;
  }

  for (const output of generationOutputs) {
    writeFileSync(output.path, output.generate(appPackages));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runGenerator();
}
