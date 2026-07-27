export type RelayApp = {
  appId: string;
  connected: boolean;
  clients: number;
  pendingClients: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminSession = {
  csrfToken: string;
  expiresAt: string;
};

export type AppCredential = {
  app: RelayApp;
  preSharedKey: string;
};

export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown;
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = text.length > 0 ? text : undefined;
  }

  if (!response.ok) {
    throw new AdminApiError(errorMessage(payload, response.status), response.status);
  }

  return payload as T;
}

function errorMessage(payload: unknown, status: number) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  if (isRecord(payload)) {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
    if (
      isRecord(payload.error)
      && typeof payload.error.message === 'string'
      && payload.error.message.trim()
    ) {
      return payload.error.message;
    }
  }

  if (status === 401) return 'Your admin session is no longer valid.';
  if (status === 403) return 'The relay rejected this protected action.';
  if (status === 409) return 'An app with this ID is already registered.';
  return 'The relay could not complete this request.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createSession(passphrase: string) {
  return request<AdminSession>('/admin/api/session', {
    method: 'POST',
    body: JSON.stringify({ passphrase })
  });
}

export function getSession() {
  return request<AdminSession>('/admin/api/session');
}

export function deleteSession(csrfToken: string) {
  return request<void>('/admin/api/session', {
    method: 'DELETE'
  }, csrfToken);
}

export function listApps() {
  return request<RelayApp[]>('/admin/api/apps');
}

export function createApp(appId: string, csrfToken: string) {
  return request<AppCredential>('/admin/api/apps', {
    method: 'POST',
    body: JSON.stringify({ appId })
  }, csrfToken);
}

export function rotateAppKey(appId: string, csrfToken: string) {
  return request<AppCredential>(
    `/admin/api/apps/${encodeURIComponent(appId)}/rotate-key`,
    { method: 'POST' },
    csrfToken
  );
}

export function deleteApp(appId: string, csrfToken: string) {
  return request<void>(
    `/admin/api/apps/${encodeURIComponent(appId)}`,
    { method: 'DELETE' },
    csrfToken
  );
}
