import { createPublicKey, timingSafeEqual, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jwtVerify } from 'jose';
import type {
  AuthenticatedPrincipal,
  VerifiedClientIdentity
} from './shared.js';
import { isNamespace } from './shared.js';

export const AUTH_TOKEN_MAX_LENGTH = 8_192;
export const PRINCIPAL_ID_MAX_LENGTH = 256;
export const PRE_SHARED_KEY_BYTES = 32;
export const PRE_SHARED_KEY_ENCODED_LENGTH = 64;
export const CLIENT_JWT_CLOCK_TOLERANCE_SECONDS = 5;

const PRE_SHARED_KEY_PATTERN = /^[0-9a-f]{64}$/;
const PUBLIC_KEY_PEM_PATTERN =
  /^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----$/;
const ASYMMETRIC_JWT_ALGORITHMS = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA'
]);

export type RelayAuthenticator = (
  token: string
) => AuthenticatedPrincipal | null | Promise<AuthenticatedPrincipal | null>;

export type RelayClientAuthenticator = (
  token: string
) => VerifiedClientIdentity | null | Promise<VerifiedClientIdentity | null>;

export type AppOwnerConfig = {
  name: string;
  preSharedKey: string;
  claimedPath: string;
};

export type ClientJwtConfig = {
  issuer: string;
  audience: string;
  publicKeyPath: string;
  algorithm: string;
};

export type AppOwnerPreSharedKeyConfig = {
  apps: AppOwnerConfig[];
};

export type PreSharedKeyConfig = AppOwnerPreSharedKeyConfig & {
  clientJwt: ClientJwtConfig;
};

type PreSharedKeyEntry = {
  key: Buffer;
  principal: AuthenticatedPrincipal;
};

export function createPreSharedKeyAuthenticator(
  config: AppOwnerPreSharedKeyConfig
): RelayAuthenticator {
  const apps = validateAppOwnerConfig(config);
  const entries: PreSharedKeyEntry[] = apps.map((configured) => ({
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
      if (timingSafeEqual(presentedKey, entry.key)) {
        matchedPrincipal = entry.principal;
      }
    }
    return matchedPrincipal;
  };
}

export function createJwtClientAuthenticator(config: ClientJwtConfig): RelayClientAuthenticator {
  const validated = validateClientJwtConfig(config);
  const publicKey = loadPublicKey(validated.publicKeyPath);

  return async (token) => {
    if (
      typeof token !== 'string'
      || token.length === 0
      || token.length > AUTH_TOKEN_MAX_LENGTH
    ) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: validated.issuer,
        audience: validated.audience,
        algorithms: [validated.algorithm],
        clockTolerance: CLIENT_JWT_CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp']
      });

      if (
        typeof payload.iss !== 'string'
        || !isValidPrincipalId(payload.sub)
        || typeof payload.exp !== 'number'
      ) {
        return null;
      }

      return {
        subject: payload.sub
      };
    } catch {
      return null;
    }
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
  const apps = validateAppOwnerConfig(input);
  if (!isRecord(input)) {
    throw new Error('Relay config must be an object.');
  }

  return {
    apps,
    clientJwt: validateClientJwtConfig(input.clientJwt)
  };
}

function validateAppOwnerConfig(input: unknown): AppOwnerConfig[] {
  if (!isRecord(input) || !Array.isArray(input.apps) || input.apps.length === 0) {
    throw new Error('Relay config must contain a non-empty apps array.');
  }

  const names = new Set<string>();
  const keys = new Set<string>();
  const claimedPaths = new Set<string>();
  const apps = input.apps.map((value): AppOwnerConfig => {
    if (!isRecord(value)) {
      throw new Error('Each pre-shared-key app must be an object.');
    }

    const principal = validateAuthenticatedPrincipal({
      id: value.name,
      name: value.name
    });
    const preSharedKey = value.preSharedKey;
    const claimedPath = value.claimedPath;

    if (typeof preSharedKey !== 'string' || !decodePreSharedKey(preSharedKey)) {
      throw new Error(
        `Pre-shared keys must be ${PRE_SHARED_KEY_BYTES} random bytes encoded as lowercase hexadecimal.`
      );
    }

    if (!isNamespace(claimedPath)) {
      throw new Error('Claimed paths must be absolute lowercase namespace paths such as "/chat".');
    }

    if (names.has(principal.id)) {
      throw new Error(`Duplicate app name: ${principal.id}`);
    }
    if (keys.has(preSharedKey)) {
      throw new Error('Each app must have a unique pre-shared key.');
    }
    if (claimedPaths.has(claimedPath)) {
      throw new Error(`Claimed path is assigned more than once: ${claimedPath}`);
    }

    names.add(principal.id);
    keys.add(preSharedKey);
    claimedPaths.add(claimedPath);

    return {
      name: principal.id,
      preSharedKey,
      claimedPath
    };
  });

  return apps;
}

export function validateClientJwtConfig(input: unknown): ClientJwtConfig {
  if (!isRecord(input)) {
    throw new Error('Client JWT configuration must be an object.');
  }

  const issuer = validateNonEmptyString(input.issuer, 'Client JWT issuer');
  const audience = validateNonEmptyString(input.audience, 'Client JWT audience');
  const publicKeyPath = validateNonEmptyString(
    input.publicKeyPath,
    'Client JWT public key path'
  );

  if (
    typeof input.algorithm !== 'string'
    || !ASYMMETRIC_JWT_ALGORITHMS.has(input.algorithm)
  ) {
    throw new Error('Client JWT algorithm must be a supported asymmetric algorithm.');
  }

  return {
    issuer,
    audience,
    publicKeyPath,
    algorithm: input.algorithm
  };
}

export function validateAuthenticatedPrincipal(input: unknown): AuthenticatedPrincipal {
  if (!isRecord(input)) {
    throw new Error('Authentication must return a principal object.');
  }

  if (
    !isValidPrincipalId(input.id)
  ) {
    throw new Error(`Principal ids must be between 1 and ${PRINCIPAL_ID_MAX_LENGTH} characters without control characters.`);
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

export function validateVerifiedClientIdentity(input: unknown): VerifiedClientIdentity {
  if (!isRecord(input)) {
    throw new Error('Client authentication must return an identity object.');
  }

  if (!isValidPrincipalId(input.subject)) {
    throw new Error(
      `Client identity subjects must be between 1 and ${PRINCIPAL_ID_MAX_LENGTH} characters without control characters.`
    );
  }

  return {
    subject: input.subject
  };
}

function decodePreSharedKey(value: unknown) {
  if (
    typeof value !== 'string'
    || value.length !== PRE_SHARED_KEY_ENCODED_LENGTH
    || !PRE_SHARED_KEY_PATTERN.test(value)
  ) {
    return null;
  }

  const decoded = Buffer.from(value, 'hex');
  return decoded.length === PRE_SHARED_KEY_BYTES && decoded.toString('hex') === value
    ? decoded
    : null;
}

function validateNonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function loadPublicKey(publicKeyPath: string): KeyObject {
  let pem: string;
  try {
    pem = readFileSync(publicKeyPath, 'utf8').trim();
  } catch {
    throw new Error(`Could not read Client JWT public key at "${publicKeyPath}".`);
  }

  if (!PUBLIC_KEY_PEM_PATTERN.test(pem)) {
    throw new Error('Client JWT public key must be a PEM-encoded SPKI public key.');
  }

  try {
    return createPublicKey(pem);
  } catch {
    throw new Error('Client JWT public key must be a valid PEM-encoded SPKI public key.');
  }
}

function isValidPrincipalId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= PRINCIPAL_ID_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
