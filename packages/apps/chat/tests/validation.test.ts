import { describe, expect, it } from 'vitest';
import { validateMessageBody } from '../src/validation.js';

describe('chat validation', () => {
  it('trims valid messages', () => {
    expect(validateMessageBody('  hello room  ')).toEqual({
      ok: true,
      value: 'hello room'
    });
  });

  it('rejects invalid messages', () => {
    expect(validateMessageBody('\n\t')).toEqual({
      ok: false,
      error: 'Type a message before sending.'
    });
    expect(validateMessageBody('x'.repeat(501))).toEqual({
      ok: false,
      error: 'Messages must be 500 characters or fewer.'
    });
  });
});
