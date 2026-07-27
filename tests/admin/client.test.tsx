// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/admin/client/App.js';

const SESSION = {
  csrfToken: 'csrf-token-42',
  expiresAt: '2099-01-01T12:00:00.000Z'
};

const CHAT_APP = {
  appId: 'chat',
  connected: true,
  clients: 7,
  pendingClients: 2,
  createdAt: '2026-07-20T09:00:00.000Z',
  updatedAt: '2026-07-27T08:30:00.000Z'
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function signIn(apps: unknown[] = []) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Admin passphrase'), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Sign in to relay' }));
  await screen.findByRole('heading', { name: 'Applications' });
  if (apps.length === 0) {
    await screen.findByRole('heading', { name: 'No apps registered' });
  }
  return user;
}

describe('relay admin client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('authenticates before loading registrations and renders app status', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' }
      }, 401))
      .mockResolvedValueOnce(json(SESSION))
      .mockResolvedValueOnce(json([CHAT_APP]));

    render(<App />);
    await signIn([CHAT_APP]);

    expect(screen.getByText('chat')).toBeTruthy();
    expect(screen.getAllByText('Online')).toHaveLength(2);
    expect(screen.getAllByText('7')).toHaveLength(2);
    expect(screen.getByText('2')).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/admin/api/session',
      expect.objectContaining({
        credentials: 'same-origin'
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/admin/api/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin'
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/admin/api/apps',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });

  it('creates an app with CSRF protection and reveals its key once', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' }
      }, 401))
      .mockResolvedValueOnce(json(SESSION))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({
        app: { ...CHAT_APP, appId: 'customer-portal', connected: false, clients: 0, pendingClients: 0 },
        preSharedKey: 'a'.repeat(64)
      }));

    render(<App />);
    const user = await signIn();
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    await user.type(screen.getByLabelText('App ID'), 'customer-portal');
    await user.click(screen.getByRole('button', { name: 'Create registration' }));

    expect(await screen.findByRole('heading', { name: 'Save this pre-shared key' })).toBeTruthy();
    expect(screen.getByText('a'.repeat(64))).toBeTruthy();

    const request = fetchMock.mock.calls[3];
    expect(request[0]).toBe('/admin/api/apps');
    expect(request[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ appId: 'customer-portal' })
    }));
    const headers = new Headers(request[1]?.headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token-42');

    await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
    expect(screen.queryByText('a'.repeat(64))).toBeNull();
    expect(screen.getByText('customer-portal')).toBeTruthy();
  });

  it('requires confirmation to rotate and delete registrations', async () => {
    const rotated = {
      ...CHAT_APP,
      connected: false,
      clients: 0,
      pendingClients: 0,
      updatedAt: '2026-07-27T10:00:00.000Z'
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' }
      }, 401))
      .mockResolvedValueOnce(json(SESSION))
      .mockResolvedValueOnce(json([CHAT_APP]))
      .mockResolvedValueOnce(json({
        app: rotated,
        preSharedKey: 'b'.repeat(64)
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<App />);
    const user = await signIn([CHAT_APP]);

    await user.click(screen.getByRole('button', { name: 'Rotate key for chat' }));
    expect(screen.getByRole('heading', { name: 'Rotate chat’s key?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rotate key' }));
    expect(await screen.findByText('b'.repeat(64))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));

    await user.click(screen.getByRole('button', { name: 'Delete chat' }));
    expect(screen.getByRole('heading', { name: 'Delete chat?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete app' }));

    await waitFor(() => {
      expect(screen.queryByText('chat')).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'No apps registered' })).toBeTruthy();

    const rotateHeaders = new Headers(fetchMock.mock.calls[3][1]?.headers);
    const deleteHeaders = new Headers(fetchMock.mock.calls[4][1]?.headers);
    expect(rotateHeaders.get('X-CSRF-Token')).toBe('csrf-token-42');
    expect(deleteHeaders.get('X-CSRF-Token')).toBe('csrf-token-42');
  });

  it('surfaces login errors without exposing the applications view', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' }
      }, 401))
      .mockResolvedValueOnce(json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid passphrase.' }
      }, 401));

    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Admin passphrase'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in to relay' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid passphrase.');
    expect(screen.queryByRole('heading', { name: 'Applications' })).toBeNull();
  });

  it('restores an existing browser session without asking for the passphrase again', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json(SESSION))
      .mockResolvedValueOnce(json([CHAT_APP]));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeTruthy();
    expect(screen.getByText('chat')).toBeTruthy();
    expect(screen.queryByLabelText('Admin passphrase')).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/admin/api/session',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });
});
