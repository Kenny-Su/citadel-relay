import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { mountAdminFrontend } from '../../src/admin/staticAdmin.js';

function listen(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

describe('admin frontend serving', () => {
  let server: HttpServer | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory) rmSync(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it('serves assets and admin deep links without swallowing other routes', async () => {
    directory = mkdtempSync(join(tmpdir(), 'citadel-admin-static-'));
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<main>Citadel Admin</main>');
    writeFileSync(join(directory, 'assets', 'app.js'), 'console.log("admin")');

    const app = express();
    app.get('/health', (_request, response) => response.json({ ok: true }));
    app.get('/admin/api/probe', (_request, response) => response.json({ api: true }));
    expect(mountAdminFrontend(app, directory)).toBe(true);
    server = createServer(app);
    await listen(server);
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;

    const redirect = await fetch(`${url}/admin`, { redirect: 'manual' });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/admin/');

    const deepLink = await fetch(`${url}/admin/apps/chat`);
    expect(await deepLink.text()).toContain('Citadel Admin');
    expect(deepLink.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'"
    );

    const asset = await fetch(`${url}/admin/assets/app.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');

    const missingAsset = await fetch(`${url}/admin/assets/missing.js`);
    expect(missingAsset.status).toBe(404);
    expect(await missingAsset.text()).not.toContain('Citadel Admin');

    expect(await fetch(`${url}/health`).then((response) => response.json())).toEqual({
      ok: true
    });
    expect(await fetch(`${url}/admin/api/probe`).then((response) => response.json())).toEqual({
      api: true
    });
  });

  it('does not mount routes when no production build exists', () => {
    directory = mkdtempSync(join(tmpdir(), 'citadel-admin-static-'));
    expect(mountAdminFrontend(express(), directory)).toBe(false);
  });
});
