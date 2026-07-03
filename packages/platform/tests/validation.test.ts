import { describe, expect, it } from 'vitest';
import { validateDisplayName } from '../src/validation.js';

describe('platform validation', () => {
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
});
