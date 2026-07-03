import React from 'react';
import { describe, expect, it } from 'vitest';
import type { ClientAppRegistration } from '@citadel-platform/platform/client';
import {
  allClientApps,
  appById,
  createClientAppRegistry,
  createClientAppsFromManifests,
  filterClientApps
} from '../../src/client/appRegistry';

function View() {
  return React.createElement('div', null, 'Fixture app');
}

const fixtureRegistrations = [
  {
    appId: 'alpha',
    clientApp: {
      appId: 'alpha',
      label: 'Alpha',
      defaultSpaceId: 'alpha-room',
      View
    }
  },
  {
    appId: 'beta',
    clientApp: {
      appId: 'beta',
      label: 'Beta',
      defaultSpaceId: 'beta-room',
      View
    }
  }
] satisfies ClientAppRegistration<unknown>[];

describe('client app registry', () => {
  it('defaults to an empty host app catalog', () => {
    expect(allClientApps).toEqual([]);
    expect([...appById.keys()]).toEqual([]);
    expect(filterClientApps(['alpha'])).toEqual([]);
    expect(createClientAppsFromManifests([
      { appId: 'alpha', label: 'Alpha from server', defaultSpaceId: 'server-room' }
    ])).toBeNull();
  });

  it('filters fixture client apps by enabled app ids', () => {
    const registry = createClientAppRegistry(fixtureRegistrations);

    expect(registry.filterClientApps(['beta', 'unknown']).map((app) => app.appId)).toEqual(['beta']);
    expect(registry.filterClientApps(['unknown']).map((app) => app.appId)).toEqual(['alpha', 'beta']);
  });

  it('creates fixture client apps from server manifests using local views', () => {
    const registry = createClientAppRegistry(fixtureRegistrations);
    const apps = registry.createClientAppsFromManifests([
      { appId: 'beta', label: 'Beta from server', defaultSpaceId: 'server-beta' },
      { appId: 'unknown', label: 'Unknown', defaultSpaceId: 'unknown' },
      { appId: 'alpha', label: 'Alpha from server', defaultSpaceId: 'server-alpha' },
      { appId: 'alpha', label: 'Duplicate Alpha', defaultSpaceId: 'duplicate' }
    ], ['alpha', 'beta']);

    expect(apps?.map((app) => ({
      appId: app.appId,
      label: app.label,
      defaultSpaceId: app.defaultSpaceId
    }))).toEqual([
      { appId: 'beta', label: 'Beta from server', defaultSpaceId: 'server-beta' },
      { appId: 'alpha', label: 'Alpha from server', defaultSpaceId: 'server-alpha' }
    ]);
    expect(apps?.[0]?.View).toBe(View);
    expect(apps?.[1]?.View).toBe(View);
  });

  it('returns null when manifest input cannot produce local client apps', () => {
    const registry = createClientAppRegistry(fixtureRegistrations);

    expect(registry.createClientAppsFromManifests(null)).toBeNull();
    expect(registry.createClientAppsFromManifests([
      { appId: 'unknown', label: 'Unknown', defaultSpaceId: 'unknown' }
    ])).toBeNull();
  });
});
