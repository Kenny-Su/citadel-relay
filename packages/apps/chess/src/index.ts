import type { AppPackageDescriptor } from '@citadel/platform/app';
import { chessManifest } from './manifest.js';

export { chessManifest } from './manifest.js';
export type {
  ChessColor,
  ChessMovePayload,
  ChessPlayerMap,
  ChessState
} from './shared.js';

export const chessAppPackage = {
  appId: chessManifest.appId,
  manifest: chessManifest,
  packageName: '@citadel/app-chess',
  client: {
    subpath: './client',
    registrationExport: 'chessClientRegistration'
  },
  server: {
    subpath: './server',
    registrationExport: 'chessServerRegistration'
  }
} satisfies AppPackageDescriptor;
