import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGE_HISTORY_LIMIT, type ChatMessage } from '../../src/shared/chat.js';
import { createSqliteMessageStore, type MessageStore } from '../../src/server/messageStore.js';

function makeMessage(index: number): ChatMessage {
  return {
    id: `message-${index.toString().padStart(3, '0')}`,
    userId: 'user-1',
    userName: 'Ada',
    body: `message ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0, index)).toISOString()
  };
}

describe('sqlite message store', () => {
  let tempDir: string;
  let dbPath: string;
  let store: MessageStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'citadel-chat-store-'));
    dbPath = join(tempDir, 'chat.sqlite');
    store = createSqliteMessageStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes an empty database', () => {
    expect(store.countMessages()).toBe(0);
    expect(store.listRecentMessages()).toEqual([]);
  });

  it('saves and reads messages in chronological order', () => {
    store.saveMessage(makeMessage(2));
    store.saveMessage(makeMessage(1));

    expect(store.listRecentMessages()).toEqual([makeMessage(1), makeMessage(2)]);
    expect(store.countMessages()).toBe(2);
  });

  it('returns only the latest history window', () => {
    for (let index = 0; index < MESSAGE_HISTORY_LIMIT + 5; index += 1) {
      store.saveMessage(makeMessage(index));
    }

    const messages = store.listRecentMessages();

    expect(messages).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(messages[0].id).toBe('message-005');
    expect(messages.at(-1)?.id).toBe('message-104');
    expect(store.countMessages()).toBe(MESSAGE_HISTORY_LIMIT + 5);
  });

  it('persists messages after reopening the database', () => {
    store.saveMessage(makeMessage(1));
    store.close();

    store = createSqliteMessageStore(dbPath);

    expect(store.listRecentMessages()).toEqual([makeMessage(1)]);
  });
});
