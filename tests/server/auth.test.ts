import { describe, expect, it } from 'vitest';
import {
  PRE_SHARED_KEY_BYTES,
  createPreSharedKeyAuthenticator,
  parsePreSharedKeyConfig,
  validateAuthenticatedPrincipal,
  validatePreSharedKeyConfig
} from '../../src/relay/auth.js';

function testKey(fill: number) {
  return Buffer.alloc(PRE_SHARED_KEY_BYTES, fill).toString('hex');
}

describe('app owner authentication', () => {
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
      apps: [{ name: 'chat-server', preSharedKey: key, claimedPath: '/chat' }]
    }))).toEqual({
      apps: [{ name: 'chat-server', preSharedKey: key, claimedPath: '/chat' }]
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
    expect(() => validateAuthenticatedPrincipal({
      id: 'server',
      namespaceClaims: ['/chat/deep']
    })).toThrow('valid namespace paths');
  });
});
