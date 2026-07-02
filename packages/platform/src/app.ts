export type { AppManifest, AppPackageDescriptor } from './appContract.js';
export {
  DEFAULT_SPACE_ID,
  APP_ID_MAX_LENGTH,
  APP_ID_PATTERN,
  DISPLAY_NAME_MAX_LENGTH,
  GUEST_ID_MAX_LENGTH,
  GUEST_ID_PATTERN,
  SPACE_ID_MAX_LENGTH,
  SPACE_ID_PATTERN,
  isAppId,
  normalizeGuestId,
  normalizeSpaceId,
  type AppEventEnvelope,
  type AppId,
  type JoinSpacePayload,
  type Participant,
  type ParticipantEvent,
  type PlatformErrorPayload,
  type SpaceState
} from './shared.js';
export type { ValidationResult } from './validation.js';
