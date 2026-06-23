import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockSocket, resetMockSocket, triggerSocketEvent } from '../test-utils/render-app';
import { App } from '../../src/client/App';

describe('App shell', () => {
  const mockSocket = getMockSocket();

  beforeEach(() => {
    window.localStorage.clear();
    resetMockSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('renders the join form and presence panel', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Citadel Chat' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a display name')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Online users' })).toBeInTheDocument();
  });

  it('normalizes root to the default room', () => {
    window.history.replaceState(null, '', '/');

    render(<App />);

    expect(screen.getByText('#general')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/rooms/general');
  });

  it('renders a room from the URL', () => {
    window.history.replaceState(null, '', '/rooms/design');

    render(<App />);

    expect(screen.getByText('#design')).toBeInTheDocument();
  });

  it('normalizes room switcher input and updates the URL', () => {
    window.history.replaceState(null, '', '/rooms/general');

    render(<App />);
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: ' Design ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.getByText('#design')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/rooms/design');
  });

  it('uses a valid saved display name to enter the chat view', () => {
    window.localStorage.setItem('citadel.displayName', '  Ada   Lovelace  ');

    render(<App />);

    expect(screen.queryByLabelText('Choose a display name')).not.toBeInTheDocument();
    expect(screen.getByText('Chatting as')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('removes invalid stored display names and keeps the join form visible', () => {
    window.localStorage.setItem('citadel.displayName', 'x'.repeat(25));

    render(<App />);

    expect(screen.getByLabelText('Choose a display name')).toBeInTheDocument();
    expect(window.localStorage.getItem('citadel.displayName')).toBeNull();
    expect(mockSocket.connect).not.toHaveBeenCalled();
  });

  it('stores the normalized display name when joining', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Choose a display name'), {
      target: { value: '  Grace   Hopper  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(window.localStorage.getItem('citadel.displayName')).toBe('Grace Hopper');
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('lets a joined guest change and replace the saved display name', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    expect(window.localStorage.getItem('citadel.displayName')).toBeNull();
    expect(screen.getByLabelText('Choose a display name')).toHaveValue('Ada');
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Choose a display name'), {
      target: { value: 'Grace' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(window.localStorage.getItem('citadel.displayName')).toBe('Grace');
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  it('auto-joins the current room with a saved display name when connected', () => {
    window.history.replaceState(null, '', '/rooms/design');
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);

    expect(mockSocket.emit).toHaveBeenCalledWith('join', { name: 'Ada', roomId: 'design' });
  });

  it('emits typing start and idle stop while composing', () => {
    vi.useFakeTimers();
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Write a message'), { target: { value: 'h' } });

    expect(mockSocket.emit).toHaveBeenCalledWith('typing:start');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('typing:stop');
  });

  it('emits typing stop when a message sends', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);
    act(() => {
      triggerSocketEvent('connect');
    });
    fireEvent.change(screen.getByPlaceholderText('Write a message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(mockSocket.emit).toHaveBeenCalledWith('typing:stop');
    expect(mockSocket.emit).toHaveBeenCalledWith('message:send', { body: 'hello' });
  });

  it('sends the current message when Enter is pressed in the composer', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);
    act(() => {
      triggerSocketEvent('connect');
    });
    fireEvent.change(screen.getByPlaceholderText('Write a message'), { target: { value: 'hello' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Write a message'), {
      key: 'Enter',
      code: 'Enter',
      charCode: 13
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('message:send', { body: 'hello' });
    expect(screen.getByPlaceholderText('Write a message')).toHaveValue('');
  });

  it('keeps composing when Shift+Enter is pressed in the composer', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);
    act(() => {
      triggerSocketEvent('connect');
    });
    fireEvent.change(screen.getByPlaceholderText('Write a message'), { target: { value: 'hello' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Write a message'), {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
      shiftKey: true
    });

    expect(mockSocket.emit).not.toHaveBeenCalledWith('message:send', { body: 'hello' });
    expect(screen.getByPlaceholderText('Write a message')).toHaveValue('hello');
  });

  it('renders incoming typing update copy without the current user', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);

    act(() => {
      triggerSocketEvent('typing:update', {
        roomId: 'general',
        users: [
          { id: 'ada', name: 'Ada' },
          { id: 'grace', name: 'Grace' },
          { id: 'linus', name: 'Linus' },
          { id: 'margaret', name: 'Margaret' }
        ]
      });
    });

    expect(screen.getByText('Grace, Linus, and 1 other are typing...')).toBeInTheDocument();
  });

  it('clears typing indicators on room changes', () => {
    window.localStorage.setItem('citadel.displayName', 'Ada');
    mockSocket.connected = true;

    render(<App />);

    act(() => {
      triggerSocketEvent('typing:update', {
        roomId: 'general',
        users: [{ id: 'grace', name: 'Grace' }]
      });
    });

    expect(screen.getByText('Grace is typing...')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'design' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.queryByText('Grace is typing...')).not.toBeInTheDocument();
    expect(mockSocket.emit).toHaveBeenCalledWith('typing:stop');
  });
});
