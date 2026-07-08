import { DISPLAY_NAME_MAX_LENGTH } from './shared.js';

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateDisplayName(input: unknown): ValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, error: 'Enter a display name.' };
  }

  const value = input.trim().replace(/\s+/g, ' ');

  if (!value) {
    return { ok: false, error: 'Enter a display name.' };
  }

  if (value.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Display names must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`
    };
  }

  return { ok: true, value };
}
