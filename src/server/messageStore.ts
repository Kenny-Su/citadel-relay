import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MESSAGE_HISTORY_LIMIT, type ChatMessage } from '../shared/chat.js';

export type MessageStore = {
  listRecentMessages(limit?: number): ChatMessage[];
  saveMessage(message: ChatMessage): void;
  countMessages(): number;
  close(): void;
};

type MessageRow = {
  id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
};

export function createSqliteMessageStore(dbPath: string): MessageStore {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
  `);

  const listRecent = database.prepare(`
    SELECT id, user_id, user_name, body, created_at
    FROM (
      SELECT id, user_id, user_name, body, created_at
      FROM messages
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    )
    ORDER BY created_at ASC, id ASC
  `);

  const save = database.prepare(`
    INSERT INTO messages (id, user_id, user_name, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const count = database.prepare('SELECT COUNT(*) AS count FROM messages');

  return {
    listRecentMessages(limit = MESSAGE_HISTORY_LIMIT) {
      return listRecent.all(limit).map(rowToMessage);
    },
    saveMessage(message) {
      save.run(message.id, message.userId, message.userName, message.body, message.createdAt);
    },
    countMessages() {
      const row = count.get() as { count: number };
      return row.count;
    },
    close() {
      database.close();
    }
  };
}

function rowToMessage(row: unknown): ChatMessage {
  const message = row as MessageRow;

  return {
    id: message.id,
    userId: message.user_id,
    userName: message.user_name,
    body: message.body,
    createdAt: message.created_at
  };
}
