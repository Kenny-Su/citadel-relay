import { describe, expect, it } from 'vitest';
import { createChatServer as createChatServerShim } from '../../src/server/chatServer.js';
import { createChatServer as createLegacyChatServer } from '../../src/server/legacyChatServer.js';

describe('legacy chat server compatibility shim', () => {
  it('re-exports the legacy chat server factory', () => {
    expect(createChatServerShim).toBe(createLegacyChatServer);
  });
});
