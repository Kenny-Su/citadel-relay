export const DISPLAY_NAME_MAX_LENGTH = 24;
export const DEFAULT_SPACE_ID = 'general';
export const SPACE_ID_MAX_LENGTH = 32;
export const SPACE_ID_PATTERN = /^[a-z0-9-]+$/;
export const GUEST_ID_MAX_LENGTH = 80;
export const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type PacketTarget = 'space' | 'others';

export type Participant = {
  id: string;
  connectionId: string;
  name: string;
};

export type JoinSpaceMessage = {
  type: 'space:join';
  spaceId?: string;
  guestId?: string;
  name: string;
};

export type SpacePacketMessage<TPayload = unknown> = {
  type: 'space:packet';
  topic?: string;
  payload?: TPayload;
  target?: PacketTarget;
};

export type LeaveSpaceMessage = {
  type: 'space:leave';
};

export type ClientMessage<TPayload = unknown> =
  | JoinSpaceMessage
  | SpacePacketMessage<TPayload>
  | LeaveSpaceMessage;

export type SpaceStateMessage = {
  type: 'space:state';
  spaceId: string;
  participants: Participant[];
};

export type ParticipantEvent = {
  type: 'participant:joined' | 'participant:left';
  spaceId: string;
  participant: Participant;
  createdAt: string;
};

export type RelayPacketMessage<TPayload = unknown> = {
  type: 'space:packet';
  spaceId: string;
  from: Participant;
  topic?: string;
  payload?: TPayload;
  createdAt: string;
};

export type RelayErrorMessage = {
  type: 'error:notice';
  message: string;
};

export type ServerMessage<TPayload = unknown> =
  | SpaceStateMessage
  | ParticipantEvent
  | RelayPacketMessage<TPayload>
  | RelayErrorMessage;

export function normalizeSpaceId(input: unknown): string {
  if (typeof input !== 'string') {
    return DEFAULT_SPACE_ID;
  }

  const value = input.trim().toLowerCase();

  if (!value || value.length > SPACE_ID_MAX_LENGTH || !SPACE_ID_PATTERN.test(value)) {
    return DEFAULT_SPACE_ID;
  }

  return value;
}

export function normalizeGuestId(input: unknown, fallback: string): string {
  if (typeof input !== 'string') {
    return fallback;
  }

  const value = input.trim();

  if (!value || value.length > GUEST_ID_MAX_LENGTH || !GUEST_ID_PATTERN.test(value)) {
    return fallback;
  }

  return value;
}
