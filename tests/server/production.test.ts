import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatServer } from '../../src/server/chatServer.js';
import { createChatRepository } from '@citadel/app-chat/server';
import { createChessRepository } from '@citadel/app-chess/server';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';

const staticDir = resolve(process.cwd(), 'dist');
const hasBuiltClient = existsSync(join(staticDir, 'index.html'));

describe.skipIf(!hasBuiltClient)('production server', () => {
  let server: ReturnType<typeof createChatServer>;
  let tempDir: string;
  let database: CitadelDatabase;
  let url: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-platform-production-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
    server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository: createChatRepository(database.database),
      chessRepository: createChessRepository(database.database),
      staticDir
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

  it('serves health, app routes, and legacy room routes from one server', async () => {
    const health = await fetch(`${url}/health`);
    await expect(health.json()).resolves.toMatchObject({ ok: true, version: '0.1.0' });

    for (const path of [
      '/apps/chat/spaces/general',
      '/apps/chess/spaces/general',
      '/apps/snake/spaces/general',
      '/rooms/general'
    ]) {
      const route = await fetch(`${url}${path}`);
      expect(route.headers.get('content-type')).toContain('text/html');
      expect(await route.text()).toContain('<div id="root"></div>');
    }
  });
});
