import { timingSafeEqual } from 'node:crypto';
import type { AuthenticatedPrincipal } from './shared.js';
import { isNamespace } from './shared.js';

export const AUTH_TOKEN_MAX_LENGTH = 8_192;
export const PRINCIPAL_ID_MAX_LENGTH = 256;
export const PRE_SHARED_KEY_BYTES = 32;
export const PRE_SHARED_KEY_ENCODED_LENGTH = 64;

const PRE_SHARED_KEY_PATTERN = /^[0-9a-f]{64}$/;

export type RelayAuthenticator = (
  token: string
) => AuthenticatedPrincipal | null | Promise<AuthenticatedPrincipal | null>;

export type AppOwnerConfig = {
  name: string;
  preSharedKey: string;
  claimedPath: string;
};

export type PreSharedKeyConfig = {
  apps: AppOwnerConfig[];
};

type PreSharedKeyEntry = {
  key: Buffer;
  principal: AuthenticatedPrincipal;
};

export function createPreSharedKeyAuthenticator(config: PreSharedKeyConfig): RelayAuthenticator {
  const validated = validatePreSharedKeyConfig(config);
  const entries: PreSharedKeyEntry[] = validated.apps.map((configured) => ({
    key: decodePreSharedKey(configured.preSharedKey) as Buffer,
    principal: {
      id: configured.name,
      name: configured.name,
      namespaceClaims: [configured.claimedPath]
    }
  }));

  return (token) => {
    const presentedKey = decodePreSharedKey(token);
    if (!presentedKey) return null;

    let matchedPrincipal: AuthenticatedPrincipal | null = null;
    for (const entry of entries) {
      if (timingSafeEqual(presentedKey, entry.key)) matchedPrincipal = entry.principal;
    }
    return matchedPrincipal;
  };
}

export function parsePreSharedKeyConfig(input: string): PreSharedKeyConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Relay config must be valid JSON.');
  }
  return validatePreSharedKeyConfig(parsed);
}

export function validatePreSharedKeyConfig(input: unknown): PreSharedKeyConfig {
  if (!isRecord(input) || !Array.isArray(input.apps) || input.apps.length === 0) {
    throw new Error('Relay config must contain a non-empty apps array.');
  }

  const names = new Set<string>();
  const keys = new Set<string>();
  const paths = new Set<string>();
  const apps = input.apps.map((value): AppOwnerConfig => {
    if (!isRecord(value)) throw new Error('Each pre-shared-key app must be an object.');
    const principal = validateAuthenticatedPrincipal({ id: value.name, name: value.name });
    const preSharedKey = value.preSharedKey;
    const claimedPath = value.claimedPath;

    if (typeof preSharedKey !== 'string' || !decodePreSharedKey(preSharedKey)) {
      throw new Error('Pre-shared keys must be 32 random bytes encoded as lowercase hexadecimal.');
    }
    if (!isNamespace(claimedPath)) {
      throw new Error('Claimed paths must be first-level lowercase paths such as "/chat".');
    }
    if (names.has(principal.id)) throw new Error(`Duplicate app name: ${principal.id}`);
    if (keys.has(preSharedKey)) throw new Error('Each app must have a unique pre-shared key.');
    if (paths.has(claimedPath)) throw new Error(`Claimed path is assigned more than once: ${claimedPath}`);

    names.add(principal.id);
    keys.add(preSharedKey);
    paths.add(claimedPath);
    return { name: principal.id, preSharedKey, claimedPath };
  });
  return { apps };
}

export function validateAuthenticatedPrincipal(input: unknown): AuthenticatedPrincipal {
  if (!isRecord(input)) throw new Error('Authentication must return a principal object.');
  if (
    typeof input.id !== 'string'
    || input.id.length === 0
    || input.id.length > PRINCIPAL_ID_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(input.id)
  ) {
    throw new Error('Principal ids must be non-empty strings without control characters.');
  }
  if (input.name !== undefined && typeof input.name !== 'string') {
    throw new Error('Principal names must be strings when present.');
  }
  if (
    input.namespaceClaims !== undefined
    && (!Array.isArray(input.namespaceClaims) || !input.namespaceClaims.every(isNamespace))
  ) {
    throw new Error('Principal namespace claims must be valid namespace paths.');
  }
  return {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.namespaceClaims !== undefined ? { namespaceClaims: [...input.namespaceClaims] } : {})
  };
}

function decodePreSharedKey(value: unknown) {
  if (
    typeof value !== 'string'
    || value.length !== PRE_SHARED_KEY_ENCODED_LENGTH
    || !PRE_SHARED_KEY_PATTERN.test(value)
  ) return null;

  const decoded = Buffer.from(value, 'hex');
  return decoded.length === PRE_SHARED_KEY_BYTES && decoded.toString('hex') === value
    ? decoded
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
