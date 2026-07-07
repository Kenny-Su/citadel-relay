import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installExtensionZip,
  loadExtensionServerRegistrations,
  readExtensionRegistry
} from '../../src/server/extensions.js';

function zipStored(files: Record<string, string>) {
  const chunks: Buffer[] = [];

  for (const [name, contents] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(contents);
    const header = Buffer.alloc(30);

    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(0, 10);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    chunks.push(header, nameBuffer, data);
  }

  return Buffer.concat(chunks);
}

function extensionZip(overrides: {
  metadata?: Record<string, unknown> | null;
  files?: Record<string, string>;
} = {}) {
  const metadata = overrides.metadata === null
    ? undefined
    : {
      appId: 'gamma',
      label: 'Gamma',
      defaultSpaceId: 'general',
      persistence: 'none',
      version: '0.1.0',
      client: {
        bundle: 'client.js'
      },
      server: {
        module: 'server.js'
      },
      ...overrides.metadata
    };

  return zipStored({
    'package.json': JSON.stringify(metadata ? { type: 'module', citadel: metadata } : { name: 'missing-metadata' }),
    'client.js': 'export const gammaClientApp = { appId: "gamma", label: "Gamma", defaultSpaceId: "general", View() { return null; } };',
    'server.js': 'export function createServerApp() { return { appId: "gamma", getInitialState() { return null; }, handleEvent() {} }; }',
    ...overrides.files
  });
}

describe('extension installer and loader', () => {
  let tempDir: string;
  let extensionsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-extensions-'));
    extensionsDir = join(tempDir, 'extensions');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('installs a valid extension zip and records restart-required metadata', async () => {
    const result = await installExtensionZip(extensionZip(), { extensionsDir });
    const registry = readExtensionRegistry(extensionsDir);

    expect(result).toEqual({
      appId: 'gamma',
      version: '0.1.0',
      restartRequired: true
    });
    expect(registry).toMatchObject([
      {
        appId: 'gamma',
        label: 'Gamma',
        clientModule: 'client.js',
        serverModule: 'server.js'
      }
    ]);
  });

  it('rejects missing citadel metadata', async () => {
    await expect(installExtensionZip(extensionZip({ metadata: null }), { extensionsDir }))
      .rejects.toThrow('Extension package.json must declare citadel metadata');
  });

  it('rejects duplicate app ids', async () => {
    await installExtensionZip(extensionZip(), { extensionsDir });

    await expect(installExtensionZip(extensionZip(), { extensionsDir }))
      .rejects.toThrow('Extension app id gamma is already installed');
  });

  it('rejects missing client bundles', async () => {
    await expect(installExtensionZip(extensionZip({
      metadata: {
        client: {
          bundle: 'missing-client.js'
        }
      }
    }), { extensionsDir })).rejects.toThrow('Extension client bundle missing-client.js is missing');
  });

  it('rejects invalid server modules', async () => {
    await expect(installExtensionZip(extensionZip({
      files: {
        'server.js': 'this is not valid JavaScript'
      }
    }), { extensionsDir })).rejects.toThrow('Extension server module could not be imported');
  });

  it('loads installed extension server registrations at startup', async () => {
    await installExtensionZip(extensionZip(), { extensionsDir });

    const registrations = await loadExtensionServerRegistrations(extensionsDir);
    const app = registrations[0]?.createServerApp({ database: {} as never });

    expect(registrations.map((registration) => registration.manifest)).toEqual([
      {
        appId: 'gamma',
        label: 'Gamma',
        defaultSpaceId: 'general',
        persistence: 'none',
        version: '0.1.0',
        clientModuleUrl: '/extensions/gamma/0.1.0/client.js'
      }
    ]);
    expect(app?.appId).toBe('gamma');
  });
});
