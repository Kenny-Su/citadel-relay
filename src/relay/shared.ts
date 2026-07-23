export const APP_ID_MAX_LENGTH = 128;
export const APP_ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;

export type AuthenticatedAppServer = {
  appId: string;
};

export type VerifiedClientIdentity = {
  subject: string;
};

export type JwtClientCredential = {
  type: 'jwt';
  token: string;
};

export type ConnectionTarget = {
  connectionId: string;
};

export type AppClientState = 'pending' | 'admitted';

export type AppServerAuthenticateMessage = {
  type: 'app:authenticate';
  token: string;
};

export type OpenAppMessage<THello = unknown> = {
  type: 'app:open';
  appId: string;
  credential: JwtClientCredential;
  hello?: THello;
};

export type CloseAppMessage = {
  type: 'app:close';
};

export type AcceptAppClientMessage = {
  type: 'app:accept';
  requestId: string;
};

export type RejectAppClientMessage = {
  type: 'app:reject';
  requestId: string;
  message?: string;
};

export type RevokeAppClientMessage = {
  type: 'app:revoke';
  connectionId: string;
  message?: string;
};

export type ClientPacketMessage<TPayload = unknown> = {
  type: 'client:packet';
  payload?: TPayload;
};

export type ServerPacketTarget = 'all' | ConnectionTarget;

export type ServerPacketMessage<TPayload = unknown> = {
  type: 'server:packet';
  target: ServerPacketTarget;
  payload?: TPayload;
};

export type RelayInboundMessage<TPayload = unknown> =
  | AppServerAuthenticateMessage
  | OpenAppMessage
  | CloseAppMessage
  | AcceptAppClientMessage
  | RejectAppClientMessage
  | RevokeAppClientMessage
  | ClientPacketMessage<TPayload>
  | ServerPacketMessage<TPayload>;

export type AppServerReadyMessage = {
  type: 'app:ready';
  appId: string;
};

export type AppClientStateMessage = {
  type: 'app:state';
  state: 'pending' | 'admitted' | 'rejected' | 'closed';
  connectionId: string;
  message?: string;
};

export type AppConnectMessage<THello = unknown> = {
  type: 'app:connect';
  requestId: string;
  connectionId: string;
  identity: VerifiedClientIdentity;
  hello?: THello;
};

export type AppDisconnectMessage = {
  type: 'app:disconnect';
  connectionId: string;
  admitted: boolean;
  reason: 'client-closed' | 'client-disconnected' | 'admission-timeout';
  identity: VerifiedClientIdentity;
};

export type RelayClientPacketMessage<TPayload = unknown> = {
  type: 'client:packet';
  from: {
    connectionId: string;
    state: AppClientState;
    identity: VerifiedClientIdentity;
  };
  payload?: TPayload;
};

export type RelayServerPacketMessage<TPayload = unknown> = {
  type: 'server:packet';
  payload?: TPayload;
};

export type RelayErrorMessage = {
  type: 'error:notice';
  message: string;
};

export type RelayOutboundMessage<TPayload = unknown> =
  | AppServerReadyMessage
  | AppClientStateMessage
  | AppConnectMessage
  | AppDisconnectMessage
  | RelayClientPacketMessage<TPayload>
  | RelayServerPacketMessage<TPayload>
  | RelayErrorMessage;

export function isAppId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= APP_ID_MAX_LENGTH
    && APP_ID_PATTERN.test(value);
}
