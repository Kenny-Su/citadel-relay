import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMockSocket } from '../test-utils/render-app';
import { App } from '../../src/client/App';

describe('App shell', () => {
  const mockSocket = getMockSocket();

  beforeEach(() => {
    window.localStorage.clear();
    mockSocket.connected = false;
    mockSocket.connect.mockClear();
    mockSocket.disconnect.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.off.mockClear();
    mockSocket.on.mockClear();
  });

  afterEach(() => {
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
});
