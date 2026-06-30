import type { AppManifest } from '@citadel/platform/app';

export const chessManifest = {
  appId: 'chess',
  label: 'Chess',
  defaultSpaceId: 'general',
  persistence: 'sqlite',
  version: '0.1.0'
} satisfies AppManifest;
