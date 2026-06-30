import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockSocket, resetMockSocket, triggerSocketEvent } from '../test-utils/render-app';
import { App } from '../../src/client/App';

describe('platform app shell', () => {
  const mockSocket = getMockSocket();

  beforeEach(() => {
    window.localStorage.clear();
    resetMockSocket();
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
  });

  it('renders the join form and participant panel', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a display name')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Participants' })).toBeInTheDocument();
  });

  it('normalizes root and legacy room routes to the chat app route', () => {
    window.history.replaceState(null, '', '/rooms/design');

    render(<App />);

    expect(screen.getByText('#design')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/apps/chat/spaces/design');
  });

  it('switches apps and spaces through neutral routes', () => {
    window.history.replaceState(null, '', '/apps/chat/spaces/general');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Chess' }));
    fireEvent.change(screen.getByLabelText('Space name'), { target: { value: ' Board ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.getByRole('heading', { name: 'Chess' })).toBeInTheDocument();
    expect(screen.getByText('#board')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/apps/chess/spaces/board');
  });

  it('copies the current space link', async () => {
    window.history.replaceState(null, '', '/apps/snake/spaces/arena');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'http://localhost:3000/apps/snake/spaces/arena'
      );
    });
    expect(await screen.findByText('Space link copied.')).toBeInTheDocument();
  });

  it('stores the normalized display name and joins the selected platform space', () => {
    window.history.replaceState(null, '', '/apps/chess/spaces/board');
    window.localStorage.setItem('citadel.guestId', 'stable-grace');
    mockSocket.connected = true;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Choose a display name'), {
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

  it('creates and stores a stable guest id', () => {
    mockSocket.connected = true;

    render(<App />);
    fireEvent.change(screen.getByLabelText('Choose a display name'), {
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

  it('renders chat state and emits app events from the chat view', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    window.localStorage.setItem('citadel.guestId', 'stable-ada');
    mockSocket.connected = true;

    render(<App />);

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

    fireEvent.change(screen.getByPlaceholderText('Write a message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(mockSocket.emit).toHaveBeenCalledWith('app:event', {
      appId: 'chat',
      type: 'chat:message:send',
      payload: { body: 'hello' }
    });
  });

  it('renders chess and snake app states', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    window.localStorage.setItem('citadel.guestId', 'stable-ada');
    window.history.replaceState(null, '', '/apps/chess/spaces/general');
    mockSocket.connected = true;

    render(<App />);
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
});
