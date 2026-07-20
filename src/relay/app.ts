export {
  DEFAULT_SPACE_ID,
  DISPLAY_NAME_MAX_LENGTH,
  GUEST_ID_MAX_LENGTH,
  GUEST_ID_PATTERN,
  SPACE_ID_MAX_LENGTH,
  SPACE_ID_PATTERN,
  normalizeGuestId,
  normalizeSpaceId,
  type ClientMessage,
  type ConnectionTarget,
  type JoinSpaceMessage,
  type LeaveSpaceMessage,
  type PacketTarget,
  type Participant,
  type ParticipantEvent,
  type RelayErrorMessage,
  type RelayPacketMessage,
  type ServerMessage,
  type SpacePacketMessage,
  type SpaceStateMessage
} from './shared.js';
export type { ValidationResult } from './validation.js';
