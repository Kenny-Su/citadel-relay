import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SignJWT,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  type CryptoKey
} from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PRE_SHARED_KEY_BYTES,
  createAppServerAuthenticator,
  createJwtClientAuthenticator,
  parseRelayConfig,
  validateAuthenticatedAppServer,
  validateClientJwtConfig,
  validateRelayConfig,
  validateVerifiedClientIdentity
} from '../../src/relay/auth.js';

function testKey(fill: number) {
  return Buffer.alloc(PRE_SHARED_KEY_BYTES, fill).toString('hex');
}

const temporaryDirectories = new Set<string>();

function temporaryPath(filename: string) {
  const directory = mkdtempSync(join(tmpdir(), 'citadel-relay-'));
  temporaryDirectories.add(directory);
  return join(directory, filename);
}

async function writePublicKey(publicKey: CryptoKey) {
  const path = temporaryPath('client-jwt-public.pem');
  writeFileSync(path, await exportSPKI(publicKey));
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

async function signClientJwt(
  privateKey: CryptoKey,
  options: {
    kid?: string;
    issuer?: string;
    audience?: string;
    subject?: string;
    expirationTime?: number;
    notBefore?: number;
    claims?: Record<string, unknown>;
  } = {}
) {
  let jwt = new SignJWT(options.claims ?? { role: 'member' })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'key-1' })
    .setIssuer(options.issuer ?? 'https://identity.example.com/')
    .setAudience(options.audience ?? 'citadel-relay')
    .setIssuedAt();

  if (options.subject !== undefined) jwt = jwt.setSubject(options.subject);
  if (options.expirationTime !== undefined) jwt = jwt.setExpirationTime(options.expirationTime);
  if (options.notBefore !== undefined) jwt = jwt.setNotBefore(options.notBefore);

  return jwt.sign(privateKey);
}

describe('relay authentication', () => {
  it('authenticates an app server with an exact 256-bit pre-shared key', async () => {
    const chatKey = testKey(1);
    const authenticate = createAppServerAuthenticator({
      apps: [{
        preSharedKey: chatKey,
        appId: 'chat'
      }]
    });

    expect(await authenticate(chatKey)).toEqual({
      appId: 'chat'
    });
    expect(await authenticate(testKey(2))).toBeNull();
    expect(await authenticate('not-a-key')).toBeNull();
  });

  it('parses app config and rejects invalid or duplicate app mappings', () => {
    const key = testKey(3);
    expect(parseRelayConfig(JSON.stringify({
      apps: [{ preSharedKey: key, appId: 'chat' }],
      clientJwt: {
        issuer: 'https://identity.example.com/',
        audience: 'citadel-relay',
        publicKeyPath: './keys/client-jwt-public.pem',
        algorithm: 'RS256'
      }
    }))).toEqual({
      apps: [{ preSharedKey: key, appId: 'chat' }],
      clientJwt: {
        issuer: 'https://identity.example.com/',
        audience: 'citadel-relay',
        publicKeyPath: './keys/client-jwt-public.pem',
        algorithm: 'RS256'
      }
    });

    expect(() => parseRelayConfig('[]')).toThrow('apps array');
    expect(() => validateRelayConfig({ apps: [] })).toThrow('non-empty');
    expect(() => validateRelayConfig({
      apps: [{ preSharedKey: 'too-short', appId: 'chat' }]
    })).toThrow('32 random bytes');
    expect(() => createAppServerAuthenticator({
      apps: [{ preSharedKey: testKey(7), appId: '/chat' }]
    })).toThrow('lowercase identifiers');
    expect(() => validateRelayConfig({
      apps: [
        { preSharedKey: testKey(4), appId: 'chat' },
        { preSharedKey: testKey(5), appId: 'chat' }
      ]
    })).toThrow('configured more than once');
    expect(() => validateRelayConfig({
      apps: [{ preSharedKey: testKey(6), appId: 'chat' }]
    })).toThrow('Client JWT configuration must be an object');
    expect(() => validateAuthenticatedAppServer({
      appId: 'chat/deep'
    })).toThrow('valid app ID');
    expect(() => validateClientJwtConfig({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      publicKeyPath: '',
      algorithm: 'RS256'
    })).toThrow('public key path');
    expect(() => validateClientJwtConfig({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      publicKeyPath: './keys/client-jwt-public.pem',
      algorithm: 'HS256'
    })).toThrow('asymmetric algorithm');
    expect(validateVerifiedClientIdentity({
      issuer: 'https://identity.example.com/',
      subject: 'client-42',
      claims: { role: 'admin' }
    })).toEqual({ subject: 'client-42' });
    expect(() => validateVerifiedClientIdentity({
      subject: 'x'.repeat(257)
    })).toThrow('Client identity subjects');
  });

  it('verifies client JWT identity with a local public key', async () => {
    const keyPair = await generateKeyPair('RS256');
    const publicKeyPath = await writePublicKey(keyPair.publicKey);
    const authenticate = createJwtClientAuthenticator({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      publicKeyPath,
      algorithm: 'RS256'
    });
    const token = await signClientJwt(keyPair.privateKey, {
      subject: 'client-42',
      expirationTime: Math.floor(Date.now() / 1_000) + 300,
      claims: { role: 'member', groups: ['chat'] }
    });

    expect(await authenticate(token)).toEqual({ subject: 'client-42' });
  });

  it('rejects invalid client JWT signatures and claims', async () => {
    const trusted = await generateKeyPair('RS256');
    const untrusted = await generateKeyPair('RS256');
    const publicKeyPath = await writePublicKey(trusted.publicKey);
    const config = {
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      publicKeyPath,
      algorithm: 'RS256'
    };
    const authenticate = createJwtClientAuthenticator(config);
    const now = Math.floor(Date.now() / 1_000);
    const valid = {
      subject: 'client-42',
      expirationTime: now + 300
    };

    expect(await authenticate('x'.repeat(8_193))).toBeNull();
    expect(await authenticate(await signClientJwt(untrusted.privateKey, valid))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      ...valid,
      issuer: 'https://other.example.com/'
    }))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      ...valid,
      audience: 'another-service'
    }))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      expirationTime: now + 300
    }))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      subject: 'client-42'
    }))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      subject: 'client-42',
      expirationTime: now - 10
    }))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      ...valid,
      notBefore: now + 60
    }))).toBeNull();
    expect(await authenticate(await signClientJwt(trusted.privateKey, {
      ...valid,
      subject: 'x'.repeat(257)
    }))).toBeNull();
    expect(await createJwtClientAuthenticator({
      ...config,
      algorithm: 'PS256'
    })(await signClientJwt(trusted.privateKey, valid))).toBeNull();
  });

  it('rejects missing, malformed, and private key files at startup', async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    const config = {
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      algorithm: 'RS256'
    };
    const missingPath = temporaryPath('missing.pem');
    const malformedPath = temporaryPath('malformed.pem');
    const privateKeyPath = temporaryPath('client-jwt-private.pem');
    writeFileSync(malformedPath, 'not a public key');
    writeFileSync(privateKeyPath, await exportPKCS8(keyPair.privateKey));

    expect(() => createJwtClientAuthenticator({
      ...config,
      publicKeyPath: missingPath
    })).toThrow('Could not read');
    expect(() => createJwtClientAuthenticator({
      ...config,
      publicKeyPath: malformedPath
    })).toThrow('SPKI public key');
    expect(() => createJwtClientAuthenticator({
      ...config,
      publicKeyPath: privateKeyPath
    })).toThrow('SPKI public key');
  });
});
