import type { AppManifest } from '../platform/appContract.js';
import type { AppId } from '../shared/platform.js';
import { chatManifest } from '@citadel/app-chat';
import { chessManifest } from '@citadel/app-chess';
import { snakeManifest } from '@citadel/app-snake';

export const bundledAppIds = ['chat', 'chess', 'snake'] satisfies AppId[];

const bundledManifestsById = {
  chat: chatManifest,
  chess: chessManifest,
  snake: snakeManifest
} satisfies Record<AppId, AppManifest>;

export const bundledAppManifests: AppManifest[] = orderBundledAppEntries(bundledManifestsById);

export function getBundledAppManifest(appId: AppId): AppManifest | undefined {
  return bundledManifestsById[appId];
}

export function orderBundledAppEntries<T extends Record<AppId, { appId: AppId }>>(entriesById: T) {
  return bundledAppIds.map((appId) => entriesById[appId]) as Array<T[AppId]>;
}
