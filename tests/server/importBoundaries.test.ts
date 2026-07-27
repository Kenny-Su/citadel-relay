import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as relayContract from '../../src/relay/app.js';
import * as serverRuntime from '../../src/relay/server.js';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function sortedExportKeys(module: Record<string, unknown>) {
  return Object.keys(module).sort();
}

describe('relay server import boundaries', () => {
  it('keeps the relay core isolated from the admin control plane', () => {
    const relayDirectory = join(process.cwd(), 'src/relay');
    const relaySources = readdirSync(relayDirectory)
      .filter((fileName) => fileName.endsWith('.ts'));

    for (const fileName of relaySources) {
      expect(readFileSync(join(relayDirectory, fileName), 'utf8')).not.toMatch(
        /(?:from\s+|import\s*\()\s*['"]\.\.\/(?:admin|server)(?:\/|['"])/
      );
    }
  });

  it('exports relay contracts and runtime values', () => {
    expect(sortedExportKeys(relayContract)).toEqual([
      'APP_ID_MAX_LENGTH',
      'APP_ID_PATTERN',
      'AUTH_TOKEN_MAX_LENGTH',
      'CLIENT_JWT_CLOCK_TOLERANCE_SECONDS',
      'CLIENT_SUBJECT_MAX_LENGTH',
      'PRE_SHARED_KEY_BYTES',
      'PRE_SHARED_KEY_ENCODED_LENGTH',
      'createAppServerAuthenticator',
      'createJwtClientAuthenticator',
      'isAppId',
      'parseRelayConfig',
      'validateAuthenticatedAppServer',
      'validateClientJwtConfig',
      'validateRelayConfig',
      'validateVerifiedClientIdentity'
    ].sort());
    expect(sortedExportKeys(serverRuntime)).toEqual(['createRelayServer']);
  });

  it('keeps JWT signing and private keys out of the relay control plane', () => {
    const adminApi = source('src/admin/adminApi.ts');
    const startup = source('src/server/index.ts');
    const exampleConfig = source('relay.config.example.json');

    for (const content of [adminApi, startup, exampleConfig]) {
      expect(content).not.toContain('SignJWT');
      expect(content).not.toContain('privateKeyPath');
      expect(content).not.toContain('/tokens');
    }
    expect(exampleConfig).toContain('publicKeyPath');
  });
});
