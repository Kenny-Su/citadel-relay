import { describe, expect, it } from 'vitest';
import { validateDisplayName } from '@citadel/platform/validation';
import { validateMessageBody } from '@citadel/app-chat/validation';

describe('validation', () => {
  it('normalizes valid display names', () => {
    expect(validateDisplayName('  Ada   Lovelace  ')).toEqual({
      ok: true,
      value: 'Ada Lovelace'
    });
  });

  it('rejects invalid display names', () => {
    expect(validateDisplayName('   ')).toEqual({
      ok: false,
      error: 'Enter a display name.'
    });
    expect(validateDisplayName('x'.repeat(25))).toEqual({
      ok: false,
      error: 'Display names must be 24 characters or fewer.'
    });
  });

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
