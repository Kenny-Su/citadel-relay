export const bundledAppPackageNames = [
  '@citadel/app-chat',
  '@citadel/app-chess',
  '@citadel/app-snake'
] as const;

export type BundledAppPackageName = (typeof bundledAppPackageNames)[number];
