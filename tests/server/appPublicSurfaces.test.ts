import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledInstalledApps, bundledServerRegistrations } from '../../src/bundledApps/catalog.js';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import type { ServerAppContext } from '@citadel/platform/server-app';
import {
  chatServerRegistration as publicChatServerRegistration,
  createChatServerAppFromServices,
  resolveChatRepository,
  type ChatRepository
} from '@citadel/app-chat/server';
import {
  chessServerRegistration as publicChessServerRegistration,
  createChessServerAppFromServices,
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

type CitadelPackageMetadata = {
  appId: string;
  label: string;
  defaultSpaceId: string;
  persistence: 'none' | 'sqlite';
  version: string;
  client: {
    subpath: './client';
    registrationExport: string;
  };
  server: {
    subpath: './server';
    registrationExport: string;
  };
};

function readInstalledCitadelPackageMetadata(packageName: string) {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')
  ) as { name: string; citadel: CitadelPackageMetadata };

  return {
    packageName: packageJson.name,
    ...packageJson.citadel
  };
}

describe('app public package surfaces', () => {
  let tempDir: string;
  let database: CitadelDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-app-surfaces-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('mirrors installed package metadata through app descriptors and generated registrations', () => {
    const packageMetadata = bundledInstalledApps.map((app) => (
      readInstalledCitadelPackageMetadata(app.descriptor.packageName)
    ));

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
        client: metadata.client,
        server: metadata.server
      }))
    );
    expect(bundledServerRegistrations.map((registration) => registration.appId)).toEqual([
      'chat',
      'chess',
      'snake'
    ]);
    expect(bundledServerRegistrations.map((registration) => registration.bundle.appId)).toEqual([
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
    expect(bundledServerRegistrations).toEqual([
      publicChatServerRegistration,
      publicChessServerRegistration,
      publicSnakeServerRegistration
    ]);
  });

  it('uses app-owned adapters and injected repositories when creating app modules', () => {
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

    const apps = [
      publicChatServerRegistration.createServerApp({
        database,
        chatRepository
      }),
      publicChessServerRegistration.createServerApp({
        database,
        chessRepository
      })
    ];
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
