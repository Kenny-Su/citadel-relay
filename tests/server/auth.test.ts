import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type CryptoKey
} from 'jose';
import { describe, expect, it } from 'vitest';
import {
  PRE_SHARED_KEY_BYTES,
  createJwtClientAuthenticator,
  createPreSharedKeyAuthenticator,
  parsePreSharedKeyConfig,
  validateAuthenticatedPrincipal,
  validateClientJwtConfig,
  validatePreSharedKeyConfig,
  validateVerifiedClientIdentity
} from '../../src/relay/auth.js';

function testKey(fill: number) {
  return Buffer.alloc(PRE_SHARED_KEY_BYTES, fill).toString('hex');
}

function listen(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}

function close(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

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
  it('authenticates an app owner with an exact 256-bit pre-shared key', async () => {
    const chatKey = testKey(1);
    const authenticate = createPreSharedKeyAuthenticator({
      apps: [{
        name: 'chat-server',
        preSharedKey: chatKey,
        claimedPath: '/chat'
      }]
    });

    expect(await authenticate(chatKey)).toEqual({
      id: 'chat-server',
      name: 'chat-server',
      namespaceClaims: ['/chat']
    });
    expect(await authenticate(testKey(2))).toBeNull();
    expect(await authenticate('not-a-key')).toBeNull();
  });

  it('parses app config and rejects invalid or ambiguous ownership', () => {
    const key = testKey(3);
    expect(parsePreSharedKeyConfig(JSON.stringify({
      apps: [{ name: 'chat-server', preSharedKey: key, claimedPath: '/chat' }],
      clientJwt: {
        issuer: 'https://identity.example.com/',
        audience: 'citadel-relay',
        jwksUri: 'https://identity.example.com/.well-known/jwks.json',
        algorithms: ['RS256']
      }
    }))).toEqual({
      apps: [{ name: 'chat-server', preSharedKey: key, claimedPath: '/chat' }],
      clientJwt: {
        issuer: 'https://identity.example.com/',
        audience: 'citadel-relay',
        jwksUri: 'https://identity.example.com/.well-known/jwks.json',
        algorithms: ['RS256']
      }
    });

    expect(() => parsePreSharedKeyConfig('[]')).toThrow('apps array');
    expect(() => validatePreSharedKeyConfig({ apps: [] })).toThrow('non-empty');
    expect(() => validatePreSharedKeyConfig({
      apps: [{ name: 'chat-server', preSharedKey: 'too-short', claimedPath: '/chat' }]
    })).toThrow('32 random bytes');
    expect(() => validatePreSharedKeyConfig({
      apps: [
        { name: 'chat-server', preSharedKey: testKey(4), claimedPath: '/chat' },
        { name: 'other-server', preSharedKey: testKey(5), claimedPath: '/chat' }
      ]
    })).toThrow('assigned more than once');
    expect(() => validatePreSharedKeyConfig({
      apps: [{ name: 'chat-server', preSharedKey: testKey(6), claimedPath: '/chat' }]
    })).toThrow('Client JWT configuration must be an object');
    expect(() => validateAuthenticatedPrincipal({
      id: 'server',
      namespaceClaims: ['/chat/deep']
    })).toThrow('valid namespace paths');
    expect(() => validateClientJwtConfig({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      jwksUri: 'http://identity.example.com/jwks.json',
      algorithms: ['RS256']
    })).toThrow('must use HTTPS');
    expect(() => validateClientJwtConfig({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      jwksUri: 'https://identity.example.com/jwks.json',
      algorithms: ['HS256']
    })).toThrow('asymmetric algorithms');
    expect(() => validateClientJwtConfig({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      jwksUri: 'https://identity.example.com/jwks.json',
      algorithms: ['RS256', 'RS256']
    })).toThrow('duplicates');
    expect(validateVerifiedClientIdentity({
      issuer: 'https://identity.example.com/',
      subject: 'client-42',
      claims: { role: 'admin' }
    })).toEqual({ subject: 'client-42' });
    expect(() => validateVerifiedClientIdentity({
      subject: 'x'.repeat(257)
    })).toThrow('Client identity subjects');
  });

  it('verifies client JWT identity and selects keys from a remote JWKS', async () => {
    const first = await generateKeyPair('RS256');
    const second = await generateKeyPair('RS256');
    const keys = await Promise.all([
      exportJWK(first.publicKey),
      exportJWK(second.publicKey)
    ]);
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        keys: keys.map((key, index) => ({
          ...key,
          alg: 'RS256',
          kid: `key-${index + 1}`,
          use: 'sig'
        }))
      }));
    });
    await listen(server);

    try {
      const address = server.address() as AddressInfo;
      const authenticate = createJwtClientAuthenticator({
        issuer: 'https://identity.example.com/',
        audience: 'citadel-relay',
        jwksUri: `http://127.0.0.1:${address.port}/jwks.json`,
        algorithms: ['RS256']
      });
      const token = await signClientJwt(second.privateKey, {
        kid: 'key-2',
        subject: 'client-42',
        expirationTime: Math.floor(Date.now() / 1_000) + 300,
        claims: { role: 'member', groups: ['chat'] }
      });

      expect(await authenticate(token)).toEqual({ subject: 'client-42' });
    } finally {
      await close(server);
    }
  });

  it('rejects invalid client JWT signatures and claims', async () => {
    const trusted = await generateKeyPair('RS256');
    const untrusted = await generateKeyPair('RS256');
    const publicKey = await exportJWK(trusted.publicKey);
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        keys: [{ ...publicKey, alg: 'RS256', kid: 'key-1', use: 'sig' }]
      }));
    });
    await listen(server);

    try {
      const address = server.address() as AddressInfo;
      const config = {
        issuer: 'https://identity.example.com/',
        audience: 'citadel-relay',
        jwksUri: `http://127.0.0.1:${address.port}/jwks.json`,
        algorithms: ['RS256']
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
        algorithms: ['PS256']
      })(await signClientJwt(trusted.privateKey, valid))).toBeNull();
    } finally {
      await close(server);
    }
  });

  it('fails closed when the remote JWKS is unavailable', async () => {
    const keyPair = await generateKeyPair('RS256');
    const server = createServer();
    await listen(server);
    const address = server.address() as AddressInfo;
    await close(server);

    const authenticate = createJwtClientAuthenticator({
      issuer: 'https://identity.example.com/',
      audience: 'citadel-relay',
      jwksUri: `http://127.0.0.1:${address.port}/jwks.json`,
      algorithms: ['RS256']
    });
    const token = await signClientJwt(keyPair.privateKey, {
      subject: 'client-42',
      expirationTime: Math.floor(Date.now() / 1_000) + 300
    });

    expect(await authenticate(token)).toBeNull();
  });
});
