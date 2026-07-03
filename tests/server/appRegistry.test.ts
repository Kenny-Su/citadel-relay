import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { openCitadelDatabase, type CitadelDatabase } from '@citadel-platform/platform/persistence';

type BundledAppsConfig = {
  packages: string[];
};

function bundledAppsConfig() {
  return JSON.parse(readFileSync(join(process.cwd(), 'bundled-apps.json'), 'utf8')) as BundledAppsConfig;
}

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

  it('creates no server modules for the empty default host', () => {
    const apps = createBundledServerApps({ database });

    expect(apps).toEqual([]);
  });

  it('exposes empty bundled manifests in app order', () => {
    expect(bundledAppsConfig()).toEqual({ packages: [] });
    expect(bundledAppDefinitions).toEqual([]);
    expect(bundledAppIds).toEqual([]);
    expect(bundledAppManifests).toEqual([]);
    expect(bundledServerAppBundles).toEqual([]);
  });

  it('parses enabled app configuration against the empty installed catalog', () => {
    expect(getEnabledAppIds()).toEqual([]);
    expect(getEnabledAppIds('alpha, beta')).toEqual([]);
  });

  it('filters server app bundles and manifests by enabled app ids', () => {
    expect(filterServerAppBundles(['alpha'])).toEqual([]);
    expect(filterAppManifests(['alpha'])).toEqual([]);
    expect(createBundledServerApps({ database, enabledAppIds: ['alpha'] })).toEqual([]);
  });
});
