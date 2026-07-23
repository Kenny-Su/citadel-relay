import { createPublicKey, timingSafeEqual, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jwtVerify } from 'jose';
import type {
  AuthenticatedAppServer,
  VerifiedClientIdentity
} from './shared.js';
import { isAppId } from './shared.js';

export const AUTH_TOKEN_MAX_LENGTH = 8_192;
export const CLIENT_SUBJECT_MAX_LENGTH = 256;
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

export type RelayAppServerAuthenticator = (
  token: string
) => AuthenticatedAppServer | null | Promise<AuthenticatedAppServer | null>;

export type RelayClientAuthenticator = (
  token: string
) => VerifiedClientIdentity | null | Promise<VerifiedClientIdentity | null>;

export type AppServerConfig = {
  appId: string;
  preSharedKey: string;
};

export type ClientJwtConfig = {
  issuer: string;
  audience: string;
  publicKeyPath: string;
  algorithm: string;
};

export type AppServerKeyConfig = {
  apps: AppServerConfig[];
};

export type RelayConfig = AppServerKeyConfig & {
  clientJwt: ClientJwtConfig;
};

type PreSharedKeyEntry = {
  key: Buffer;
  appServer: AuthenticatedAppServer;
};

export function createAppServerAuthenticator(
  config: AppServerKeyConfig
): RelayAppServerAuthenticator {
  const apps = validateAppServerConfig(config);
  const entries: PreSharedKeyEntry[] = apps.map((configured) => ({
    key: decodePreSharedKey(configured.preSharedKey) as Buffer,
    appServer: {
      appId: configured.appId
    }
  }));

  return (token) => {
    const presentedKey = decodePreSharedKey(token);
    if (!presentedKey) return null;

    let matchedAppServer: AuthenticatedAppServer | null = null;
    for (const entry of entries) {
      if (timingSafeEqual(presentedKey, entry.key)) {
        matchedAppServer = entry.appServer;
      }
    }
    return matchedAppServer;
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
        || !isValidClientSubject(payload.sub)
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

export function parseRelayConfig(input: string): RelayConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Relay config must be valid JSON.');
  }

  return validateRelayConfig(parsed);
}

export function validateRelayConfig(input: unknown): RelayConfig {
  const apps = validateAppServerConfig(input);
  if (!isRecord(input)) {
    throw new Error('Relay config must be an object.');
  }

  return {
    apps,
    clientJwt: validateClientJwtConfig(input.clientJwt)
  };
}

function validateAppServerConfig(input: unknown): AppServerConfig[] {
  if (!isRecord(input) || !Array.isArray(input.apps) || input.apps.length === 0) {
    throw new Error('Relay config must contain a non-empty apps array.');
  }

  const keys = new Set<string>();
  const appIds = new Set<string>();
  const apps = input.apps.map((value): AppServerConfig => {
    if (!isRecord(value)) {
      throw new Error('Each app must be an object.');
    }

    const appId = value.appId;
    const preSharedKey = value.preSharedKey;

    if (!isAppId(appId)) {
      throw new Error('App IDs must be lowercase identifiers such as "chat".');
    }

    if (typeof preSharedKey !== 'string' || !decodePreSharedKey(preSharedKey)) {
      throw new Error(
        `Pre-shared keys must be ${PRE_SHARED_KEY_BYTES} random bytes encoded as lowercase hexadecimal.`
      );
    }

    if (appIds.has(appId)) {
      throw new Error(`App ID is configured more than once: ${appId}`);
    }
    if (keys.has(preSharedKey)) {
      throw new Error('Each app must have a unique pre-shared key.');
    }

    appIds.add(appId);
    keys.add(preSharedKey);

    return {
      appId,
      preSharedKey
    };
  });

  return apps;
}

export function validateAuthenticatedAppServer(input: unknown): AuthenticatedAppServer {
  if (!isRecord(input)) {
    throw new Error('App-server authentication must return an object.');
  }

  if (!isAppId(input.appId)) {
    throw new Error('Authenticated app servers must return a valid app ID.');
  }

  return {
    appId: input.appId
  };
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

export function validateVerifiedClientIdentity(input: unknown): VerifiedClientIdentity {
  if (!isRecord(input)) {
    throw new Error('Client authentication must return an identity object.');
  }

  if (!isValidClientSubject(input.subject)) {
    throw new Error(
      `Client identity subjects must be between 1 and ${CLIENT_SUBJECT_MAX_LENGTH} characters without control characters.`
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

function isValidClientSubject(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= CLIENT_SUBJECT_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
