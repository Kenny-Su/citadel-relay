import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockSocket, resetMockSocket } from '../test-utils/render-app';
import { App } from '../../src/client/App';

describe('platform app shell', () => {
  const mockSocket = getMockSocket();

  function mockConfig(body: unknown = { apps: [], appManifests: [] }) {
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
    mockConfig();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  it('renders an empty host state when no apps are installed', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'No apps installed' })).toBeInTheDocument();
    expect(screen.getByText('Install an app package, add it to bundled-apps.json, then regenerate the app catalog.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a display name')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Apps' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Participants' })).toBeInTheDocument();
  });

  it('normalizes legacy and app routes to the empty host root', async () => {
    window.history.replaceState(null, '', '/rooms/design');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'No apps installed' })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
  });

  it('does not connect or join a socket without an installed app', async () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    window.localStorage.setItem('citadel.guestId', 'stable-ada');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'No apps installed' })).toBeInTheDocument();
    expect(mockSocket.connect).not.toHaveBeenCalled();
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('falls back to the empty host state when config cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('config unavailable');
    }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'No apps installed' })).toBeInTheDocument();
    expect(mockSocket.connect).not.toHaveBeenCalled();
  });
});
