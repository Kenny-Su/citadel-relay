import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCitadelServer } from '../../src/server/citadelServer.js';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel-platform/platform/persistence';

const staticDir = resolve(process.cwd(), 'dist');
const hasBuiltClient = existsSync(join(staticDir, 'index.html'));

describe.skipIf(!hasBuiltClient)('production server', () => {
  let server: Awaited<ReturnType<typeof createCitadelServer>>;
  let tempDir: string;
  let database: CitadelDatabase;
  let url: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-platform-production-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
    server = await createCitadelServer({
      clientOrigin: '*',
      database,
      staticDir,
      extensionsDir: join(tempDir, 'extensions')
    });
    await new Promise<void>((resolveListen) =>
      server.httpServer.listen(0, '127.0.0.1', resolveListen)
    );
    const address = server.httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolveClose) => server.io.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => server.httpServer.close(() => resolveClose()));
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves health, app routes, and legacy room routes from one empty host server', async () => {
    const health = await fetch(`${url}/health`);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      version: '0.1.0',
      apps: [],
      appCount: 0,
      appManifests: []
    });

    for (const path of [
      '/',
      '/apps/fixture/spaces/general',
      '/rooms/general'
    ]) {
      const route = await fetch(`${url}${path}`);
      expect(route.headers.get('content-type')).toContain('text/html');
      expect(await route.text()).toContain('<div id="root"></div>');
    }
  });
});
