import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockSocket, resetMockSocket, triggerSocketEvent } from '../test-utils/render-app';
import { App } from '../../src/client/App';

describe('platform app shell', () => {
  const mockSocket = getMockSocket();
  const allApps = ['chat', 'chess', 'snake'];
  const allAppManifests = [
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
  ];

  function mockEnabledApps(apps = allApps, appManifests: unknown[] | undefined = allAppManifests) {
    const body = appManifests === undefined ? { apps } : { apps, appManifests };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' }
      }))
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
    resetMockSocket();
    mockEnabledApps();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  it('renders the join form and participant panel', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Choose a display name')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Participants' })).toBeInTheDocument();
  });

  it('normalizes root and legacy room routes to the chat app route', async () => {
    window.history.replaceState(null, '', '/rooms/design');

    render(<App />);

    expect(await screen.findByText('#design')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/apps/chat/spaces/design');
    });
  });

  it('switches apps and spaces through neutral routes', async () => {
    window.history.replaceState(null, '', '/apps/chat/spaces/general');

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chess' }));
    fireEvent.change(screen.getByLabelText('Space name'), { target: { value: ' Board ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.getByRole('heading', { name: 'Chess' })).toBeInTheDocument();
    expect(screen.getByText('#board')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/apps/chess/spaces/board');
  });

  it('copies the current space link', async () => {
    window.history.replaceState(null, '', '/apps/snake/spaces/arena');

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'http://localhost:3000/apps/snake/spaces/arena'
      );
    });
    expect(await screen.findByText('Space link copied.')).toBeInTheDocument();
  });

  it('stores the normalized display name and joins the selected platform space', async () => {
    window.history.replaceState(null, '', '/apps/chess/spaces/board');
    window.localStorage.setItem('citadel.guestId', 'stable-grace');
    mockSocket.connected = true;

    render(<App />);
    fireEvent.change(await screen.findByLabelText('Choose a display name'), {
      target: { value: '  Grace   Hopper  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(window.localStorage.getItem('citadel.displayName')).toBe('Grace Hopper');
    expect(mockSocket.emit).toHaveBeenCalledWith('space:join', {
      appId: 'chess',
      guestId: 'stable-grace',
      name: 'Grace Hopper',
      spaceId: 'board'
    });
  });

  it('creates and stores a stable guest id', async () => {
    mockSocket.connected = true;

    render(<App />);
    fireEvent.change(await screen.findByLabelText('Choose a display name'), {
      target: { value: 'Ada' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    const guestId = window.localStorage.getItem('citadel.guestId');
    expect(guestId).toBeTruthy();
    expect(mockSocket.emit).toHaveBeenCalledWith('space:join', {
      appId: 'chat',
      guestId,
      name: 'Ada',
      spaceId: 'general'
    });
  });

  it('renders chat state and emits app events from the chat view', async () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    window.localStorage.setItem('citadel.guestId', 'stable-ada');
    window.history.replaceState(null, '', '/apps/chat/spaces/general');
    mockSocket.connected = true;

    render(<App />);
    await screen.findByRole('heading', { name: 'Chat' });

    act(() => {
      triggerSocketEvent('space:state', {
        appId: 'chat',
        spaceId: 'general',
        participants: [{ id: 'stable-ada', socketId: 'socket-1', name: 'Ada' }],
        appState: {
          messages: [],
          typingParticipants: []
        }
      });
    });

    fireEvent.change(await screen.findByPlaceholderText('Write a message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(mockSocket.emit).toHaveBeenCalledWith('app:event', {
      appId: 'chat',
      type: 'chat:message:send',
      payload: { body: 'hello' }
    });
  });

  it('renders chess and snake app states', async () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    window.localStorage.setItem('citadel.guestId', 'stable-ada');
    window.history.replaceState(null, '', '/apps/chess/spaces/general');
    mockSocket.connected = true;

    render(<App />);
    await screen.findByRole('heading', { name: 'Chess' });
    act(() => {
      triggerSocketEvent('space:state', {
        appId: 'chess',
        spaceId: 'general',
        participants: [{ id: 'stable-ada', socketId: 'socket-1', name: 'Ada' }],
        appState: {
          fen: '8/8/8/8/8/8/8/8 w - - 0 1',
          turn: 'white',
          players: { white: 'stable-ada' },
          status: 'white to move',
          pgn: ''
        }
      });
    });

    expect(screen.getByLabelText('Chess board')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Snake' }));
    act(() => {
      triggerSocketEvent('space:state', {
        appId: 'snake',
        spaceId: 'general',
        participants: [{ id: 'stable-ada', socketId: 'socket-1', name: 'Ada' }],
        appState: {
          width: 20,
          height: 16,
          food: { x: 1, y: 1 },
          snakes: [],
          tick: 0
        }
      });
    });

    expect(screen.getByLabelText('Snake arena')).toBeInTheDocument();
  });

  it('renders only enabled app tabs from runtime config', async () => {
    mockEnabledApps(['chat']);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chess' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snake' })).not.toBeInTheDocument();
  });

  it('renders enabled app tabs from manifest metadata in manifest order', async () => {
    mockEnabledApps(['chat', 'snake'], [
      {
        ...allAppManifests[2],
        label: 'Serpent',
        defaultSpaceId: 'arena'
      },
      {
        ...allAppManifests[0],
        label: 'Messages',
        defaultSpaceId: 'lobby'
      }
    ]);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Serpent' })).toBeInTheDocument();
    const appTabs = within(screen.getByRole('navigation', { name: 'Apps' })).getAllByRole('button');
    expect(appTabs.map((button) => button.textContent)).toEqual(['Serpent', 'Messages']);
    expect(screen.queryByRole('button', { name: 'Chess' })).not.toBeInTheDocument();
  });

  it('uses manifest default space when redirecting from a default route', async () => {
    mockEnabledApps(['snake'], [
      {
        ...allAppManifests[2],
        defaultSpaceId: 'arena'
      }
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Snake' })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/apps/snake/spaces/arena');
    });
  });

  it('falls back to local metadata when manifests are invalid', async () => {
    mockEnabledApps(['chat'], [
      {
        appId: 'chat',
        label: 42,
        defaultSpaceId: 'lobby'
      },
      {
        appId: 'unknown',
        label: 'Unknown',
        defaultSpaceId: 'void'
      }
    ]);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Messages' })).not.toBeInTheDocument();
  });

  it('keeps apps filtering behavior when manifests are absent', async () => {
    mockEnabledApps(['chat', 'snake'], undefined);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snake' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chess' })).not.toBeInTheDocument();
  });

  it('redirects disabled app routes to the first enabled app while preserving space', async () => {
    mockEnabledApps(['chat']);
    window.history.replaceState(null, '', '/apps/chess/spaces/board');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/apps/chat/spaces/board');
    });
  });

  it('redirects legacy rooms to the first enabled app when chat is disabled', async () => {
    mockEnabledApps(['snake']);
    window.history.replaceState(null, '', '/rooms/arena');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Snake' })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/apps/snake/spaces/arena');
    });
  });

  it('does not join before runtime app config loads', async () => {
    let resolveConfig: (response: Response) => void = () => {};
    const config = new Promise<Response>((resolve) => {
      resolveConfig = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(() => config));
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);

    expect(mockSocket.emit).not.toHaveBeenCalledWith('space:join', expect.anything());

    await act(async () => {
      resolveConfig(new Response(JSON.stringify({ apps: allApps })));
      await config;
    });

    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith('space:join', {
        appId: 'chat',
        guestId: expect.any(String),
        name: 'Ada',
        spaceId: 'general'
      });
    });
  });
});
