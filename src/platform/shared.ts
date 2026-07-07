export const DISPLAY_NAME_MAX_LENGTH = 24;
export const DEFAULT_SPACE_ID = 'general';
export const SPACE_ID_MAX_LENGTH = 32;
export const SPACE_ID_PATTERN = /^[a-z0-9-]+$/;
export const GUEST_ID_MAX_LENGTH = 80;
export const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export const APP_ID_MAX_LENGTH = 64;
export const APP_ID_PATTERN = /^[a-z0-9-]+$/;

export type AppId = string;

export type Participant = {
  id: string;
  socketId?: string;
  name: string;
};

export type SpaceState<TAppState = unknown> = {
  appId: AppId;
  spaceId: string;
  participants: Participant[];
  appState: TAppState;
};

export type JoinSpacePayload = {
  appId: AppId;
  spaceId?: string;
  guestId?: string;
  name: string;
};

export type PlatformErrorPayload = {
  message: string;
};

export type ParticipantEvent = {
  id: string;
  type: 'participant:joined' | 'participant:left';
  appId: AppId;
  spaceId: string;
  participant: Participant;
  createdAt: string;
};

export type AppEventEnvelope<TPayload = unknown> = {
  appId: AppId;
  type: string;
  payload?: TPayload;
};

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

export function isAppId(value: unknown): value is AppId {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= APP_ID_MAX_LENGTH &&
    APP_ID_PATTERN.test(value)
  );
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
