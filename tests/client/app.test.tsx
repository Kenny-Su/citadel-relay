import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../test-utils/render-app';
import { App } from '../../src/client/App';

describe('App shell', () => {
  afterEach(() => {
    cleanup();
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
});
