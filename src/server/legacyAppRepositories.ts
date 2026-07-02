import {
  resolveChatRepository,
  type ChatRateLimitOptions,
  type ChatRepository,
  type MessageStore
} from '@citadel/app-chat/server';
import {
  resolveChessRepository,
  type ChessRepository
} from '@citadel/app-chess/server';
import type { AppId, AppPackageDescriptor } from '@citadel/platform/app';
import type { CitadelDatabase } from '@citadel/platform/persistence';
import { bundledInstalledApps } from '../bundledApps/generatedAppCatalog.js';

export type LegacyAppRepositoryOptions = {
  database: CitadelDatabase;
  chatRepository?: ChatRepository;
  chessRepository?: ChessRepository;
  messageStore?: MessageStore;
  messageRateLimit?: ChatRateLimitOptions;
};

export type LegacyAppRepositories = {
  chatRepository: ChatRepository;
  chessRepository: ChessRepository;
  messageStore: MessageStore;
};

export type LegacyAppRepositoryOptionFields = Omit<LegacyAppRepositoryOptions, 'database'>;

export type {
  ChatRepository,
  ChessRepository,
  MessageStore
};

const legacyServiceResolvers = {
  chatRepository: (repositories: LegacyAppRepositories) => repositories.chatRepository,
  chessRepository: (repositories: LegacyAppRepositories) => repositories.chessRepository,
  messageStore: (repositories: LegacyAppRepositories) => repositories.messageStore,
  messageRateLimit: (_repositories: LegacyAppRepositories, options: LegacyAppRepositoryOptionFields) => (
    options.messageRateLimit
  )
} satisfies Record<string, (
  repositories: LegacyAppRepositories,
  options: LegacyAppRepositoryOptionFields
) => unknown>;

type LegacyServiceName = keyof typeof legacyServiceResolvers;

export function resolveLegacyAppRepositories(options: LegacyAppRepositoryOptions): LegacyAppRepositories {
  const chatRepository = resolveChatRepository(options);
  const chessRepository = resolveChessRepository(options);

  return {
    chatRepository,
    chessRepository,
    messageStore: chatRepository
  };
}

export function readLegacyAppRepositoryOptions(options: unknown): LegacyAppRepositoryOptionFields {
  if (!options || typeof options === 'string') {
    return {};
  }

  const legacyOptions = options as LegacyAppRepositoryOptionFields;

  return {
    chatRepository: legacyOptions.chatRepository,
    chessRepository: legacyOptions.chessRepository,
    messageStore: legacyOptions.messageStore,
    messageRateLimit: legacyOptions.messageRateLimit
  };
}

export function createLegacyAppServiceBag(
  repositories: LegacyAppRepositories,
  options: LegacyAppRepositoryOptionFields,
  enabledAppIds?: AppId[]
): Record<string, unknown> {
  const services: Record<string, unknown> = {};
  const legacyServiceNames = getLegacyServiceNames(getLegacyAppDescriptors(enabledAppIds));

  for (const serviceName of legacyServiceNames) {
    services[serviceName] = legacyServiceResolvers[serviceName](repositories, options);
  }

  return services;
}

export function getLegacyAppDescriptors(
  enabledAppIds?: AppId[]
): Pick<AppPackageDescriptor, 'appId' | 'capabilities'>[] {
  if (!enabledAppIds) {
    return bundledInstalledApps.map((app) => app.descriptor);
  }

  const descriptors: Pick<AppPackageDescriptor, 'appId' | 'capabilities'>[] = [];

  for (const appId of enabledAppIds) {
    const installedApp = bundledInstalledApps.find((app) => app.descriptor.appId === appId);

    if (installedApp) {
      descriptors.push(installedApp.descriptor);
    }
  }

  return descriptors;
}

export function getLegacyServiceNames(
  appDescriptors: Pick<AppPackageDescriptor, 'appId' | 'capabilities'>[] = bundledInstalledApps.map(
    (app) => app.descriptor
  )
): LegacyServiceName[] {
  const legacyServiceNames: LegacyServiceName[] = [];
  const seen = new Set<string>();

  for (const descriptor of appDescriptors) {
    for (const serviceName of descriptor.capabilities.legacyServices) {
      if (!isLegacyServiceName(serviceName)) {
        throw new Error(
          `Unsupported legacy app service capability "${serviceName}" declared by app "${descriptor.appId}"`
        );
      }

      if (!seen.has(serviceName)) {
        legacyServiceNames.push(serviceName);
        seen.add(serviceName);
      }
    }
  }

  return legacyServiceNames;
}

function isLegacyServiceName(serviceName: string): serviceName is LegacyServiceName {
  return serviceName in legacyServiceResolvers;
}
