export const NAMESPACE_MAX_LENGTH = 128;
export const NAMESPACE_PATTERN = /^\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;

export type AuthenticatedPrincipal = {
  id: string;
  name?: string;
  namespaceClaims?: string[];
};

export type PublicPrincipal = Pick<AuthenticatedPrincipal, 'id' | 'name'>;

export type VerifiedClientIdentity = {
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
};

export type JwtClientCredential = {
  type: 'jwt';
  token: string;
};

export type ConnectionTarget = {
  connectionId: string;
};

export type ClientState = 'pending' | 'admitted';

export type AuthenticateMessage = {
  type: 'auth:authenticate';
  token: string;
};

export type ClaimNamespaceMessage = {
  type: 'namespace:claim';
  namespace: string;
};

export type ReleaseNamespaceMessage = {
  type: 'namespace:release';
  namespace: string;
};

export type OpenNamespaceMessage<THello = unknown> = {
  type: 'namespace:open';
  namespace: string;
  credential: JwtClientCredential;
  hello?: THello;
};

export type CloseNamespaceMessage = {
  type: 'namespace:close';
};

export type AcceptNamespaceClientMessage = {
  type: 'namespace:accept';
  requestId: string;
};

export type RejectNamespaceClientMessage = {
  type: 'namespace:reject';
  requestId: string;
  message?: string;
};

export type RevokeNamespaceClientMessage = {
  type: 'namespace:revoke';
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
  namespace: string;
  target: ServerPacketTarget;
  payload?: TPayload;
};

export type ClientMessage<TPayload = unknown> =
  | AuthenticateMessage
  | ClaimNamespaceMessage
  | ReleaseNamespaceMessage
  | OpenNamespaceMessage
  | CloseNamespaceMessage
  | AcceptNamespaceClientMessage
  | RejectNamespaceClientMessage
  | RevokeNamespaceClientMessage
  | ClientPacketMessage<TPayload>
  | ServerPacketMessage<TPayload>;

export type AuthenticationStateMessage = {
  type: 'auth:state';
  principal: PublicPrincipal;
};

export type NamespaceClaimedMessage = {
  type: 'namespace:claimed' | 'namespace:released';
  namespace: string;
};

export type NamespaceClientStateMessage = {
  type: 'namespace:state';
  namespace: string;
  state: 'pending' | 'admitted' | 'rejected' | 'closed';
  connectionId: string;
  message?: string;
};

export type NamespaceConnectMessage<THello = unknown> = {
  type: 'namespace:connect';
  requestId: string;
  namespace: string;
  connectionId: string;
  identity: VerifiedClientIdentity;
  hello?: THello;
};

export type NamespaceDisconnectMessage = {
  type: 'namespace:disconnect';
  namespace: string;
  connectionId: string;
  admitted: boolean;
  reason: 'client-closed' | 'client-disconnected' | 'admission-timeout';
  identity: VerifiedClientIdentity;
};

export type RelayClientPacketMessage<TPayload = unknown> = {
  type: 'client:packet';
  namespace: string;
  from: {
    connectionId: string;
    state: ClientState;
    identity: VerifiedClientIdentity;
  };
  payload?: TPayload;
};

export type RelayServerPacketMessage<TPayload = unknown> = {
  type: 'server:packet';
  namespace: string;
  payload?: TPayload;
};

export type RelayErrorMessage = {
  type: 'error:notice';
  message: string;
};

export type ServerMessage<TPayload = unknown> =
  | AuthenticationStateMessage
  | NamespaceClaimedMessage
  | NamespaceClientStateMessage
  | NamespaceConnectMessage
  | NamespaceDisconnectMessage
  | RelayClientPacketMessage<TPayload>
  | RelayServerPacketMessage<TPayload>
  | RelayErrorMessage;

export function isNamespace(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= NAMESPACE_MAX_LENGTH
    && NAMESPACE_PATTERN.test(value);
}
