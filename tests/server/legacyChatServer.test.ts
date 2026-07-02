import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChatRepository } from '@citadel/app-chat/server';
import { createChessRepository } from '@citadel/app-chess/server';
import { openCitadelDatabase, type CitadelDatabase } from '@citadel/platform/persistence';
import { createChatServer } from '../../src/server/legacyChatServer.js';

describe('legacy chat server wrapper', () => {
  let tempDir: string | undefined;
  let database: CitadelDatabase | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('preserves legacy repository return fields while delegating app creation to Citadel server', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-chat-server-'));
    database = openCitadelDatabase(join(tempDir, 'citadel.sqlite'));
    const chatRepository = createChatRepository(database.database);
    const chessRepository = createChessRepository(database.database);
    const server = createChatServer({
      clientOrigin: '*',
      database,
      chatRepository,
      chessRepository,
      enabledAppIds: ['chat'],
      messageRateLimit: {
        maxMessages: 1,
        windowMs: 1_000
      }
    });

    try {
      expect(server.database).toBe(database);
      expect(server.chatRepository).toBe(chatRepository);
      expect(server.messageStore).toBe(chatRepository);
      expect(server.chessRepository).toBe(chessRepository);
      expect([...server.apps.keys()]).toEqual(['chat']);

      const chatModule = server.apps.get('chat');

      expect(chatModule?.getInitialState({
        appId: 'chat',
        spaceId: 'general',
        participants: [],
        emitToSpace() {},
        emitToParticipant() {},
        emitSpaceState() {},
        getAppState() {
          return undefined;
        },
        setAppState() {},
        clearAppState() {}
      })).toEqual({
        messages: [],
        typingParticipants: []
      });
    } finally {
      server.io.close();
    }
  });
});
