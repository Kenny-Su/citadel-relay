import { describe, expect, it } from 'vitest';
import {
  PRE_SHARED_KEY_BYTES,
  createPreSharedKeyAuthenticator,
  parsePreSharedKeyConfig
} from '../../src/relay/auth.js';

function testKey(fill: number) {
  return Buffer.alloc(PRE_SHARED_KEY_BYTES, fill).toString('hex');
}

describe('app owner authentication', () => {
  it('authenticates an app owner from PSK config', async () => {
    const key = testKey(1);
    const authenticate = createPreSharedKeyAuthenticator({
      apps: [{ name: 'chat-server', preSharedKey: key, claimedPath: '/chat' }]
    });

    expect(await authenticate(key)).toEqual({
      id: 'chat-server',
      name: 'chat-server',
      namespaceClaims: ['/chat']
    });
    expect(await authenticate(testKey(2))).toBeNull();
  });

  it('rejects duplicate ownership and malformed config', () => {
    expect(() => parsePreSharedKeyConfig('[]')).toThrow('apps array');
    expect(() => parsePreSharedKeyConfig(JSON.stringify({
      apps: [
        { name: 'chat', preSharedKey: testKey(3), claimedPath: '/chat' },
        { name: 'other', preSharedKey: testKey(4), claimedPath: '/chat' }
      ]
    }))).toThrow('assigned more than once');
  });
});
