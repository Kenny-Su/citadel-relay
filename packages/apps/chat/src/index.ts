import type { AppPackageDescriptor } from '@citadel/platform/app';
import { chatManifest } from './manifest.js';

export { chatManifest } from './manifest.js';
export {
  MESSAGE_HISTORY_LIMIT,
  MESSAGE_MAX_LENGTH
} from './shared.js';
export type {
  ChatMessage,
  ChatState,
  ChatSystemEvent,
  ChatTimelineItem,
  SendMessagePayload,
  TypingUpdatePayload
} from './shared.js';

export const chatAppPackage = {
  appId: chatManifest.appId,
  manifest: chatManifest,
  packageName: '@citadel/app-chat',
  client: {
    subpath: './client',
    registrationExport: 'chatClientRegistration'
  },
  server: {
    subpath: './server',
    registrationExport: 'chatServerRegistration'
  }
} satisfies AppPackageDescriptor;
