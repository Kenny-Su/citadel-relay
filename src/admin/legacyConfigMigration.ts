import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  parseRelayConfig,
} from '../relay/auth.js';
import { RegistrationStore } from './registrationStore.js';

const CONFIG_FILE_MODE = 0o600;

export type PreparedRelayConfig = {
  migratedLegacyApps: number;
};

export function prepareRelayConfig(
  configPath: string,
  registrationStore: RegistrationStore
): PreparedRelayConfig {
  const source = readFileSync(configPath, 'utf8');
  const config = parseRelayConfig(source);
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const migration = registrationStore.migrateLegacyApps(config.apps);

  if (config.apps.length > 0) {
    for (const legacy of config.apps) {
      if (registrationStore.authenticate(legacy.preSharedKey)?.appId !== legacy.appId) {
        throw new Error(
          `Legacy registration migration could not verify app "${legacy.appId}".`
        );
      }
    }
    delete parsed.apps;
    rewriteConfig(configPath, parsed);
  }

  return {
    migratedLegacyApps: migration.importedCount
  };
}

function rewriteConfig(configPath: string, config: Record<string, unknown>): void {
  const directory = dirname(configPath);
  const temporaryPath = join(
    directory,
    `.${basename(configPath)}.${randomBytes(8).toString('hex')}.tmp`
  );

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: CONFIG_FILE_MODE
    });
    chmodSync(temporaryPath, CONFIG_FILE_MODE);
    renameSync(temporaryPath, configPath);
    chmodSync(configPath, CONFIG_FILE_MODE);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already have moved.
    }
    throw error;
  }
}
