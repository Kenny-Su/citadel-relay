export const DISPLAY_NAME_MAX_LENGTH = 24;
export const MESSAGE_MAX_LENGTH = 500;
export const MESSAGE_HISTORY_LIMIT = 100;
export const DEFAULT_ROOM_ID = 'general';
export const ROOM_ID_MAX_LENGTH = 32;
export const ROOM_ID_PATTERN = /^[a-z0-9-]+$/;

export type User = {
  id: string;
  name: string;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
};

export type SystemEvent = {
  id: string;
  type: 'user:joined' | 'user:left';
  user: User;
  createdAt: string;
};

export type TimelineItem =
  | ({ kind: 'message' } & ChatMessage)
  | ({ kind: 'system' } & SystemEvent);

export type RoomState = {
  roomId: string;
  users: User[];
  messages: ChatMessage[];
};

export type JoinPayload = {
  name: string;
  roomId?: string;
};

export type SendMessagePayload = {
  body: string;
};

export type ServerErrorPayload = {
  message: string;
};

export function normalizeRoomId(input: unknown): string {
  if (typeof input !== 'string') {
    return DEFAULT_ROOM_ID;
  }

  const value = input.trim().toLowerCase();

  if (!value || value.length > ROOM_ID_MAX_LENGTH || !ROOM_ID_PATTERN.test(value)) {
    return DEFAULT_ROOM_ID;
  }

  return value;
}
