import type { AppEventEnvelope, AppId, Participant } from './shared.js';

export type ServerAppContext = {
  appId: AppId;
  spaceId: string;
  socketId: string;
  participant: Participant;
  participants: Participant[];
  emitToSpace(type: string, payload?: unknown): void;
  emitToParticipant(type: string, payload?: unknown): void;
  emitSpaceState(): void;
  getAppState<T>(): T | undefined;
  setAppState<T>(state: T): void;
  clearAppState(): void;
};

export type ServerAppModule = {
  appId: AppId;
  getInitialState(context: Omit<ServerAppContext, 'participant' | 'socketId'>): unknown;
  handleEvent(context: ServerAppContext, event: AppEventEnvelope): void;
  onParticipantJoined?(context: ServerAppContext): void;
  onParticipantLeft?(context: ServerAppContext): void;
};

export type ServerAppBundle<TServices> = {
  appId: AppId;
  createServerApp(services: TServices): ServerAppModule;
};

export type ServerAppRegistration<TServices> = {
  appId: AppId;
  bundle: ServerAppBundle<TServices>;
  createServerApp(services: TServices): ServerAppModule;
};
