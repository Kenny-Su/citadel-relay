import type { ComponentType } from 'react';
import type { AppId, Participant } from './shared.js';

export type AppViewProps<TState = unknown> = {
  currentParticipant: Participant;
  spaceId: string;
  participants: Participant[];
  appState: TState;
  sendAppEvent(type: string, payload?: unknown): void;
  setNotice(message: string): void;
};

export type ClientAppModule<TState = unknown> = {
  appId: AppId;
  label: string;
  defaultSpaceId: string;
  View: ComponentType<AppViewProps<TState>>;
};

export type ClientAppRegistration<TState = unknown> = {
  appId: AppId;
  clientApp: ClientAppModule<TState>;
};
