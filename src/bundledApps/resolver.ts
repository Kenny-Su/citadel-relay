import type { AppId, AppPackageDescriptor } from '@citadel/platform/app';
import { chatAppPackage } from '@citadel/app-chat';
import { chessAppPackage } from '@citadel/app-chess';
import { snakeAppPackage } from '@citadel/app-snake';
import type { BundledAppPackageName } from './config.js';

const bundledAppDescriptorByPackageName = {
  '@citadel/app-chat': chatAppPackage,
  '@citadel/app-chess': chessAppPackage,
  '@citadel/app-snake': snakeAppPackage
} satisfies Record<BundledAppPackageName, AppPackageDescriptor>;

export function resolveBundledAppDefinitions(
  packageNames: readonly BundledAppPackageName[]
): AppPackageDescriptor[] {
  const seenAppIds = new Set<AppId>();

  return packageNames.map((packageName) => {
    const descriptor = bundledAppDescriptorByPackageName[packageName];

    if (!descriptor) {
      throw new Error(`Unknown bundled app package: ${packageName}`);
    }

    if (descriptor.packageName !== packageName) {
      throw new Error(
        `Bundled app package mismatch: configured ${packageName}, descriptor declares ${descriptor.packageName}`
      );
    }

    if (seenAppIds.has(descriptor.appId)) {
      throw new Error(`Duplicate bundled app id: ${descriptor.appId}`);
    }

    seenAppIds.add(descriptor.appId);
    return descriptor;
  });
}
