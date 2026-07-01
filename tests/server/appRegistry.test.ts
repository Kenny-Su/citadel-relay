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
  getEnabledAppIds
} from '../../src/bundledApps/serverRegistry.js';
import {
  bundledAppDefinitions,
  bundledAppIds,
  bundledAppsConfig,
  bundledAppPackageNames,
  parseBundledAppsConfig,
  resolveBundledAppDefinitions,
} from '../../src/bundledApps/catalog.js';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import type { ServerAppContext } from '@citadel/platform/server-app';
import {
  createChatServerAppFromServices,
  chatServerRegistration as publicChatServerRegistration,
  resolveChatRepository,
  type ChatRepository
} from '@citadel/app-chat/server';
import {
  createChessServerAppFromServices,
  chessServerRegistration as publicChessServerRegistration,
  resolveChessRepository,
  type ChessRepository
} from '@citadel/app-chess/server';
import {
  chatAppPackage as publicChatAppPackage,
  chatManifest as publicChatManifest
} from '@citadel/app-chat';
import {
  chessAppPackage as publicChessAppPackage,
  chessManifest as publicChessManifest
} from '@citadel/app-chess';
import {
  snakeAppPackage as publicSnakeAppPackage,
  snakeManifest as publicSnakeManifest
} from '@citadel/app-snake';
import { snakeServerRegistration as publicSnakeServerRegistration } from '@citadel/app-snake/server';

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
    expect(bundledAppsConfig).toEqual({
      packages: [
        '@citadel/app-chat',
        '@citadel/app-chess',
        '@citadel/app-snake'
      ]
    });
    expect(bundledAppPackageNames).toEqual([
      '@citadel/app-chat',
      '@citadel/app-chess',
      '@citadel/app-snake'
    ]);
    expect(bundledAppDefinitions.map((definition) => definition.appId)).toEqual(bundledAppIds);
    expect(bundledAppDefinitions.map((definition) => definition.manifest)).toEqual(bundledAppManifests);
    expect(bundledAppDefinitions.map((definition) => definition.packageName)).toEqual([
      '@citadel/app-chat',
      '@citadel/app-chess',
      '@citadel/app-snake'
    ]);
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
      bundledAppIds
    );
    expect(bundledServerAppBundles.map((bundle) => bundle.appId)).toEqual(bundledAppIds);
  });

  it('resolves declarative bundled app package config with validation', () => {
    expect(parseBundledAppsConfig({
      packages: [
        '@citadel/app-chat',
        '@citadel/app-chess',
        '@citadel/app-snake'
      ]
    })).toEqual(bundledAppsConfig);
    expect(() => parseBundledAppsConfig({})).toThrow('Bundled apps config must contain a packages array');
    expect(() => parseBundledAppsConfig({ packages: '@citadel/app-chat' })).toThrow(
      'Bundled apps config packages must be an array'
    );
    expect(() => parseBundledAppsConfig({ packages: ['@citadel/app-chat', 7] })).toThrow(
      'Bundled apps config packages must contain only strings'
    );
    expect(resolveBundledAppDefinitions(bundledAppPackageNames)).toEqual(bundledAppDefinitions);
    expect(resolveBundledAppDefinitions([
      '@citadel/app-snake',
      '@citadel/app-chat'
    ]).map((definition) => definition.appId)).toEqual(['snake', 'chat']);
    expect(() => resolveBundledAppDefinitions([
      '@citadel/app-chat',
      '@citadel/app-chat'
    ])).toThrow('Duplicate bundled app id: chat');
    expect(() => resolveBundledAppDefinitions([
      '@citadel/app-missing'
    ])).toThrow('Unknown bundled app package: @citadel/app-missing');
  });

  it('exposes app manifests and server registrations from environment entrypoints', () => {
    expect([publicChatManifest, publicChessManifest, publicSnakeManifest].map((manifest) => manifest.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect([publicChatAppPackage, publicChessAppPackage, publicSnakeAppPackage].map((appPackage) => ({
      appId: appPackage.appId,
      packageName: appPackage.packageName,
      client: appPackage.client.registrationExport,
      server: appPackage.server.registrationExport
    }))).toEqual([
      {
        appId: 'chat',
        packageName: '@citadel/app-chat',
        client: 'chatClientRegistration',
        server: 'chatServerRegistration'
      },
      {
        appId: 'chess',
        packageName: '@citadel/app-chess',
        client: 'chessClientRegistration',
        server: 'chessServerRegistration'
      },
      {
        appId: 'snake',
        packageName: '@citadel/app-snake',
        client: 'snakeClientRegistration',
        server: 'snakeServerRegistration'
      }
    ]);
    const registrations = [
      publicChatServerRegistration,
      publicChessServerRegistration,
      publicSnakeServerRegistration
    ];

    expect(registrations.map((registration) => registration.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect(registrations.map((registration) => registration.bundle.appId)).toEqual([
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

  it('uses app-owned adapters and injected repositories when creating server modules', () => {
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

    expect(resolveChatRepository({ database, chatRepository })).toBe(chatRepository);
    expect(resolveChessRepository({ database, chessRepository })).toBe(chessRepository);
    expect(createChatServerAppFromServices({ database, chatRepository }).appId).toBe('chat');
    expect(createChessServerAppFromServices({ database, chessRepository }).appId).toBe('chess');

    const apps = createBundledServerApps({
      database,
      chatRepository,
      chessRepository,
      enabledAppIds: ['chat', 'chess']
    });
    const context: Omit<ServerAppContext, 'participant' | 'socketId'> = {
      appId: 'chat',
      spaceId: 'general',
      participants: [],
      emitToSpace: vi.fn(),
      emitToParticipant: vi.fn(),
      emitSpaceState: vi.fn(),
      getAppState: () => undefined,
      setAppState: vi.fn(),
      clearAppState: vi.fn()
    };

    apps[0].getInitialState(context);
    apps[1].getInitialState({ ...context, appId: 'chess' });

    expect(chatRepository.listRecentMessages).toHaveBeenCalledWith('general', 100);
    expect(chessRepository.getGame).toHaveBeenCalledWith('general');
    expect(chessRepository.saveGame).toHaveBeenCalled();
  });

});
