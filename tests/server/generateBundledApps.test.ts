import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore The generator is a Node ESM script exercised directly by Vitest.
import { generateInstalledAppCatalog, readConfig, resolveAppPackages, resolveInstalledPackageJsonPath, runGenerator, validatePackageName } from '../../scripts/generate-bundled-apps.mjs';

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

function writeRuntimePackage(
  rootDir: string,
  packageName: string,
  options: {
    metadata?: typeof validCitadelMetadata;
    rootDescriptor?: Record<string, unknown>;
    clientExports?: string;
    serverExports?: string;
  } = {}
) {
  const metadata = options.metadata ?? validCitadelMetadata;
  const packageJsonPath = resolveInstalledPackageJsonPath(packageName, { rootDir });
  const packageDir = dirname(packageJsonPath);
  mkdirSync(join(packageDir, 'dist'), { recursive: true });
  writeFileSync(packageJsonPath, JSON.stringify({
    name: packageName,
    type: 'module',
    exports: {
      '.': {
        import: './dist/index.js'
      },
      [metadata.client.subpath]: {
        import: './dist/client.js'
      },
      [metadata.server.subpath]: {
        import: './dist/server.js'
      }
    },
    citadel: metadata
  }, null, 2));
  writeFileSync(join(packageDir, 'dist/index.js'), [
    `export const demoAppPackage = ${JSON.stringify(options.rootDescriptor ?? {
      appId: metadata.appId,
      manifest: {
        appId: metadata.appId,
        label: metadata.label,
        defaultSpaceId: metadata.defaultSpaceId,
        persistence: metadata.persistence,
        version: metadata.version
      },
      packageName,
      client: metadata.client,
      server: metadata.server
    })};`
  ].join('\n'));
  writeFileSync(join(packageDir, 'dist/client.js'), options.clientExports ?? (
    `export const ${metadata.client.registrationExport} = { appId: ${JSON.stringify(metadata.appId)} };\n`
  ));
  writeFileSync(join(packageDir, 'dist/server.js'), options.serverExports ?? (
    `export const ${metadata.server.registrationExport} = { appId: ${JSON.stringify(metadata.appId)} };\n`
  ));
}

function generatorOutputs(rootDir: string) {
  return [
    {
      path: join(rootDir, 'src/bundledApps/generatedAppCatalog.ts'),
      generate: generateInstalledAppCatalog
    }
  ];
}

function sourceFrom(rootDir: string, path: string) {
  return readFileSync(join(rootDir, path), 'utf8');
}

async function runGeneratorForPackages(rootDir: string, packages: string[]) {
  const configPath = join(rootDir, 'bundled-apps.json');
  writeFileSync(configPath, JSON.stringify({ packages }, null, 2));

  for (const output of generatorOutputs(rootDir)) {
    mkdirSync(dirname(output.path), { recursive: true });
  }

  await runGenerator({
    rootDir,
    configPath,
    outputs: generatorOutputs(rootDir)
  });
}

describe('bundled app catalog generator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-bundled-apps-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads bundled app package config', () => {
    const configPath = join(tempDir, 'bundled-apps.json');
    writeFileSync(configPath, JSON.stringify({
      packages: ['@example/app-demo']
    }));

    expect(readConfig(configPath)).toEqual({
      packages: ['@example/app-demo']
    });
  });

  it('rejects invalid config shapes and unsafe package names', () => {
    const configPath = join(tempDir, 'bundled-apps.json');
    writeFileSync(configPath, JSON.stringify({ apps: [] }));
    expect(() => readConfig(configPath)).toThrow('bundled-apps.json must contain a packages array');

    writeFileSync(configPath, JSON.stringify({ packages: ['@example/app-demo', 7] }));
    expect(() => readConfig(configPath)).toThrow('bundled-apps.json packages must contain only strings');

    expect(() => validatePackageName('')).toThrow('Bundled app package names must be non-empty strings');

    for (const packageName of ['../app', '@scope/../app', '/tmp/app', 'app/extra', '@scope', '@scope/app/extra']) {
      expect(() => validatePackageName(packageName)).toThrow(`Invalid bundled app package name: ${packageName}`);
    }
  });

  it('resolves package metadata from installed node_modules packages', () => {
    writePackage(tempDir, '@example/app-demo');

    expect(resolveInstalledPackageJsonPath('@example/app-demo', { rootDir: tempDir })).toBe(
      join(tempDir, 'node_modules/@example/app-demo/package.json')
    );
    expect(resolveAppPackages({
      packages: ['@example/app-demo']
    }, { rootDir: tempDir })).toEqual([
      {
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
      }
    ]);
  });

  it('resolves workspace symlinks through node_modules package directories', () => {
    const workspacePackageDir = join(tempDir, 'workspace-app');
    const installedPackageDir = join(tempDir, 'node_modules/@example/app-demo');
    mkdirSync(dirname(installedPackageDir), { recursive: true });
    mkdirSync(workspacePackageDir, { recursive: true });
    symlinkSync(workspacePackageDir, installedPackageDir);
    writeFileSync(join(workspacePackageDir, 'package.json'), JSON.stringify({
      name: '@example/app-demo',
      citadel: validCitadelMetadata
    }));

    expect(resolveAppPackages({
      packages: ['@example/app-demo']
    }, { rootDir: tempDir })[0].appId).toBe('demo');
  });

  it('rejects missing packages, missing metadata, invalid metadata, and duplicate app ids', () => {
    expect(() => resolveAppPackages({
      packages: ['@example/app-missing']
    }, { rootDir: tempDir })).toThrow(
      'Bundled app package @example/app-missing is not installed at node_modules/@example/app-missing/package.json. Install the package or remove it from bundled-apps.json.'
    );

    writePackage(tempDir, '@example/app-missing-metadata', { citadel: undefined });
    writePackage(tempDir, '@example/app-invalid-persistence', {
      citadel: {
        ...validCitadelMetadata,
        persistence: 'postgres'
      }
    });
    writePackage(tempDir, '@example/app-a');
    writePackage(tempDir, '@example/app-b');

    expect(() => resolveAppPackages({
      packages: ['@example/app-missing-metadata']
    }, { rootDir: tempDir })).toThrow('Bundled app package @example/app-missing-metadata must declare citadel metadata');
    expect(() => resolveAppPackages({
      packages: ['@example/app-invalid-persistence']
    }, { rootDir: tempDir })).toThrow('Bundled app package @example/app-invalid-persistence citadel.persistence must be "none" or "sqlite"');
    expect(() => resolveAppPackages({
      packages: ['@example/app-a', '@example/app-b']
    }, { rootDir: tempDir })).toThrow('Duplicate bundled app id: demo');
  });

  it('validates package exports and registration exports before generating a catalog', async () => {
    writeRuntimePackage(tempDir, '@example/app-demo');
    await runGeneratorForPackages(tempDir, ['@example/app-demo']);

    const generatedCatalog = sourceFrom(tempDir, 'src/bundledApps/generatedAppCatalog.ts');

    expect(generatedCatalog).toContain("import { demoBrowserRegistration as bundledClientRegistration0 } from '@example/app-demo/browser';");
    expect(generatedCatalog).toContain("import { demoNodeRegistration as bundledServerRegistration0 } from '@example/app-demo/node';");
    expect(generatedCatalog).toContain('packageName: "@example/app-demo"');
    expect(generatedCatalog).toContain('bundledInstalledApps');
  });

  it('fails clearly when an installed app does not export the configured client or server registration', async () => {
    writeRuntimePackage(tempDir, '@example/app-demo', {
      clientExports: 'export const wrongClientRegistration = {};\n'
    });

    await expect(runGeneratorForPackages(tempDir, ['@example/app-demo'])).rejects.toThrow(
      'Bundled app package @example/app-demo/browser must export demoBrowserRegistration'
    );

    const serverFailureDir = join(tempDir, 'server-failure');
    writeRuntimePackage(serverFailureDir, '@example/app-demo-server', {
      serverExports: 'export const wrongServerRegistration = {};\n'
    });

    await expect(runGeneratorForPackages(serverFailureDir, ['@example/app-demo-server'])).rejects.toThrow(
      'Bundled app package @example/app-demo-server/node must export demoNodeRegistration'
    );
  });

  it('fails clearly when the package root does not export a descriptor matching metadata', async () => {
    writeRuntimePackage(tempDir, '@example/app-demo', {
      rootDescriptor: {
        appId: 'other'
      }
    });

    await expect(runGeneratorForPackages(tempDir, ['@example/app-demo'])).rejects.toThrow(
      'Bundled app package @example/app-demo root surface must export an app package descriptor matching citadel metadata'
    );
  });

  it('checks generated output freshness', async () => {
    writeRuntimePackage(tempDir, '@example/app-demo');
    await runGeneratorForPackages(tempDir, ['@example/app-demo']);

    await expect(runGenerator({
      rootDir: tempDir,
      configPath: join(tempDir, 'bundled-apps.json'),
      outputs: generatorOutputs(tempDir),
      checkOnly: true
    })).resolves.toBeUndefined();

    writeFileSync(join(tempDir, 'src/bundledApps/generatedAppCatalog.ts'), 'stale');

    await expect(runGenerator({
      rootDir: tempDir,
      configPath: join(tempDir, 'bundled-apps.json'),
      outputs: generatorOutputs(tempDir),
      checkOnly: true
    })).rejects.toThrow('src/bundledApps/generatedAppCatalog.ts is stale. Run npm run generate:bundled-apps.');
  });

  it('generates a catalog from the currently installed first-party app packages', async () => {
    const hostDir = join(tempDir, 'host');
    mkdirSync(join(hostDir, 'node_modules/@citadel-platform'), { recursive: true });

    for (const packageName of ['@citadel-platform/app-chat', '@citadel-platform/app-chess', '@citadel-platform/app-snake']) {
      symlinkSync(
        join(process.cwd(), 'node_modules', ...packageName.split('/')),
        join(hostDir, 'node_modules', ...packageName.split('/'))
      );
    }

    await runGeneratorForPackages(hostDir, ['@citadel-platform/app-chat', '@citadel-platform/app-chess', '@citadel-platform/app-snake']);

    const generatedCatalog = sourceFrom(hostDir, 'src/bundledApps/generatedAppCatalog.ts');

    expect(generatedCatalog).toContain("import { chatClientRegistration as bundledClientRegistration0 } from '@citadel-platform/app-chat/client';");
    expect(generatedCatalog).toContain("import { chessServerRegistration as bundledServerRegistration1 } from '@citadel-platform/app-chess/server';");
    expect(generatedCatalog).toContain("import { snakeServerRegistration as bundledServerRegistration2 } from '@citadel-platform/app-snake/server';");
    expect(generatedCatalog).toContain('packageName: "@citadel-platform/app-chat"');
    expect(generatedCatalog).toContain('packageName: "@citadel-platform/app-chess"');
    expect(generatedCatalog).toContain('packageName: "@citadel-platform/app-snake"');
    expect(existsSync(join(hostDir, 'src/bundledApps/generatedAppCatalog.ts'))).toBe(true);
  });
});
