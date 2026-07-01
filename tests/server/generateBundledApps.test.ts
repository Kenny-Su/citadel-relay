import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The generator is a Node ESM script exercised directly by Vitest.
import { generateClientRegistry, generateServerRegistry, resolveAppPackages, resolveInstalledPackageJsonPath, validatePackageName } from '../../scripts/generate-bundled-apps.mjs';

const validCitadelMetadata = {
  appId: 'demo',
  label: 'Demo',
  defaultSpaceId: 'general',
  persistence: 'sqlite',
  version: '0.1.0',
  client: {
    subpath: './browser',
    registrationExport: 'demoBrowserRegistration'
  },
  server: {
    subpath: './node',
    registrationExport: 'demoNodeRegistration'
  }
};

function writePackage(rootDir: string, packageName: string, packageJson: Record<string, unknown> = {}) {
  const packageJsonPath = resolveInstalledPackageJsonPath(packageName, { rootDir });
  mkdirSync(dirname(packageJsonPath), { recursive: true });
  writeFileSync(packageJsonPath, JSON.stringify({
    name: packageName,
    citadel: validCitadelMetadata,
    ...packageJson
  }, null, 2));
}

describe('bundled app generator package resolution', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('resolves current workspace app packages through installed node_modules links', () => {
    const appPackages = resolveAppPackages({
      packages: [
        '@citadel/app-chat',
        '@citadel/app-chess',
        '@citadel/app-snake'
      ]
    });

    expect(appPackages.map((appPackage: { appId: string }) => appPackage.appId)).toEqual(['chat', 'chess', 'snake']);
    expect(appPackages.map((appPackage: { packageName: string }) => appPackage.packageName)).toEqual([
      '@citadel/app-chat',
      '@citadel/app-chess',
      '@citadel/app-snake'
    ]);
  });

  it('resolves metadata from installed package directories instead of workspace config', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    writePackage(tempDir, '@example/app-demo');

    const [appPackage] = resolveAppPackages({
      packages: ['@example/app-demo']
    }, { rootDir: tempDir });

    expect(appPackage).toEqual({
      appId: 'demo',
      manifest: {
        appId: 'demo',
        label: 'Demo',
        defaultSpaceId: 'general',
        persistence: 'sqlite',
        version: '0.1.0'
      },
      packageName: '@example/app-demo',
      client: validCitadelMetadata.client,
      server: validCitadelMetadata.server
    });
    expect(generateClientRegistry([appPackage])).toContain(
      "import { demoBrowserRegistration as bundledClientRegistration0 } from '@example/app-demo/browser';"
    );
    expect(generateServerRegistry([appPackage])).toContain(
      "import { demoNodeRegistration as bundledServerRegistration0 } from '@example/app-demo/node';"
    );
  });

  it('resolves workspace symlinks through node_modules package directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const workspacePackageDir = join(tempDir, 'workspace-app');
    const installedPackageDir = join(tempDir, 'node_modules/@example/app-demo');
    mkdirSync(workspacePackageDir, { recursive: true });
    writeFileSync(join(workspacePackageDir, 'package.json'), JSON.stringify({
      name: '@example/app-demo',
      citadel: validCitadelMetadata
    }, null, 2));
    mkdirSync(dirname(installedPackageDir), { recursive: true });
    symlinkSync(workspacePackageDir, installedPackageDir, 'dir');

    expect(resolveAppPackages({
      packages: ['@example/app-demo']
    }, { rootDir: tempDir })[0].appId).toBe('demo');
  });

  it('rejects missing installed packages and unsafe package names', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));

    expect(() => resolveAppPackages({
      packages: ['@example/app-missing']
    }, { rootDir: tempDir })).toThrow(
      'Bundled app package @example/app-missing is not installed at node_modules/@example/app-missing/package.json'
    );

    for (const packageName of ['', '../app', '@scope/../app', '/tmp/app', 'app/extra', '@scope', '@scope/app/extra']) {
      expect(() => validatePackageName(packageName)).toThrow();
    }
  });

  it('rejects invalid citadel metadata and duplicate app ids', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    writePackage(tempDir, '@example/app-missing-metadata', { citadel: undefined });
    writePackage(tempDir, '@example/app-invalid-persistence', {
      citadel: {
        ...validCitadelMetadata,
        persistence: 'json'
      }
    });
    writePackage(tempDir, '@example/app-a');
    writePackage(tempDir, '@example/app-b');

    expect(() => resolveAppPackages({
      packages: ['@example/app-missing-metadata']
    }, { rootDir: tempDir })).toThrow(
      'Bundled app package @example/app-missing-metadata must declare citadel metadata'
    );
    expect(() => resolveAppPackages({
      packages: ['@example/app-invalid-persistence']
    }, { rootDir: tempDir })).toThrow(
      'Bundled app package @example/app-invalid-persistence citadel.persistence must be "none" or "sqlite"'
    );
    expect(() => resolveAppPackages({
      packages: ['@example/app-a', '@example/app-b']
    }, { rootDir: tempDir })).toThrow('Duplicate bundled app id: demo');
  });
});
