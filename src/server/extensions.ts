import express, { type Request, type Response } from 'express';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppId, AppManifest } from '@citadel-platform/platform/app';
import type { ClientAppModule } from '@citadel-platform/platform/client';
import type { ServerAppModule, ServerAppServices } from '@citadel-platform/platform/server-app';
import { isAppId } from '@citadel-platform/platform/app';
import { readZipEntries, type ZipEntries } from './zip.js';

export type ExtensionAppManifest = AppManifest & {
  clientModuleUrl?: string;
};

export type ExtensionRegistryEntry = {
  appId: AppId;
  version: string;
  label: string;
  defaultSpaceId: string;
  persistence: 'none' | 'sqlite';
  rootDir: string;
  clientModule: string;
  serverModule: string;
};

export type ExtensionServerRegistration = {
  manifest: ExtensionAppManifest;
  createServerApp(services: ServerAppServices): ServerAppModule;
};

type CitadelPackageMetadata = {
  appId: string;
  label: string;
  defaultSpaceId: string;
  persistence: 'none' | 'sqlite';
  version: string;
  client?: {
    bundle?: string;
    module?: string;
    clientModule?: string;
    export?: string;
    registrationExport?: string;
  };
  server?: {
    module?: string;
    export?: string;
    registrationExport?: string;
  };
};

type ParsedUpload = {
  file: Buffer;
};

export const DEFAULT_EXTENSIONS_DIR = 'data/extensions';
export const EXTENSION_REGISTRY_FILE = 'installed-apps.json';

async function importRuntimeModule(specifier: string) {
  try {
    return await import(/* @vite-ignore */ specifier) as Record<string, unknown>;
  } catch (error) {
    if (!specifier.startsWith('file:') || !(error as Error).message.includes('Cannot find module')) {
      throw error;
    }

    const sourcePath = new URL(specifier);

    if (!existsSync(sourcePath)) {
      throw error;
    }

    const source = readFileSync(sourcePath, 'utf8');
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

    return await import(/* @vite-ignore */ dataUrl) as Record<string, unknown>;
  }
}

function registryPath(extensionsDir: string) {
  return join(extensionsDir, EXTENSION_REGISTRY_FILE);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeRelativePath(path: string, label: string) {
  const normalized = normalize(path).replace(/\\/g, '/');

  if (!normalized || isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} must be a relative path inside the app package`);
  }

  return normalized;
}

function safeStorageSegment(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }

  return value;
}

function readPackageMetadata(entries: ZipEntries): CitadelPackageMetadata {
  const rawPackageJson = entries.get('package.json');

  if (!rawPackageJson) {
    throw new Error('Extension zip must contain package.json');
  }

  const packageJson = JSON.parse(rawPackageJson.toString('utf8')) as { citadel?: CitadelPackageMetadata };

  if (!packageJson.citadel || typeof packageJson.citadel !== 'object') {
    throw new Error('Extension package.json must declare citadel metadata');
  }

  return packageJson.citadel;
}

function validateMetadata(metadata: CitadelPackageMetadata) {
  if (!isAppId(metadata.appId)) {
    throw new Error('Extension citadel.appId is invalid');
  }

  if (!metadata.label || typeof metadata.label !== 'string') {
    throw new Error('Extension citadel.label must be a non-empty string');
  }

  if (!metadata.defaultSpaceId || typeof metadata.defaultSpaceId !== 'string') {
    throw new Error('Extension citadel.defaultSpaceId must be a non-empty string');
  }

  if (metadata.persistence !== 'none' && metadata.persistence !== 'sqlite') {
    throw new Error('Extension citadel.persistence must be "none" or "sqlite"');
  }

  if (!metadata.version || typeof metadata.version !== 'string') {
    throw new Error('Extension citadel.version must be a non-empty string');
  }

  const clientModule = metadata.client?.bundle ?? metadata.client?.module ?? metadata.client?.clientModule;
  const serverModule = metadata.server?.module;

  if (!clientModule) {
    throw new Error('Extension citadel.client.bundle must be declared');
  }

  if (!serverModule) {
    throw new Error('Extension citadel.server.module must be declared');
  }

  return {
    appId: metadata.appId,
    version: metadata.version,
    label: metadata.label,
    defaultSpaceId: metadata.defaultSpaceId,
    persistence: metadata.persistence,
    clientModule: safeRelativePath(clientModule, 'Extension client bundle'),
    serverModule: safeRelativePath(serverModule, 'Extension server module')
  };
}

function writeEntries(rootDir: string, entries: ZipEntries) {
  for (const [entryPath, contents] of entries) {
    const relativePath = safeRelativePath(entryPath, 'Zip entry');
    const outputPath = resolve(rootDir, relativePath);

    if (!outputPath.startsWith(resolve(rootDir))) {
      throw new Error(`Zip entry ${entryPath} escapes the extension directory`);
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, contents);
  }
}

function parseRegistryEntries(value: unknown): ExtensionRegistryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is ExtensionRegistryEntry => (
    Boolean(entry)
      && typeof entry === 'object'
      && typeof entry.appId === 'string'
      && typeof entry.version === 'string'
      && typeof entry.rootDir === 'string'
      && typeof entry.clientModule === 'string'
      && typeof entry.serverModule === 'string'
  ));
}

export function readExtensionRegistry(extensionsDir = DEFAULT_EXTENSIONS_DIR): ExtensionRegistryEntry[] {
  const path = registryPath(extensionsDir);

  if (!existsSync(path)) {
    return [];
  }

  return parseRegistryEntries(readJson(path));
}

function clientModuleUrl(entry: ExtensionRegistryEntry) {
  return `/extensions/${encodeURIComponent(entry.appId)}/${encodeURIComponent(entry.version)}/${entry.clientModule}`;
}

function manifestFromEntry(entry: ExtensionRegistryEntry): ExtensionAppManifest {
  return {
    appId: entry.appId,
    label: entry.label,
    defaultSpaceId: entry.defaultSpaceId,
    persistence: entry.persistence,
    version: entry.version,
    clientModuleUrl: clientModuleUrl(entry)
  };
}

function findServerFactory(module: Record<string, unknown>, entry: ExtensionRegistryEntry) {
  const candidates = [
    'createServerApp',
    `${entry.appId}ServerRegistration`,
    'serverRegistration',
    'default'
  ];

  for (const name of candidates) {
    const value = module[name];

    if (typeof value === 'function') {
      return value as (services: ServerAppServices) => ServerAppModule;
    }

    if (value && typeof value === 'object') {
      const registration = value as {
        createServerApp?: (services: ServerAppServices) => ServerAppModule;
        bundle?: {
          createServerApp?: (services: ServerAppServices) => ServerAppModule;
        };
      };

      if (typeof registration.createServerApp === 'function') {
        return registration.createServerApp.bind(registration);
      }

      if (typeof registration.bundle?.createServerApp === 'function') {
        return registration.bundle.createServerApp.bind(registration.bundle);
      }
    }
  }

  throw new Error(`Extension ${entry.appId} server module must export a server app factory or registration`);
}

export async function loadExtensionServerRegistrations(
  extensionsDir = DEFAULT_EXTENSIONS_DIR
): Promise<ExtensionServerRegistration[]> {
  const registrations: ExtensionServerRegistration[] = [];

  for (const entry of readExtensionRegistry(extensionsDir)) {
    const serverModulePath = resolve(entry.rootDir, entry.serverModule);
    const serverModule = await importRuntimeModule(pathToFileURL(serverModulePath).href);
    const createServerApp = findServerFactory(serverModule, entry);

    registrations.push({
      manifest: manifestFromEntry(entry),
      createServerApp
    });
  }

  return registrations;
}

export async function installExtensionZip(
  zipBuffer: Buffer,
  options: {
    extensionsDir?: string;
    existingAppIds?: AppId[];
  } = {}
) {
  const extensionsDir = options.extensionsDir ?? DEFAULT_EXTENSIONS_DIR;
  const entries = readZipEntries(zipBuffer);
  const metadata = validateMetadata(readPackageMetadata(entries));
  const installed = readExtensionRegistry(extensionsDir);
  const existing = new Set([...(options.existingAppIds ?? []), ...installed.map((entry) => entry.appId)]);

  if (existing.has(metadata.appId)) {
    throw new Error(`Extension app id ${metadata.appId} is already installed`);
  }

  if (!entries.has(metadata.clientModule)) {
    throw new Error(`Extension client bundle ${metadata.clientModule} is missing`);
  }

  if (!entries.has(metadata.serverModule)) {
    throw new Error(`Extension server module ${metadata.serverModule} is missing`);
  }

  const rootDir = join(
    extensionsDir,
    safeStorageSegment(metadata.appId, 'Extension app id'),
    safeStorageSegment(metadata.version, 'Extension version')
  );

  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });
  const canonicalRootDir = realpathSync(rootDir);

  writeEntries(canonicalRootDir, entries);

  if (!existsSync(resolve(canonicalRootDir, metadata.serverModule))) {
    rmSync(canonicalRootDir, { recursive: true, force: true });
    throw new Error(`Extension server module ${metadata.serverModule} was not extracted`);
  }

  try {
    await importRuntimeModule(pathToFileURL(resolve(canonicalRootDir, metadata.serverModule)).href);
  } catch (error) {
    rmSync(canonicalRootDir, { recursive: true, force: true });
    throw new Error(`Extension server module could not be imported: ${(error as Error).message}`);
  }

  const entry: ExtensionRegistryEntry = {
    appId: metadata.appId,
    version: metadata.version,
    label: metadata.label,
    defaultSpaceId: metadata.defaultSpaceId,
    persistence: metadata.persistence,
    rootDir: canonicalRootDir,
    clientModule: metadata.clientModule,
    serverModule: metadata.serverModule
  };

  writeJson(registryPath(extensionsDir), [...installed, entry]);

  return {
    appId: metadata.appId,
    version: metadata.version,
    restartRequired: true
  };
}

function parseMultipartUpload(request: Request): ParsedUpload {
  const contentType = request.headers['content-type'] ?? '';
  const boundaryMatch = /boundary=([^;]+)/i.exec(Array.isArray(contentType) ? contentType[0] ?? '' : contentType);

  if (!boundaryMatch) {
    throw new Error('Upload must use multipart/form-data');
  }

  const body = request.body;

  if (!Buffer.isBuffer(body)) {
    throw new Error('Upload body is missing');
  }

  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  let offset = body.indexOf(boundary);

  while (offset !== -1) {
    const headerStart = offset + boundary.length + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);

    if (headerEnd === -1) {
      break;
    }

    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundary, dataStart);

    if (nextBoundary === -1) {
      break;
    }

    const dataEnd = Math.max(dataStart, nextBoundary - 2);

    if (/name="appZip"/.test(headers) || /filename=/.test(headers)) {
      return {
        file: Buffer.from(body.subarray(dataStart, dataEnd))
      };
    }

    offset = nextBoundary;
  }

  throw new Error('Upload must include an appZip file field');
}

export function mountExtensionRoutes(
  app: express.Express,
  options: {
    extensionsDir?: string;
    existingAppIds?: AppId[];
  } = {}
) {
  const extensionsDir = options.extensionsDir ?? DEFAULT_EXTENSIONS_DIR;

  app.use('/extensions', express.static(extensionsDir, {
    dotfiles: 'deny',
    index: false,
    fallthrough: true
  }));

  app.post(
    '/admin/extensions',
    express.raw({ limit: '25mb', type: 'multipart/form-data' }),
    async (request: Request, response: Response) => {
      try {
        const upload = parseMultipartUpload(request);
        const result = await installExtensionZip(upload.file, {
          extensionsDir,
          existingAppIds: options.existingAppIds
        });

        response.status(201).json({
          ...result,
          message: 'Extension installed. Restart the host to enable it.'
        });
      } catch (error) {
        response.status(400).json({
          message: (error as Error).message
        });
      }
    }
  );
}

export function createExtensionClientModule(app: ClientAppModule): ClientAppModule {
  return app;
}
