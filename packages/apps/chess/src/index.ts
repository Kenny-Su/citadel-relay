import { generatedAppPackage } from './generatedMetadata.js';

export { chessManifest } from './manifest.js';
export type {
  ChessColor,
  ChessMovePayload,
  ChessPlayerMap,
  ChessState
} from './shared.js';

export const chessAppPackage = generatedAppPackage;
