import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountAdminApi, type AdminRuntime } from '../../src/admin/adminApi.js';
import { RegistrationStore } from '../../src/admin/registrationStore.js';

const PASSPHRASE = 'a-correct-horse-passphrase';

function listen(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';', 1)[0];
}

describe('admin API', () => {
  let server: HttpServer;
  let store: RegistrationStore;
  let url: string;
  let currentTime: number;
  let disconnectedApps: string[];

  beforeEach(async () => {
    const app = express();
    app.set('trust proxy', 1);
    store = new RegistrationStore({ databasePath: ':memory:' });
    currentTime = Date.parse('2026-07-27T00:00:00.000Z');
    disconnectedApps = [];
    const runtime: AdminRuntime = {
      getAppStatus(appId) {
        return {
          appId,
          connected: appId === 'connected-app',
          clients: appId === 'connected-app' ? 3 : 0,
          pendingClients: appId === 'connected-app' ? 1 : 0
        };
      },
      disconnectApp(appId) {
        disconnectedApps.push(appId);
        return appId === 'connected-app';
      }
    };
    mountAdminApi(app, {
      passphrase: PASSPHRASE,
      registrationStore: store,
      runtime,
      secureCookies: false,
      now: () => currentTime,
      sessionTtlMilliseconds: 1_000
    });
    server = createServer(app);
    await listen(server);
    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  async function login(passphrase = PASSPHRASE, forwardedFor?: string) {
    const response = await fetch(`${url}/admin/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: url,
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {})
      },
      body: JSON.stringify({ passphrase })
    });
    const body = await response.json() as {
      csrfToken?: string;
      expiresAt?: string;
      error?: { code: string; message: string };
    };
    return {
      response,
      body,
      cookie: cookieFrom(response)
    };
  }

  function protectedHeaders(cookie: string, csrfToken?: string) {
    return {
      Cookie: cookie,
      Origin: url,
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    };
  }

  it('creates a protected eight-hour-style session without exposing the passphrase', async () => {
    const failed = await login('this-passphrase-is-wrong');
    expect(failed.response.status).toBe(401);
    expect(JSON.stringify(failed.body)).not.toContain('this-passphrase-is-wrong');

    const authenticated = await login();
    expect(authenticated.response.status).toBe(200);
    expect(authenticated.body.csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authenticated.body.expiresAt).toBe('2026-07-27T00:00:01.000Z');
    expect(authenticated.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(authenticated.response.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(authenticated.response.headers.get('cache-control')).toBe('no-store');
    expect(authenticated.response.headers.get('x-frame-options')).toBe('DENY');

    const session = await fetch(`${url}/admin/api/session`, {
      headers: { Cookie: authenticated.cookie }
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual(authenticated.body);

    currentTime += 1_001;
    const expired = await fetch(`${url}/admin/api/apps`, {
      headers: { Cookie: authenticated.cookie }
    });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('requires same-origin and CSRF protection for mutations', async () => {
    const authenticated = await login();
    const cookie = authenticated.cookie;
    const csrfToken = authenticated.body.csrfToken as string;

    const crossOrigin = await fetch(`${url}/admin/api/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://attacker.example'
      },
      body: JSON.stringify({ appId: 'chat' })
    });
    expect(crossOrigin.status).toBe(403);

    const missingCsrf = await fetch(`${url}/admin/api/apps`, {
      method: 'POST',
      headers: {
        ...protectedHeaders(cookie),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ appId: 'chat' })
    });
    expect(missingCsrf.status).toBe(403);

    const accepted = await fetch(`${url}/admin/api/apps`, {
      method: 'POST',
      headers: {
        ...protectedHeaders(cookie, csrfToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ appId: 'chat' })
    });
    expect(accepted.status).toBe(201);
  });

  it('manages registrations without returning stored credentials in lists', async () => {
    const authenticated = await login();
    const cookie = authenticated.cookie;
    const csrfToken = authenticated.body.csrfToken as string;

    const createdResponse = await fetch(`${url}/admin/api/apps`, {
      method: 'POST',
      headers: {
        ...protectedHeaders(cookie, csrfToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ appId: 'connected-app' })
    });
    const created = await createdResponse.json() as {
      app: {
        appId: string;
        connected: boolean;
        clients: number;
        pendingClients: number;
        createdAt: string;
        updatedAt: string;
      };
      preSharedKey: string;
    };
    expect(createdResponse.status).toBe(201);
    expect(created.app).toMatchObject({
      appId: 'connected-app',
      connected: true,
      clients: 3,
      pendingClients: 1
    });
    expect(created.preSharedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(store.authenticate(created.preSharedKey)).toEqual({ appId: 'connected-app' });

    const listResponse = await fetch(`${url}/admin/api/apps`, {
      headers: { Cookie: cookie }
    });
    const listText = await listResponse.text();
    expect(listResponse.status).toBe(200);
    expect(listText).not.toContain(created.preSharedKey);
    expect(listText).not.toContain('digest');
    expect(JSON.parse(listText)).toEqual([created.app]);

    const duplicate = await fetch(`${url}/admin/api/apps`, {
      method: 'POST',
      headers: {
        ...protectedHeaders(cookie, csrfToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ appId: 'connected-app' })
    });
    expect(duplicate.status).toBe(409);

    const rotatedResponse = await fetch(
      `${url}/admin/api/apps/connected-app/rotate-key`,
      {
        method: 'POST',
        headers: protectedHeaders(cookie, csrfToken)
      }
    );
    const rotated = await rotatedResponse.json() as {
      app: { appId: string };
      preSharedKey: string;
    };
    expect(rotatedResponse.status).toBe(200);
    expect(rotated.preSharedKey).not.toBe(created.preSharedKey);
    expect(store.authenticate(created.preSharedKey)).toBeNull();
    expect(store.authenticate(rotated.preSharedKey)).toEqual({ appId: 'connected-app' });
    expect(disconnectedApps).toEqual(['connected-app']);

    const deleted = await fetch(`${url}/admin/api/apps/connected-app`, {
      method: 'DELETE',
      headers: protectedHeaders(cookie, csrfToken)
    });
    expect(deleted.status).toBe(204);
    expect(store.list()).toEqual([]);
    expect(disconnectedApps).toEqual(['connected-app', 'connected-app']);
  });

  it('logs out, rejects unknown routes, and rate-limits repeated failures', async () => {
    const authenticated = await login();
    const csrfToken = authenticated.body.csrfToken as string;
    const logout = await fetch(`${url}/admin/api/session`, {
      method: 'DELETE',
      headers: protectedHeaders(authenticated.cookie, csrfToken)
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

    const afterLogout = await fetch(`${url}/admin/api/apps`, {
      headers: { Cookie: authenticated.cookie }
    });
    expect(afterLogout.status).toBe(401);

    const anotherSession = await login();
    const unknown = await fetch(`${url}/admin/api/missing`, {
      headers: { Cookie: anotherSession.cookie }
    });
    expect(unknown.status).toBe(404);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await login('still-the-wrong-passphrase', '203.0.113.10')).response.status
      ).toBe(401);
    }
    const limited = await login('still-the-wrong-passphrase', '203.0.113.10');
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get('retry-after')).toBe('900');

    expect((await login(PASSPHRASE, '203.0.113.11')).response.status).toBe(200);
  });
});
