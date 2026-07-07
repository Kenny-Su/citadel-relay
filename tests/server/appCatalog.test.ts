import { describe, expect, it } from 'vitest';
import {
  bundledAppDefinitions,
  bundledAppIds,
  bundledAppManifests,
  getBundledAppDefinition,
  getBundledAppManifest,
  orderBundledAppEntries
} from '../../src/bundledApps/catalog.js';

describe('bundled app catalog', () => {
  it('defaults to an empty bundled app catalog', () => {
    expect(bundledAppIds).toEqual([]);
    expect(bundledAppDefinitions).toEqual([]);
    expect(bundledAppManifests).toEqual([]);
  });

  it('returns no bundled manifest for unknown apps', () => {
    expect(getBundledAppDefinition('alpha')).toBeUndefined();
    expect(getBundledAppManifest('alpha')).toBeUndefined();
  });

  it('orders entries by the current bundled catalog order', () => {
    const ordered = orderBundledAppEntries({
      snake: { appId: 'snake', value: 1 }
    });

    expect(ordered).toEqual([]);
  });
});
