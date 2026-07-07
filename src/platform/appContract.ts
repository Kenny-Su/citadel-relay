import type { AppId } from './shared.js';

export type AppManifest = {
  appId: AppId;
  label: string;
  defaultSpaceId: string;
  persistence: 'none' | 'sqlite';
  version: string;
};

export type AppPackageDescriptor = {
  appId: AppId;
  manifest: AppManifest;
  packageName: string;
  client: {
    subpath: './client';
    registrationExport: string;
  };
  server: {
    subpath: './server';
    registrationExport: string;
  };
};
