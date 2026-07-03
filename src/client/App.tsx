import React from 'react';
import { io } from 'socket.io-client';
import {
  DEFAULT_SPACE_ID,
  DISPLAY_NAME_MAX_LENGTH,
  type AppEventEnvelope,
  type AppId,
  type Participant,
  type PlatformErrorPayload,
  type SpaceState,
  isAppId,
  normalizeSpaceId
} from '@citadel-platform/platform/app';
import {
  clientApps,
  createClientAppsFromManifests,
  filterClientApps,
  appById,
  isKnownAppEvent,
  type ClientAppModule
} from './appRegistry';

const socket = io({
  autoConnect: false
});

const DISPLAY_NAME_STORAGE_KEY = 'citadel.displayName';
const GUEST_ID_STORAGE_KEY = 'citadel.guestId';

type RouteState = {
  appId: AppId;
  spaceId: string;
};

type ClientConfig = {
  apps?: unknown;
  appManifests?: unknown;
};

function parseRoute(): RouteState {
  const [, first, second, third, fourth] = window.location.pathname.split('/');

  if (first === 'rooms') {
    return { appId: '', spaceId: normalizeSpaceId(second) };
  }

  if (first === 'apps' && third === 'spaces' && isAppId(second)) {
    return { appId: second, spaceId: normalizeSpaceId(fourth) };
  }

  return { appId: '', spaceId: DEFAULT_SPACE_ID };
}

function getSpacePath(appId: AppId, spaceId: string) {
  if (!appId) {
    return '/';
  }

  return `/apps/${appId}/spaces/${spaceId}`;
}

function getSpaceUrl(appId: AppId, spaceId: string) {
  return `${window.location.origin}${getSpacePath(appId, spaceId)}`;
}

function syncSpacePath(route: RouteState, mode: 'push' | 'replace' = 'push') {
  const path = getSpacePath(route.appId, route.spaceId);

  if (window.location.pathname === path) {
    return;
  }

  window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', path);
}

function normalizeRouteForApps(route: RouteState, apps: ClientAppModule<any>[]): RouteState {
  const fallbackApp = apps[0];

  if (!fallbackApp) {
    return {
      appId: '',
      spaceId: route.spaceId || DEFAULT_SPACE_ID
    };
  }

  const fallbackAppId = fallbackApp?.appId ?? '';

  if (apps.some((app) => app.appId === route.appId)) {
    return route;
  }

  return {
    appId: fallbackAppId,
    spaceId: route.spaceId === DEFAULT_SPACE_ID ? (fallbackApp?.defaultSpaceId ?? DEFAULT_SPACE_ID) : route.spaceId
  };
}

function getConfigAppIds(config: ClientConfig): AppId[] {
  if (!Array.isArray(config.apps)) {
    return clientApps.map((app) => app.appId);
  }

  const appIds: AppId[] = [];
  const seen = new Set<AppId>();

  for (const appId of config.apps) {
    if (!isAppId(appId) || !appById.has(appId) || seen.has(appId)) {
      continue;
    }

    appIds.push(appId);
    seen.add(appId);
  }

  return appIds.length > 0 ? appIds : clientApps.map((app) => app.appId);
}

function normalizeDisplayName(input: unknown) {
  if (typeof input !== 'string') {
    return null;
  }

  const value = input.trim().replace(/\s+/g, ' ');

  if (!value || value.length > DISPLAY_NAME_MAX_LENGTH) {
    return null;
  }

  return value;
}

function loadStoredDisplayName() {
  try {
    const value = normalizeDisplayName(window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY));

    if (!value) {
      window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
      return '';
    }

    return value;
  } catch {
    return '';
  }
}

function createGuestId() {
  if (typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `guest-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function loadStoredGuestId() {
  try {
    const storedGuestId = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);

    if (storedGuestId) {
      return storedGuestId;
    }

    const guestId = createGuestId();
    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, guestId);
    return guestId;
  } catch {
    return createGuestId();
  }
}

function saveStoredDisplayName(name: string) {
  try {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function clearStoredDisplayName() {
  try {
    window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command failed');
    }
  } finally {
    textarea.remove();
  }
}

export function App() {
  const initialDisplayName = React.useMemo(() => loadStoredDisplayName(), []);
  const guestId = React.useMemo(() => loadStoredGuestId(), []);
  const [availableApps, setAvailableApps] = React.useState<ClientAppModule<any>[] | null>(null);
  const [route, setRoute] = React.useState(parseRoute);
  const [spaceDraft, setSpaceDraft] = React.useState(route.spaceId);
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [joinedName, setJoinedName] = React.useState(initialDisplayName);
  const [connected, setConnected] = React.useState(false);
  const [participants, setParticipants] = React.useState<Participant[]>([]);
  const [appState, setAppState] = React.useState<unknown>(null);
  const [notice, setNotice] = React.useState('');

  const visibleApps = availableApps ?? [];
  const currentApp = visibleApps.find((app) => app.appId === route.appId) ?? visibleApps[0] ?? clientApps[0];
  const hasCurrentApp = Boolean(currentApp);
  const currentParticipant = participants.find((participant) => participant.id === guestId) ?? {
    id: guestId,
    socketId: socket.id,
    name: joinedName
  };

  React.useEffect(() => {
    function handlePopState() {
      setRoute(parseRoute());
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  React.useEffect(() => {
    let active = true;

    async function loadConfig() {
      try {
        const response = await fetch('/config');
        const config = (await response.json()) as ClientConfig;
        const appIds = getConfigAppIds(config);
        const apps = createClientAppsFromManifests(config.appManifests, appIds) ?? filterClientApps(appIds);

        if (!active) {
          return;
        }

        setAvailableApps(apps);
        setRoute((currentRoute) => {
          const nextRoute = normalizeRouteForApps(currentRoute, apps);
          syncSpacePath(nextRoute, 'replace');
          return nextRoute;
        });
      } catch {
        if (!active) {
          return;
        }

        setAvailableApps(clientApps);
        setRoute((currentRoute) => {
          const nextRoute = normalizeRouteForApps(currentRoute, clientApps);
          syncSpacePath(nextRoute, 'replace');
          return nextRoute;
        });
      }
    }

    void loadConfig();

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!availableApps) {
      return;
    }

    const nextRoute = normalizeRouteForApps(route, availableApps);

    if (nextRoute.appId === route.appId && nextRoute.spaceId === route.spaceId) {
      return;
    }

    setRoute(nextRoute);
    syncSpacePath(nextRoute, 'replace');
  }, [availableApps, route]);

  React.useEffect(() => {
    setSpaceDraft(route.spaceId);
    setParticipants([]);
    setAppState(null);
  }, [route.appId, route.spaceId]);

  React.useEffect(() => {
    function handleConnect() {
      setConnected(true);
      setNotice('');
    }

    function handleDisconnect() {
      setConnected(false);
      setNotice('Connection lost. Reconnecting...');
    }

    function handleSpaceState(state: SpaceState) {
      if (state.appId !== route.appId || state.spaceId !== route.spaceId) {
        return;
      }

      setParticipants(state.participants);
      setAppState(state.appState);
    }

    function handleError(payload: PlatformErrorPayload) {
      setNotice(payload.message);
    }

    function handleAppEvent(event: AppEventEnvelope) {
      if (!isKnownAppEvent(event) || event.appId !== route.appId) {
        return;
      }

      window.dispatchEvent(new CustomEvent('citadel:app-event', { detail: event }));
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('space:state', handleSpaceState);
    socket.on('error:notice', handleError);
    socket.on('app:event', handleAppEvent);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('space:state', handleSpaceState);
      socket.off('error:notice', handleError);
      socket.off('app:event', handleAppEvent);
    };
  }, [route.appId, route.spaceId]);

  React.useEffect(() => {
    if (!availableApps) {
      return;
    }

    if (!currentApp || !joinedName) {
      return;
    }

    if (!socket.connected) {
      socket.connect();
      return;
    }

    socket.emit('space:join', {
      appId: route.appId,
      guestId,
      name: joinedName,
      spaceId: route.spaceId
    });
  }, [availableApps, connected, currentApp, guestId, joinedName, route.appId, route.spaceId]);

  function joinSpace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = normalizeDisplayName(displayName);

    if (!name) {
      setNotice('Enter a display name.');
      return;
    }

    setDisplayName(name);
    setJoinedName(name);
    saveStoredDisplayName(name);
    setNotice('');
  }

  function changeIdentity() {
    const previousName = joinedName;

    clearStoredDisplayName();
    setJoinedName('');
    setDisplayName(previousName);
    setParticipants([]);
    setAppState(null);
    setConnected(false);
    socket.disconnect();
  }

  function switchSpace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextRoute = {
      appId: currentApp?.appId ?? route.appId,
      spaceId: normalizeSpaceId(spaceDraft)
    };

    setNotice('');
    setRoute(nextRoute);
    syncSpacePath(nextRoute);
  }

  function switchApp(appId: AppId) {
    const nextApp = visibleApps.find((app) => app.appId === appId);

    if (!nextApp) {
      return;
    }

    const nextRoute = {
      appId,
      spaceId: route.spaceId || nextApp.defaultSpaceId || DEFAULT_SPACE_ID
    };

    setNotice('');
    setParticipants([]);
    setAppState(null);
    setRoute(nextRoute);
    syncSpacePath(nextRoute);
  }

  async function copySpaceLink() {
    if (!currentApp) {
      return;
    }

    try {
      await copyText(getSpaceUrl(route.appId, route.spaceId));
      setNotice('Space link copied.');
    } catch {
      setNotice('Could not copy the space link.');
    }
  }

  function sendAppEvent(type: string, payload?: unknown) {
    if (!currentApp) {
      return;
    }

    socket.emit('app:event', {
      appId: route.appId,
      type,
      payload
    });
  }

  const AppView = currentApp?.View as React.ComponentType<any> | undefined;

  return (
    <main className="app-shell">
      <section className="workspace-panel" aria-label={currentApp ? `${currentApp.label} space` : 'Citadel host'}>
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Citadel Host</p>
            <h1>{currentApp?.label ?? 'No apps installed'}</h1>
            <p className="space-label">#{route.spaceId}</p>
          </div>
          <div className="header-actions">
            {hasCurrentApp ? (
              <>
                <nav className="app-tabs" aria-label="Apps">
                  {visibleApps.map((app) => (
                    <button
                      className={app.appId === route.appId ? 'active' : ''}
                      key={app.appId}
                      type="button"
                      onClick={() => switchApp(app.appId)}
                    >
                      {app.label}
                    </button>
                  ))}
                </nav>
                <form className="space-switcher" onSubmit={switchSpace}>
                  <label className="sr-only" htmlFor="spaceName">
                    Space name
                  </label>
                  <input
                    id="spaceName"
                    value={spaceDraft}
                    maxLength={32}
                    onChange={(event) => setSpaceDraft(event.target.value)}
                    placeholder="general"
                  />
                  <button type="submit">Go</button>
                </form>
                <button className="copy-link-button" type="button" onClick={copySpaceLink}>
                  Copy link
                </button>
                <div className={connected ? 'status online' : 'status'}>
                  <span aria-hidden="true" />
                  {connected ? 'Online' : 'Offline'}
                </div>
              </>
            ) : null}
          </div>
        </header>

        {!availableApps ? (
          <div className="empty-state">Loading apps...</div>
        ) : !currentApp || !AppView ? (
          <div className="empty-state empty-host-state">
            <strong>No apps installed.</strong>
            <span>Install an app package, add it to bundled-apps.json, then regenerate the app catalog.</span>
          </div>
        ) : !joinedName ? (
          <form className="join-card" onSubmit={joinSpace}>
            <label htmlFor="displayName">Choose a display name</label>
            <div className="join-row">
              <input
                id="displayName"
                value={displayName}
                maxLength={24}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="nickname"
              />
              <button type="submit">Join</button>
            </div>
          </form>
        ) : (
          <>
            <div className="identity-bar">
              <span>
                Participating as <strong>{joinedName}</strong>
              </span>
              <button type="button" onClick={changeIdentity}>
                Change
              </button>
            </div>
            {appState ? (
              <AppView
                currentParticipant={currentParticipant}
                spaceId={route.spaceId}
                participants={participants}
                appState={appState}
                sendAppEvent={sendAppEvent}
                setNotice={setNotice}
              />
            ) : (
              <div className="empty-state">Joining space...</div>
            )}
          </>
        )}

        {notice ? <p className="notice">{notice}</p> : null}
      </section>

      <aside className="presence-panel" aria-label="Participants">
        <div>
          <p className="eyebrow">Presence</p>
          <h2>{participants.length} online</h2>
        </div>
        {participants.length === 0 ? (
          <p className="muted">No participants yet.</p>
        ) : (
          <ul className="participant-list">
            {participants.map((participant) => (
              <li key={participant.socketId ?? participant.id}>
                <span aria-hidden="true">{participant.name.slice(0, 1).toUpperCase()}</span>
                {participant.name}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}
