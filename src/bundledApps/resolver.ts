import type { AppId, AppPackageDescriptor } from '@citadel/platform/app';
import type { BundledAppPackageName } from './config.js';
import { bundledAppDescriptorByPackageName } from './generatedResolver.js';

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
