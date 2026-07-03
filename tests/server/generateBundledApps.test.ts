import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The generator is a Node ESM script exercised directly by Vitest.
import { generateInstalledAppCatalog, readConfig, resolveAppPackages, resolveInstalledPackageJsonPath, runGenerator, validatePackageName } from '../../scripts/generate-bundled-apps.mjs';
// @ts-expect-error The local external app installer is a Node ESM script exercised directly by Vitest.
import { installLocalExternalApps } from '../../scripts/install-local-external-apps.mjs';
// @ts-expect-error The installer is a Node ESM script exercised directly by Vitest.
import { installPackedLocalPackage } from '../../scripts/install-packed-local-package.mjs';

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

function localNodeModuleDependency(packageName: string) {
  return `file:${join(process.cwd(), 'node_modules', ...packageName.split('/'))}`;
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

type PackFile = {
  path: string;
};

type PackResult = {
  filename: string;
  files: PackFile[];
};

type PackedWorkspaceAppResult = {
  filename: string;
  tarballPath: string;
  files: string[];
};

const packedLocalPackageSources = {
  '@citadel/platform': 'packages/platform',
  '@citadel/app-chat': 'packages/apps/chat',
  '@citadel/app-chess': 'packages/apps/chess',
  '@citadel/app-snake': 'packages/apps/snake'
} as const;

const packedAppSources = {
  '@citadel/app-chat': packedLocalPackageSources['@citadel/app-chat'],
  '@citadel/app-chess': packedLocalPackageSources['@citadel/app-chess'],
  '@citadel/app-snake': packedLocalPackageSources['@citadel/app-snake']
} as const;

type PackedLocalPackageName = keyof typeof packedLocalPackageSources;
type PackedAppPackageName = keyof typeof packedAppSources;

const packedAppPackageNames = Object.keys(packedAppSources) as PackedAppPackageName[];
const externalSourcePackageFixtures = [
  {
    appId: 'chat',
    packageName: '@citadel/app-chat',
    sourcePath: 'packages/apps/chat',
    runtimeDependencies: ['nanoid']
  },
  {
    appId: 'chess',
    packageName: '@citadel/app-chess',
    sourcePath: 'packages/apps/chess',
    runtimeDependencies: ['chess.js', 'nanoid']
  },
  {
    appId: 'snake',
    packageName: '@citadel/app-snake',
    sourcePath: 'packages/apps/snake',
    runtimeDependencies: []
  }
] as const satisfies Array<{
  appId: string;
  packageName: PackedAppPackageName;
  sourcePath: string;
  runtimeDependencies: readonly string[];
}>;

function runNpm(args: string[], options: { cacheDir: string }) {
  return execFileSync('npm', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      npm_config_cache: options.cacheDir,
      CITADEL_PACK_NPM_CACHE: options.cacheDir
    },
    encoding: 'utf8'
  });
}

function packApp(
  packageName: PackedLocalPackageName,
  options: { cacheDir: string; destinationDir: string; skipBuild?: boolean }
) {
  const args = [
    'scripts/pack-local-package.mjs',
    packageName,
    '--destination',
    options.destinationDir,
    '--json'
  ];

  if (options.skipBuild ?? true) {
    args.push('--skip-build');
  }

  const packOutput = execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      npm_config_cache: options.cacheDir,
      CITADEL_PACK_NPM_CACHE: options.cacheDir
    },
    encoding: 'utf8'
  });
  const packedApp = JSON.parse(packOutput) as PackedWorkspaceAppResult;

  return {
    packResult: {
      filename: packedApp.filename,
      files: packedApp.files.map((path) => ({ path }))
    } satisfies PackResult,
    tarballPath: packedApp.tarballPath
  };
}

function installPackedAppsHost(options: {
  cacheDir: string;
  rootDir: string;
  packages: PackedAppPackageName[];
}) {
  const packDir = join(options.rootDir, 'packs');
  const hostDir = join(options.rootDir, 'host');
  const installedAppDirs: Record<string, string> = {};
  const tarballPaths: Record<string, string> = {};
  mkdirSync(packDir, { recursive: true });
  mkdirSync(hostDir, { recursive: true });

  tarballPaths['@citadel/platform'] = packApp('@citadel/platform', {
    cacheDir: options.cacheDir,
    destinationDir: packDir
  }).tarballPath;

  for (const packageName of options.packages) {
    tarballPaths[packageName] = packApp(packageName, {
      cacheDir: options.cacheDir,
      destinationDir: packDir
    }).tarballPath;
    installedAppDirs[packageName] = join(hostDir, 'node_modules', ...packageName.split('/'));
  }

  writeFileSync(join(hostDir, 'package.json'), JSON.stringify({
    name: 'external-app-host-fixture',
    private: true,
    type: 'module',
    workspaces: [],
    dependencies: {
      ...Object.fromEntries(options.packages.map((packageName) => [
        packageName,
        `file:${tarballPaths[packageName]}`
      ])),
      '@citadel/platform': `file:${tarballPaths['@citadel/platform']}`,
      'chess.js': `file:${join(process.cwd(), 'node_modules/chess.js')}`,
      express: `file:${join(process.cwd(), 'node_modules/express')}`,
      nanoid: `file:${join(process.cwd(), 'node_modules/nanoid')}`,
      react: `file:${join(process.cwd(), 'node_modules/react')}`,
      'socket.io': `file:${join(process.cwd(), 'node_modules/socket.io')}`
    }
  }, null, 2));
  runNpm(['install', '--ignore-scripts', '--offline', '--prefix', hostDir], { cacheDir: options.cacheDir });

  return {
    hostDir,
    installedAppDirs,
    installedPlatformDir: join(hostDir, 'node_modules/@citadel/platform'),
    tarballPaths
  };
}

function installPackedSnakeHost(options: { cacheDir: string; rootDir: string }) {
  const host = installPackedAppsHost({
    ...options,
    packages: ['@citadel/app-snake']
  });

  return {
    hostDir: host.hostDir,
    installedSnakeDir: host.installedAppDirs['@citadel/app-snake'],
    installedPlatformDir: host.installedPlatformDir,
    platformTarballPath: host.tarballPaths['@citadel/platform'],
    tarballPath: host.tarballPaths['@citadel/app-snake']
  };
}

function packSnake(options: { cacheDir: string; destinationDir: string; skipBuild?: boolean }) {
  return packApp('@citadel/app-snake', options);
}

function expectBuiltAppPackageArtifact(files: string[]) {
  expect(files).toContain('package.json');
  expect(files).toContain('dist/index.js');
  expect(files).toContain('dist/index.d.ts');
  expect(files).toContain('dist/client.js');
  expect(files).toContain('dist/client.d.ts');
  expect(files).toContain('dist/server.js');
  expect(files).toContain('dist/server.d.ts');
  expect(files.some((file) => file.startsWith('src/'))).toBe(false);
  expect(files.some((file) => file.startsWith('dist/src/'))).toBe(false);
  expect(files).not.toContain('index.ts');
  expect(files).not.toContain('client.ts');
  expect(files).not.toContain('server.ts');
  expect(files).not.toContain('tsconfig.json');
  expect(files).not.toContain('tsconfig.build.json');
}

function transpileGeneratedCatalog(hostDir: string) {
  const sourcePath = join(hostDir, 'src/bundledApps/generatedAppCatalog.ts');
  const outputPath = join(hostDir, 'src/bundledApps/generatedAppCatalog.mjs');
  const output = transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022
    }
  });

  writeFileSync(outputPath, output.outputText);

  return outputPath;
}

describe('bundled app generator package resolution', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('resolves current local app packages through installed node_modules links', () => {
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
    expect(generateInstalledAppCatalog([appPackage])).toContain(
      "import { demoBrowserRegistration as bundledClientRegistration0 } from '@example/app-demo/browser';"
    );
    expect(generateInstalledAppCatalog([appPackage])).toContain(
      "import { demoNodeRegistration as bundledServerRegistration0 } from '@example/app-demo/node';"
    );
  });

  it('validates bundled app config JSON shape before package resolution', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const configPath = join(tempDir, 'bundled-apps.json');

    writeFileSync(configPath, JSON.stringify({
      packages: ['@example/app-demo']
    }));
    expect(readConfig(configPath)).toEqual({
      packages: ['@example/app-demo']
    });

    writeFileSync(configPath, JSON.stringify({}));
    expect(() => readConfig(configPath)).toThrow('bundled-apps.json must contain a packages array');

    writeFileSync(configPath, JSON.stringify({ packages: '@example/app-demo' }));
    expect(() => readConfig(configPath)).toThrow('bundled-apps.json must contain a packages array');

    writeFileSync(configPath, JSON.stringify({ packages: ['@example/app-demo', 7] }));
    expect(() => readConfig(configPath)).toThrow('bundled-apps.json packages must contain only strings');
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
      'Bundled app package @example/app-missing is not installed at node_modules/@example/app-missing/package.json. Install the package or remove it from bundled-apps.json.'
    );

    for (const packageName of ['', '../app', '@scope/../app', '/tmp/app', 'app/extra', '@scope', '@scope/app/extra']) {
      expect(() => validatePackageName(packageName)).toThrow();
    }
  });

  it('fails clearly when an external-only bundled app is not installed', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));

    await expect(runGeneratorForPackages(tempDir, ['@citadel/app-missing'])).rejects.toThrow(
      'Bundled app package @citadel/app-missing is not installed at node_modules/@citadel/app-missing/package.json. Install the package or remove it from bundled-apps.json.'
    );
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

  it.each([
    '@citadel/app-chat',
    '@citadel/app-chess',
    '@citadel/app-snake'
  ] as const)('packs %s as a built package artifact without source files', (packageName) => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');

    const { packResult, tarballPath } = packApp(packageName, {
      cacheDir,
      destinationDir: join(tempDir, 'packs')
    });
    const packedFiles = packResult.files.map((file) => file.path).sort();

    expect(existsSync(tarballPath)).toBe(true);
    expectBuiltAppPackageArtifact(packedFiles);
  });

  it('packs platform as a built package artifact without source files', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');

    const { packResult, tarballPath } = packApp('@citadel/platform', {
      cacheDir,
      destinationDir: join(tempDir, 'packs')
    });
    const packedFiles = packResult.files.map((file) => file.path).sort();

    expect(existsSync(tarballPath)).toBe(true);
    expect(packedFiles).toContain('package.json');
    expect(packedFiles).toContain('dist/app.js');
    expect(packedFiles).toContain('dist/app.d.ts');
    expect(packedFiles).toContain('dist/client.js');
    expect(packedFiles).toContain('dist/client.d.ts');
    expect(packedFiles).toContain('dist/server.js');
    expect(packedFiles).toContain('dist/server.d.ts');
    expect(packedFiles).toContain('dist/appPackageMetadata.js');
    expect(packedFiles).toContain('dist/appPackageMetadata.d.ts');
    expect(packedFiles).toContain('dist/generateAppMetadataCli.js');
    expect(packedFiles).toContain('dist/generateAppMetadataCli.d.ts');
    expect(JSON.parse(readFileSync(join(process.cwd(), 'packages/platform/package.json'), 'utf8')).bin).toEqual({
      'citadel-generate-app-metadata': './dist/generateAppMetadataCli.js'
    });
    expect(packedFiles.some((file) => file.startsWith('src/'))).toBe(false);
    expect(packedFiles.some((file) => file.startsWith('dist/src/'))).toBe(false);
    expect(packedFiles).not.toContain('app.ts');
    expect(packedFiles).not.toContain('server.ts');
    expect(packedFiles).not.toContain('tsconfig.json');
    expect(packedFiles).not.toContain('tsconfig.build.json');
  });

  it.each(externalSourcePackageFixtures)(
    'builds $appId from a standalone external app source package with packed platform tooling',
    ({ appId, packageName, sourcePath, runtimeDependencies }) => {
      tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
      const cacheDir = join(tempDir, 'npm-cache');
      const externalAppDir = join(tempDir, `external-${appId}-app`);
      const platformTarballPath = packApp('@citadel/platform', {
        cacheDir,
        destinationDir: join(tempDir, 'packs')
      }).tarballPath;
      const packageJson = JSON.parse(
        readFileSync(join(process.cwd(), sourcePath, 'package.json'), 'utf8')
      ) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };

      mkdirSync(externalAppDir, { recursive: true });
      cpSync(join(process.cwd(), sourcePath, 'src'), join(externalAppDir, 'src'), { recursive: true });
      cpSync(join(process.cwd(), sourcePath, 'tsconfig.json'), join(externalAppDir, 'tsconfig.json'));
      cpSync(join(process.cwd(), sourcePath, 'tsconfig.build.json'), join(externalAppDir, 'tsconfig.build.json'));

      packageJson.dependencies = {
        ...packageJson.dependencies,
        '@citadel/platform': `file:${platformTarballPath}`,
        ...Object.fromEntries(runtimeDependencies.map((dependencyName) => [
          dependencyName,
          localNodeModuleDependency(dependencyName)
        ])),
        express: localNodeModuleDependency('express'),
        nanoid: localNodeModuleDependency('nanoid'),
        'socket.io': localNodeModuleDependency('socket.io')
      };
      packageJson.devDependencies = {
        ...packageJson.devDependencies,
        '@types/node': localNodeModuleDependency('@types/node'),
        '@types/react': localNodeModuleDependency('@types/react'),
        react: localNodeModuleDependency('react'),
        typescript: localNodeModuleDependency('typescript')
      };
      writeFileSync(join(externalAppDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      runNpm(['install', '--ignore-scripts', '--offline', '--prefix', externalAppDir], { cacheDir });
      expect(existsSync(join(externalAppDir, 'node_modules/.bin/citadel-generate-app-metadata'))).toBe(true);

      runNpm(['run', 'build', '--prefix', externalAppDir], { cacheDir });

      expect(sourceFrom(externalAppDir, 'src/generatedMetadata.ts')).toContain(
        '// Generated by citadel-generate-app-metadata from package.json#citadel.'
      );
      expect(readdirSync(join(externalAppDir, 'dist')).sort()).toContain('index.js');
      expect(readdirSync(join(externalAppDir, 'dist')).sort()).toContain('client.js');
      expect(readdirSync(join(externalAppDir, 'dist')).sort()).toContain('server.js');
      expect(sourceFrom(externalAppDir, 'package.json')).toContain(packageName);
    }
  );

  it.each([
    {
      appId: 'chat',
      packageName: '@citadel/app-chat',
      sourcePath: 'packages/apps/chat'
    },
    {
      appId: 'chess',
      packageName: '@citadel/app-chess',
      sourcePath: 'packages/apps/chess'
    },
    {
      appId: 'snake',
      packageName: '@citadel/app-snake',
      sourcePath: 'packages/apps/snake'
    }
  ])('installs packed $appId over an existing workspace link', ({ appId, packageName, sourcePath }) => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');
    const installedAppDir = join(tempDir, 'node_modules', ...packageName.split('/'));
    const previousCache = process.env.CITADEL_PACK_NPM_CACHE;
    let installResult: ReturnType<typeof installPackedLocalPackage>;

    mkdirSync(dirname(installedAppDir), { recursive: true });
    symlinkSync(join(process.cwd(), sourcePath), installedAppDir, 'dir');

    try {
      process.env.CITADEL_PACK_NPM_CACHE = cacheDir;
      installResult = installPackedLocalPackage({
        packageName,
        installRootDir: tempDir,
        destinationDir: join(tempDir, 'packs'),
        skipBuild: true,
        quiet: true
      });
    } finally {
      if (previousCache === undefined) {
        delete process.env.CITADEL_PACK_NPM_CACHE;
      } else {
        process.env.CITADEL_PACK_NPM_CACHE = previousCache;
      }
    }

    expect(lstatSync(installedAppDir).isSymbolicLink()).toBe(false);
    expect(readdirSync(installedAppDir).sort()).toEqual(
      appId === 'snake' ? ['dist', 'package.json'] : ['dist', 'node_modules', 'package.json']
    );
    expect(JSON.parse(readFileSync(join(installedAppDir, 'package.json'), 'utf8')).citadel.appId).toBe(appId);
    expect(installResult!.installedDependencyDirs.map((dependencyDir: string) => dependencyDir.slice(installedAppDir.length + 1)).sort()).toEqual(
      appId === 'chat'
        ? ['node_modules/nanoid']
        : appId === 'chess'
          ? ['node_modules/chess.js', 'node_modules/nanoid']
          : []
    );
  });

  it('generates bundled app registries from a packed snake dependency install', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');
    const { hostDir, installedSnakeDir } = installPackedSnakeHost({ cacheDir, rootDir: tempDir });
    const [{ path: generatedCatalogPath }] = generatorOutputs(hostDir);

    await runGeneratorForPackages(hostDir, ['@citadel/app-snake']);

    const generatedCatalog = readFileSync(generatedCatalogPath, 'utf8');
    const installedSnakeFiles = readdirSync(installedSnakeDir).sort();

    expect(lstatSync(installedSnakeDir).isSymbolicLink()).toBe(false);
    expect(installedSnakeFiles).toEqual(['dist', 'package.json']);
    expect(JSON.parse(readFileSync(join(installedSnakeDir, 'package.json'), 'utf8')).citadel.appId).toBe('snake');
    expect(generatedCatalog).toContain('"@citadel/app-snake"');
    expect(generatedCatalog).toContain('appId: "snake"');
    expect(generatedCatalog).toContain('persistence: "none"');
    expect(generatedCatalog).not.toContain('legacyServices');
    expect(generatedCatalog).not.toContain('capabilities');
    expect(generatedCatalog).toContain('bundledInstalledApps');
    expect(generatedCatalog).not.toContain('bundledAppDescriptorByPackageName');
    expect(generatedCatalog).not.toContain('bundledClientRegistrationByPackageName');
    expect(generatedCatalog).not.toContain('bundledServerRegistrationByPackageName');
    expect(generatedCatalog).not.toContain('@citadel/app-chat');
    expect(generatedCatalog).not.toContain('@citadel/app-chess');
    expect(generatedCatalog).toContain(
      "import { snakeClientRegistration as bundledClientRegistration0 } from '@citadel/app-snake/client';"
    );
    expect(generatedCatalog).toContain(
      "import { snakeServerRegistration as bundledServerRegistration0 } from '@citadel/app-snake/server';"
    );
  });

  it('builds local external apps once before installing packed artifacts', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const configPath = join(tempDir, 'local-external-apps.json');
    const buildCommands: string[][] = [];
    const generatedMetadataDirs: string[] = [];
    const installOptions: Array<{
      packageName: string;
      installRootDir: string;
      skipBuild: boolean;
      quiet: boolean;
    }> = [];

    writeFileSync(configPath, JSON.stringify({
      packages: [
        { packageName: '@citadel/app-chat', sourcePath: 'packages/apps/chat' },
        { packageName: '@citadel/app-snake', sourcePath: 'packages/apps/snake' }
      ]
    }, null, 2));

    const results = installLocalExternalApps({
      rootDir: tempDir,
      configPath,
      quiet: true,
      sourceRootDir: tempDir,
      generateMetadata(packageSourceDir: string) {
        generatedMetadataDirs.push(packageSourceDir);
      },
      runNpmCommand(args: string[]) {
        buildCommands.push(args);
      },
      installPackedApp(options: {
        packageName: string;
        installRootDir: string;
        skipBuild: boolean;
        quiet: boolean;
      }) {
        installOptions.push(options);

        return {
          packageName: options.packageName,
          installedPackageDir: join(options.installRootDir, 'node_modules', ...options.packageName.split('/'))
        };
      }
    });

    expect(buildCommands).toEqual([
      ['run', 'build', '-w', '@citadel/platform'],
      ['run', 'build', '--ignore-scripts', '--prefix', join(tempDir, 'packages/apps/chat')],
      ['run', 'build', '--ignore-scripts', '--prefix', join(tempDir, 'packages/apps/snake')]
    ]);
    expect(generatedMetadataDirs).toEqual([
      join(tempDir, 'packages/apps/chat'),
      join(tempDir, 'packages/apps/snake')
    ]);
    expect(installOptions).toEqual([
      expect.objectContaining({
        packageName: '@citadel/app-chat',
        installRootDir: tempDir,
        skipBuild: true,
        quiet: true
      }),
      expect.objectContaining({
        packageName: '@citadel/app-snake',
        installRootDir: tempDir,
        skipBuild: true,
        quiet: true
      })
    ]);
    expect(results.map((result: { packageName: string }) => result.packageName)).toEqual([
      '@citadel/app-chat',
      '@citadel/app-snake'
    ]);

    buildCommands.length = 0;
    generatedMetadataDirs.length = 0;
    installOptions.length = 0;
    installLocalExternalApps({
      rootDir: tempDir,
      configPath,
      quiet: true,
      skipPlatformBuild: true,
      sourceRootDir: tempDir,
      generateMetadata(packageSourceDir: string) {
        generatedMetadataDirs.push(packageSourceDir);
      },
      runNpmCommand(args: string[]) {
        buildCommands.push(args);
      },
      installPackedApp(options: {
        packageName: string;
        installRootDir: string;
        skipBuild: boolean;
        quiet: boolean;
      }) {
        installOptions.push(options);

        return options;
      }
    });

    expect(buildCommands).toEqual([
      ['run', 'build', '--ignore-scripts', '--prefix', join(tempDir, 'packages/apps/chat')],
      ['run', 'build', '--ignore-scripts', '--prefix', join(tempDir, 'packages/apps/snake')]
    ]);
    expect(generatedMetadataDirs).toEqual([
      join(tempDir, 'packages/apps/chat'),
      join(tempDir, 'packages/apps/snake')
    ]);
    expect(installOptions.every((options) => options.skipBuild)).toBe(true);
  });

  it('treats local external app config as optional host migration data', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const buildCommands: string[][] = [];
    const installOptions: unknown[] = [];

    expect(installLocalExternalApps({
      rootDir: tempDir,
      quiet: true,
      runNpmCommand(args: string[]) {
        buildCommands.push(args);
      },
      installPackedApp(options: unknown) {
        installOptions.push(options);
        return options;
      }
    })).toEqual([]);
    expect(buildCommands).toEqual([]);
    expect(installOptions).toEqual([]);

    const missingConfigPath = join(tempDir, 'missing-local-external-apps.json');

    expect(() => installLocalExternalApps({
      rootDir: tempDir,
      configPath: missingConfigPath,
      quiet: true
    })).toThrow(`local-external-apps.json not found at ${missingConfigPath}`);
  });

  it('boots a snake-only host catalog from a packed external dependency', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');
    const {
      hostDir,
      installedPlatformDir,
      installedSnakeDir,
      platformTarballPath,
      tarballPath
    } = installPackedSnakeHost({ cacheDir, rootDir: tempDir });
    const probePath = join(hostDir, 'probe.ts');
    const hostPackage = JSON.parse(readFileSync(join(hostDir, 'package.json'), 'utf8')) as {
      workspaces: string[];
    };
    const packageLock = JSON.parse(readFileSync(join(hostDir, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { dependencies?: Record<string, string> }>;
    };

    expect(hostPackage.workspaces).toEqual([]);
    expect(lstatSync(installedPlatformDir).isSymbolicLink()).toBe(false);
    expect(readdirSync(installedPlatformDir).sort()).toEqual(['dist', 'package.json']);
    expect(lstatSync(installedSnakeDir).isSymbolicLink()).toBe(false);
    expect(readdirSync(installedSnakeDir).sort()).toEqual(['dist', 'package.json']);
    expect(packageLock.packages[''].dependencies?.['@citadel/platform']).toBe(`file:${platformTarballPath}`);
    expect(packageLock.packages[''].dependencies?.['@citadel/app-snake']).toBe(`file:${tarballPath}`);

    await runGeneratorForPackages(hostDir, ['@citadel/app-snake']);
    transpileGeneratedCatalog(hostDir);
    writeFileSync(probePath, [
      "import { createPlatformServer } from '@citadel/platform/server';",
      "import { bundledInstalledApps } from './src/bundledApps/generatedAppCatalog.mjs';",
      '',
      'const [installedApp] = bundledInstalledApps;',
      'const serverModule = installedApp.serverRegistration.createServerApp({',
      '  database: { database: {} }',
      '});',
      'const platform = createPlatformServer({',
      '  apps: [serverModule],',
      '  appManifests: [installedApp.descriptor.manifest]',
      '});',
      'const initialState = serverModule.getInitialState({',
      "  appId: 'snake',",
      "  spaceId: 'arena',",
      '  participants: [],',
      '  emitToSpace() {},',
      '  emitToParticipant() {},',
      '  emitSpaceState() {},',
      '  getAppState() { return undefined; },',
      '  setAppState() {},',
      '  clearAppState() {}',
      '});',
      'console.log(JSON.stringify({',
      '  installedCount: bundledInstalledApps.length,',
      '  descriptorAppId: installedApp.descriptor.appId,',
      '  descriptorPackageName: installedApp.descriptor.packageName,',
      "  descriptorByAppId: bundledInstalledApps.find((app) => app.descriptor.appId === 'snake')?.descriptor.packageName,",
      "  clientRegistrationAppId: bundledInstalledApps.find((app) => app.clientRegistration.appId === 'snake')?.clientRegistration.appId,",
      "  serverRegistrationAppId: bundledInstalledApps.find((app) => app.serverRegistration.appId === 'snake')?.serverRegistration.appId,",
      '  serverModuleAppId: serverModule.appId,',
      '  platformAppIds: [...platform.apps.keys()],',
      '  initialState',
      '}));',
      'platform.io.close();',
      'platform.httpServer.close();'
    ].join('\n'));

    const probe = JSON.parse(execFileSync(process.execPath, [probePath], {
      cwd: hostDir,
      encoding: 'utf8'
    })) as {
      installedCount: number;
      descriptorAppId: string;
      descriptorPackageName: string;
      descriptorByAppId: string;
      clientRegistrationAppId: string;
      serverRegistrationAppId: string;
      serverModuleAppId: string;
      platformAppIds: string[];
      initialState: {
        stage: string;
        width: number;
        height: number;
        requiredReadyCount: number;
        readyCount: number;
        spectatorCount: number;
        snakes: unknown[];
      };
    };

    expect(probe).toMatchObject({
      installedCount: 1,
      descriptorAppId: 'snake',
      descriptorPackageName: '@citadel/app-snake',
      descriptorByAppId: '@citadel/app-snake',
      clientRegistrationAppId: 'snake',
      serverRegistrationAppId: 'snake',
      serverModuleAppId: 'snake',
      platformAppIds: ['snake'],
      initialState: {
        stage: 'waiting',
        width: 20,
        height: 16,
        requiredReadyCount: 2,
        readyCount: 0,
        spectatorCount: 0,
        snakes: []
      }
    });
  });

  it('generates a bundled app catalog from packed app dependency installs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');
    const { hostDir, installedAppDirs, installedPlatformDir, tarballPaths } = installPackedAppsHost({
      cacheDir,
      rootDir: tempDir,
      packages: packedAppPackageNames
    });
    const [{ path: generatedCatalogPath }] = generatorOutputs(hostDir);
    const hostPackage = JSON.parse(readFileSync(join(hostDir, 'package.json'), 'utf8')) as {
      workspaces: string[];
    };
    const packageLock = JSON.parse(readFileSync(join(hostDir, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { dependencies?: Record<string, string> }>;
    };
    const probePath = join(hostDir, 'probe.mjs');

    expect(hostPackage.workspaces).toEqual([]);
    expect(lstatSync(installedPlatformDir).isSymbolicLink()).toBe(false);
    expect(readdirSync(installedPlatformDir).sort()).toEqual(['dist', 'package.json']);
    expect(JSON.parse(readFileSync(join(installedPlatformDir, 'package.json'), 'utf8')).name).toBe('@citadel/platform');
    expect(packageLock.packages[''].dependencies?.['@citadel/platform']).toBe(`file:${tarballPaths['@citadel/platform']}`);
    for (const packageName of packedAppPackageNames) {
      const installedAppDir = installedAppDirs[packageName];

      expect(lstatSync(installedAppDir).isSymbolicLink()).toBe(false);
      expect(readdirSync(installedAppDir).sort()).toEqual(['dist', 'package.json']);
      expect(JSON.parse(readFileSync(join(installedAppDir, 'package.json'), 'utf8')).name).toBe(packageName);
      expect(packageLock.packages[''].dependencies?.[packageName]).toBe(`file:${tarballPaths[packageName]}`);
    }

    await runGeneratorForPackages(hostDir, packedAppPackageNames);
    transpileGeneratedCatalog(hostDir);
    writeFileSync(probePath, [
      "import { bundledInstalledApps } from './src/bundledApps/generatedAppCatalog.mjs';",
      '',
      'console.log(JSON.stringify({',
      '  generatedSource: ' + JSON.stringify(readFileSync(generatedCatalogPath, 'utf8')) + ',',
      '  apps: bundledInstalledApps.map((app) => ({',
      '    appId: app.descriptor.appId,',
      '    packageName: app.descriptor.packageName,',
      '    manifestAppId: app.descriptor.manifest.appId,',
      '    clientRegistrationAppId: app.clientRegistration.appId,',
      '    serverRegistrationAppId: app.serverRegistration.appId,',
      '    serverBundleAppId: app.serverRegistration.bundle.appId',
      '  })),',
      '  descriptorPackages: bundledInstalledApps.map((app) => app.descriptor.packageName),',
      '  clientPackages: bundledInstalledApps.map((app) => app.descriptor.packageName),',
      '  serverPackages: bundledInstalledApps.map((app) => app.descriptor.packageName)',
      '}));'
    ].join('\n'));

    const probe = JSON.parse(execFileSync(process.execPath, [probePath], {
      cwd: hostDir,
      encoding: 'utf8'
    })) as {
      generatedSource: string;
      apps: Array<{
        appId: string;
        packageName: string;
        manifestAppId: string;
        clientRegistrationAppId: string;
        serverRegistrationAppId: string;
        serverBundleAppId: string;
      }>;
      descriptorPackages: string[];
      clientPackages: string[];
      serverPackages: string[];
    };

    expect(probe.apps).toEqual([
      {
        appId: 'chat',
        packageName: '@citadel/app-chat',
        manifestAppId: 'chat',
        clientRegistrationAppId: 'chat',
        serverRegistrationAppId: 'chat',
        serverBundleAppId: 'chat'
      },
      {
        appId: 'chess',
        packageName: '@citadel/app-chess',
        manifestAppId: 'chess',
        clientRegistrationAppId: 'chess',
        serverRegistrationAppId: 'chess',
        serverBundleAppId: 'chess'
      },
      {
        appId: 'snake',
        packageName: '@citadel/app-snake',
        manifestAppId: 'snake',
        clientRegistrationAppId: 'snake',
        serverRegistrationAppId: 'snake',
        serverBundleAppId: 'snake'
      }
    ]);
    expect(probe.descriptorPackages).toEqual(packedAppPackageNames);
    expect(probe.clientPackages).toEqual(packedAppPackageNames);
    expect(probe.serverPackages).toEqual(packedAppPackageNames);
    expect(probe.generatedSource).toContain(
      "import { chatClientRegistration as bundledClientRegistration0 } from '@citadel/app-chat/client';"
    );
    expect(probe.generatedSource).toContain(
      "import { chessServerRegistration as bundledServerRegistration1 } from '@citadel/app-chess/server';"
    );
  });

  it('rejects installed packages whose client registration export is missing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    writeRuntimePackage(tempDir, '@example/app-demo', {
      clientExports: 'export const wrongClientRegistration = { appId: "demo" };\n'
    });

    await expect(runGeneratorForPackages(tempDir, ['@example/app-demo'])).rejects.toThrow(
      'Bundled app package @example/app-demo/browser must export demoBrowserRegistration'
    );
  });

  it('rejects installed packages whose root descriptor does not match metadata', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    writeRuntimePackage(tempDir, '@example/app-demo', {
      rootDescriptor: {
        appId: 'demo',
        manifest: {
          appId: 'demo',
          label: 'Wrong Demo',
          defaultSpaceId: 'general',
          persistence: 'sqlite',
          version: '0.1.0'
        },
        packageName: '@example/app-demo',
        client: validCitadelMetadata.client,
        server: validCitadelMetadata.server
      }
    });

    await expect(runGeneratorForPackages(tempDir, ['@example/app-demo'])).rejects.toThrow(
      'Bundled app package @example/app-demo root surface must export an app package descriptor matching citadel metadata'
    );
  });

  it('imports packed snake public package surfaces from a temp host install', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const cacheDir = join(tempDir, 'npm-cache');
    const { hostDir } = installPackedSnakeHost({ cacheDir, rootDir: tempDir });
    const probePath = join(hostDir, 'probe.mjs');
    writeFileSync(probePath, [
      "import * as root from '@citadel/app-snake';",
      "import * as client from '@citadel/app-snake/client';",
      "import * as server from '@citadel/app-snake/server';",
      'console.log(JSON.stringify({',
      '  rootKeys: Object.keys(root).sort(),',
      '  clientKeys: Object.keys(client).sort(),',
      '  serverKeys: Object.keys(server).sort(),',
      '  manifestAppId: root.snakeManifest.appId,',
      '  descriptorPackageName: root.snakeAppPackage.packageName,',
      '  clientRegistrationAppId: client.snakeClientRegistration.appId,',
      '  serverRegistrationAppId: server.snakeServerRegistration.appId,',
      '  initialState: server.snakeServerRegistration.createServerApp({',
      '    database: { database: {} }',
      '  }).getInitialState({',
      "    appId: 'snake',",
      "    spaceId: 'arena',",
      '    participants: [],',
      '    emitToSpace() {},',
      '    emitToParticipant() {},',
      '    emitSpaceState() {},',
      '    getAppState() { return undefined; },',
      '    setAppState() {},',
      '    clearAppState() {}',
      '  })',
      '}));'
    ].join('\n'));

    const probe = JSON.parse(execFileSync('node', [probePath], {
      cwd: hostDir,
      encoding: 'utf8'
    })) as {
      rootKeys: string[];
      clientKeys: string[];
      serverKeys: string[];
      manifestAppId: string;
      descriptorPackageName: string;
      clientRegistrationAppId: string;
      serverRegistrationAppId: string;
      initialState: {
        stage: string;
        requiredReadyCount: number;
        readyCount: number;
        spectatorCount: number;
      };
    };

    expect(probe.rootKeys).toEqual(['snakeAppPackage', 'snakeManifest']);
    expect(probe.clientKeys).toEqual(['snakeClientApp', 'snakeClientRegistration']);
    expect(probe.serverKeys).toEqual([
      'createSnakeServerAppFromServices',
      'snakeServerBundle',
      'snakeServerRegistration'
    ]);
    expect(probe.manifestAppId).toBe('snake');
    expect(probe.descriptorPackageName).toBe('@citadel/app-snake');
    expect(probe.clientRegistrationAppId).toBe('snake');
    expect(probe.serverRegistrationAppId).toBe('snake');
    expect(probe.initialState).toMatchObject({
      stage: 'waiting',
      requiredReadyCount: 2,
      readyCount: 0,
      spectatorCount: 0
    });
  });

  it('resolves snake from the packed package manifest shape', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-generator-'));
    const snakePackage = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/apps/snake/package.json'), 'utf8')
    ) as Record<string, unknown>;

    writePackage(tempDir, '@citadel/app-snake', snakePackage);

    const [appPackage] = resolveAppPackages({
      packages: ['@citadel/app-snake']
    }, { rootDir: tempDir });

    expect(appPackage.appId).toBe('snake');
    expect(appPackage.manifest).toEqual({
      appId: 'snake',
      label: 'Snake',
      defaultSpaceId: 'general',
      persistence: 'none',
      version: '0.1.0'
    });
    expect(generateInstalledAppCatalog([appPackage])).toContain(
      "import { snakeClientRegistration as bundledClientRegistration0 } from '@citadel/app-snake/client';"
    );
    expect(generateInstalledAppCatalog([appPackage])).toContain(
      "import { snakeServerRegistration as bundledServerRegistration0 } from '@citadel/app-snake/server';"
    );
  });
});
