import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_ID, MESSAGE_HISTORY_LIMIT, type ChatMessage } from '../../src/shared/chat.js';
import { createSqliteMessageStore, type MessageStore } from '../../src/server/messageStore.js';

function makeMessage(index: number): ChatMessage {
  return {
    id: `message-${index.toString().padStart(3, '0')}`,
    roomId: DEFAULT_ROOM_ID,
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
    expect(store.listRecentMessages(DEFAULT_ROOM_ID)).toEqual([]);
  });

  it('saves and reads messages in chronological order', () => {
    store.saveMessage(makeMessage(2));
    store.saveMessage(makeMessage(1));

    expect(store.listRecentMessages(DEFAULT_ROOM_ID)).toEqual([makeMessage(1), makeMessage(2)]);
    expect(store.countMessages()).toBe(2);
  });

  it('returns only the latest history window', () => {
    for (let index = 0; index < MESSAGE_HISTORY_LIMIT + 5; index += 1) {
      store.saveMessage(makeMessage(index));
    }

    const messages = store.listRecentMessages(DEFAULT_ROOM_ID);

    expect(messages).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(messages[0].id).toBe('message-005');
    expect(messages.at(-1)?.id).toBe('message-104');
    expect(store.countMessages()).toBe(MESSAGE_HISTORY_LIMIT + 5);
  });

  it('persists messages after reopening the database', () => {
    store.saveMessage(makeMessage(1));
    store.close();

    store = createSqliteMessageStore(dbPath);

    expect(store.listRecentMessages(DEFAULT_ROOM_ID)).toEqual([makeMessage(1)]);
  });

  it('scopes messages by room', () => {
    const generalMessage = makeMessage(1);
    const designMessage = { ...makeMessage(2), roomId: 'design' };

    store.saveMessage(generalMessage);
    store.saveMessage(designMessage);

    expect(store.listRecentMessages(DEFAULT_ROOM_ID)).toEqual([generalMessage]);
    expect(store.listRecentMessages('design')).toEqual([designMessage]);
  });

  it('keeps the history limit per room', () => {
    for (let index = 0; index < MESSAGE_HISTORY_LIMIT + 5; index += 1) {
      store.saveMessage(makeMessage(index));
      store.saveMessage({ ...makeMessage(index + 200), roomId: 'design' });
    }

    const generalMessages = store.listRecentMessages(DEFAULT_ROOM_ID);
    const designMessages = store.listRecentMessages('design');

    expect(generalMessages).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(generalMessages[0].id).toBe('message-005');
    expect(designMessages).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(designMessages[0].id).toBe('message-205');
  });

  it('migrates existing messages into the default room', () => {
    store.close();

    const database = new DatabaseSync(dbPath);
    database.exec(`
      DROP TABLE messages;
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO messages (id, user_id, user_name, body, created_at)
      VALUES ('legacy-1', 'user-1', 'Ada', 'legacy message', '2026-01-01T00:00:00.000Z');
    `);
    database.close();

    store = createSqliteMessageStore(dbPath);

    expect(store.listRecentMessages(DEFAULT_ROOM_ID)).toEqual([
      {
        id: 'legacy-1',
        roomId: DEFAULT_ROOM_ID,
        userId: 'user-1',
        userName: 'Ada',
        body: 'legacy message',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
  });
});
