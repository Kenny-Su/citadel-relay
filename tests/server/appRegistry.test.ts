import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bundledAppManifests,
  bundledServerAppBundles,
  createBundledServerApps,
  filterAppManifests,
  filterServerAppBundles,
  getEnabledAppIds
} from '../../src/bundledApps/serverRegistry.js';
import {
  bundledAppDefinitions,
  bundledAppIds
} from '../../src/bundledApps/catalog.js';
import {
  bundledAppsConfig,
  bundledAppPackageNames,
  parseBundledAppsConfig
} from '../../src/bundledApps/config.js';
import { resolveBundledAppDefinitions } from '../../src/bundledApps/resolver.js';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';

describe('bundled server app registry', () => {
  let tempDir: string;
  let database: CitadelDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-app-registry-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the bundled chat, chess, and snake server modules', () => {
    const apps = createBundledServerApps({ database });

    expect(apps.map((app) => app.appId)).toEqual(['chat', 'chess', 'snake']);
  });

  it('exposes bundled manifests in app order', () => {
    expect(bundledAppsConfig).toEqual({
      packages: [
        '@citadel/app-chat',
        '@citadel/app-chess',
        '@citadel/app-snake'
      ]
    });
    expect(bundledAppPackageNames).toEqual([
      '@citadel/app-chat',
      '@citadel/app-chess',
      '@citadel/app-snake'
    ]);
    expect(bundledAppDefinitions.map((definition) => definition.appId)).toEqual(bundledAppIds);
    expect(bundledAppDefinitions.map((definition) => definition.manifest)).toEqual(bundledAppManifests);
    expect(bundledAppDefinitions.map((definition) => definition.packageName)).toEqual([
      '@citadel/app-chat',
      '@citadel/app-chess',
      '@citadel/app-snake'
    ]);
    expect(bundledAppManifests).toEqual([
      {
        appId: 'chat',
        label: 'Chat',
        defaultSpaceId: 'general',
        persistence: 'sqlite',
        version: '0.1.0'
      },
      {
        appId: 'chess',
        label: 'Chess',
        defaultSpaceId: 'general',
        persistence: 'sqlite',
        version: '0.1.0'
      },
      {
        appId: 'snake',
        label: 'Snake',
        defaultSpaceId: 'general',
        persistence: 'none',
        version: '0.1.0'
      }
    ]);
    expect(bundledAppManifests.map((manifest) => manifest.appId)).toEqual(
      bundledAppIds
    );
    expect(bundledServerAppBundles.map((bundle) => bundle.appId)).toEqual(bundledAppIds);
  });

  it('resolves declarative bundled app package config with validation', () => {
    expect(parseBundledAppsConfig({
      packages: [
        '@citadel/app-chat',
        '@citadel/app-chess',
        '@citadel/app-snake'
      ]
    })).toEqual(bundledAppsConfig);
    expect(() => parseBundledAppsConfig({})).toThrow('Bundled apps config must contain a packages array');
    expect(() => parseBundledAppsConfig({ packages: '@citadel/app-chat' })).toThrow(
      'Bundled apps config packages must be an array'
    );
    expect(() => parseBundledAppsConfig({ packages: ['@citadel/app-chat', 7] })).toThrow(
      'Bundled apps config packages must contain only strings'
    );
    expect(resolveBundledAppDefinitions(bundledAppPackageNames)).toEqual(bundledAppDefinitions);
    expect(resolveBundledAppDefinitions([
      '@citadel/app-snake',
      '@citadel/app-chat'
    ]).map((definition) => definition.appId)).toEqual(['snake', 'chat']);
    expect(() => resolveBundledAppDefinitions([
      '@citadel/app-chat',
      '@citadel/app-chat'
    ])).toThrow('Duplicate bundled app id: chat');
    expect(() => resolveBundledAppDefinitions([
      '@citadel/app-missing'
    ])).toThrow('Unknown bundled app package: @citadel/app-missing');
  });

  it('parses enabled app configuration with defaults and fallback', () => {
    expect(getEnabledAppIds()).toEqual(['chat', 'chess', 'snake']);
    expect(getEnabledAppIds(' chess, chat, chess, unknown, snake ')).toEqual([
      'chess',
      'chat',
      'snake'
    ]);
    expect(getEnabledAppIds('unknown, nope')).toEqual(['chat', 'chess', 'snake']);
  });

  it('filters server app bundles by enabled app ids', () => {
    expect(filterServerAppBundles(['snake', 'chat']).map((bundle) => bundle.appId)).toEqual([
      'snake',
      'chat'
    ]);
  });

  it('filters app manifests by enabled app ids', () => {
    expect(filterAppManifests(['snake', 'chat']).map((manifest) => manifest.appId)).toEqual([
      'snake',
      'chat'
    ]);
  });

  it('creates only enabled server modules', () => {
    const apps = createBundledServerApps({ database, enabledAppIds: ['snake', 'chat'] });

    expect(apps.map((app) => app.appId)).toEqual(['snake', 'chat']);
  });

});
