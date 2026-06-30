import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bundledAppManifests,
  bundledServerAppBundles,
  createBundledServerApps,
  filterAppManifests,
  filterServerAppBundles,
  getEnabledAppIds,
  resolveBundledRepositories
} from '../../src/apps/serverRegistry.js';
import { openCitadelDatabase, type CitadelDatabase } from '../../src/persistence/sqlite.js';
import type { ChatRepository } from '../../src/apps/chat/serverEntry.js';
import type { ChessRepository } from '../../src/apps/chess/serverEntry.js';
import {
  chatManifest as publicChatManifest
} from '../../src/apps/chat/index.js';
import {
  chessManifest as publicChessManifest
} from '../../src/apps/chess/index.js';
import {
  snakeManifest as publicSnakeManifest
} from '../../src/apps/snake/index.js';
import { chatServerBundle as publicChatServerBundle } from '../../src/apps/chat/serverEntry.js';
import { chessServerBundle as publicChessServerBundle } from '../../src/apps/chess/serverEntry.js';
import { snakeServerBundle as publicSnakeServerBundle } from '../../src/apps/snake/serverEntry.js';

describe('bundled server app registry', () => {
  let tempDir: string;
  let database: CitadelDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-app-registry-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the bundled chat, chess, and snake server modules', () => {
    const apps = createBundledServerApps({ database });

    expect(apps.map((app) => app.appId)).toEqual(['chat', 'chess', 'snake']);
  });

  it('exposes bundled manifests in app order', () => {
    expect(bundledAppManifests).toEqual([
      {
        appId: 'chat',
        label: 'Chat',
        defaultSpaceId: 'general',
        persistence: 'sqlite',
        version: '0.1.0'
      },
      {
        appId: 'chess',
        label: 'Chess',
        defaultSpaceId: 'general',
        persistence: 'sqlite',
        version: '0.1.0'
      },
      {
        appId: 'snake',
        label: 'Snake',
        defaultSpaceId: 'general',
        persistence: 'none',
        version: '0.1.0'
      }
    ]);
    expect(bundledAppManifests.map((manifest) => manifest.appId)).toEqual(
      bundledServerAppBundles.map((bundle) => bundle.appId)
    );
  });

  it('exposes app manifests and server bundles from environment entrypoints', () => {
    expect([publicChatManifest, publicChessManifest, publicSnakeManifest].map((manifest) => manifest.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect([publicChatServerBundle, publicChessServerBundle, publicSnakeServerBundle].map((bundle) => bundle.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
  });

  it('parses enabled app configuration with defaults and fallback', () => {
    expect(getEnabledAppIds()).toEqual(['chat', 'chess', 'snake']);
    expect(getEnabledAppIds(' chess, chat, chess, unknown, snake ')).toEqual([
      'chess',
      'chat',
      'snake'
    ]);
    expect(getEnabledAppIds('unknown, nope')).toEqual(['chat', 'chess', 'snake']);
  });

  it('filters server app bundles by enabled app ids', () => {
    expect(filterServerAppBundles(['snake', 'chat']).map((bundle) => bundle.appId)).toEqual([
      'snake',
      'chat'
    ]);
  });

  it('filters app manifests by enabled app ids', () => {
    expect(filterAppManifests(['snake', 'chat']).map((manifest) => manifest.appId)).toEqual([
      'snake',
      'chat'
    ]);
  });

  it('creates only enabled server modules', () => {
    const apps = createBundledServerApps({ database, enabledAppIds: ['snake', 'chat'] });

    expect(apps.map((app) => app.appId)).toEqual(['snake', 'chat']);
  });

  it('uses injected repositories when resolving bundled services', () => {
    const chatRepository = {
      listRecentMessages: vi.fn(() => []),
      saveMessage: vi.fn(),
      countMessages: vi.fn(() => 0),
      close: vi.fn()
    } satisfies ChatRepository;
    const chessRepository = {
      getGame: vi.fn(() => null),
      saveGame: vi.fn(),
      appendMove: vi.fn(),
      listMoves: vi.fn(() => []),
      close: vi.fn()
    } satisfies ChessRepository;

    expect(resolveBundledRepositories({ database, chatRepository, chessRepository })).toEqual({
      chatRepository,
      chessRepository
    });
  });

});
