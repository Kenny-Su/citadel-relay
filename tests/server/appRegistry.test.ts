import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { bundledInstalledApps, bundledServerRegistrationByPackageName } from '../../src/bundledApps/generatedAppCatalog.js';
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
import {
  createLegacyAppServiceBag,
  getLegacyServiceNames
} from '../../src/server/legacyAppRepositories.js';

type CitadelPackageMetadata = {
  appId: string;
  label: string;
  defaultSpaceId: string;
  persistence: 'none' | 'sqlite';
  version: string;
  capabilities: {
    legacyServices: string[];
  };
  client: {
    subpath: './client';
    registrationExport: string;
  };
  server: {
    subpath: './server';
    registrationExport: string;
  };
};

function readCitadelPackageMetadata(appId: 'chat' | 'chess' | 'snake') {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), `packages/apps/${appId}/package.json`), 'utf8')
  ) as { name: string; citadel: CitadelPackageMetadata };

  return {
    packageName: packageJson.name,
    ...packageJson.citadel
  };
}

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
    const packageMetadata = [
      readCitadelPackageMetadata('chat'),
      readCitadelPackageMetadata('chess'),
      readCitadelPackageMetadata('snake')
    ];

    expect([publicChatManifest, publicChessManifest, publicSnakeManifest].map((manifest) => manifest.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect([publicChatAppPackage, publicChessAppPackage, publicSnakeAppPackage]).toEqual(
      packageMetadata.map((metadata) => ({
        appId: metadata.appId,
        manifest: {
          appId: metadata.appId,
          label: metadata.label,
          defaultSpaceId: metadata.defaultSpaceId,
          persistence: metadata.persistence,
          version: metadata.version
        },
        packageName: metadata.packageName,
        capabilities: metadata.capabilities,
        client: metadata.client,
        server: metadata.server
      }))
    );
    const registrations = [
      bundledServerRegistrationByPackageName['@citadel/app-chat'],
      bundledServerRegistrationByPackageName['@citadel/app-chess'],
      bundledServerRegistrationByPackageName['@citadel/app-snake']
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
    expect(bundledInstalledApps.map((app) => app.descriptor.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect(bundledInstalledApps.map((app) => app.clientRegistration.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect(bundledInstalledApps.map((app) => app.serverRegistration.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect(registrations).toEqual([
      publicChatServerRegistration,
      publicChessServerRegistration,
      publicSnakeServerRegistration
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
      appServices: {
        chatRepository,
        chessRepository
      },
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

  it('creates legacy app service bags from selected app capabilities', () => {
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
    const repositories = {
      chatRepository,
      chessRepository,
      messageStore: chatRepository
    };
    const messageRateLimit = {
      maxMessages: 5,
      windowMs: 80
    };

    expect(getLegacyServiceNames()).toEqual([
      'chatRepository',
      'messageStore',
      'messageRateLimit',
      'chessRepository'
    ]);
    expect(getLegacyServiceNames([publicSnakeAppPackage])).toEqual([]);
    expect(createLegacyAppServiceBag(repositories, { messageRateLimit }, ['chat'])).toEqual({
      chatRepository,
      messageStore: chatRepository,
      messageRateLimit
    });
    expect(createLegacyAppServiceBag(repositories, { messageRateLimit }, ['chess'])).toEqual({
      chessRepository
    });
    expect(createLegacyAppServiceBag(repositories, { messageRateLimit }, ['snake'])).toEqual({});
    expect(createLegacyAppServiceBag(repositories, { messageRateLimit }, ['snake', 'chat'])).toEqual({
      chatRepository,
      messageStore: chatRepository,
      messageRateLimit
    });
    expect(() => getLegacyServiceNames([
      {
        appId: 'demo',
        capabilities: {
          legacyServices: ['unknownService']
        }
      }
    ])).toThrow('Unsupported legacy app service capability "unknownService" declared by app "demo"');
  });

});
