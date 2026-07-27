import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import type { RelayAppStatus } from '../relay/server.js';
import {
  RegistrationStore,
  RegistrationStoreError,
  type AppRegistration
} from './registrationStore.js';

const ADMIN_COOKIE_NAME = 'citadel_admin_session';
const SESSION_TTL_MILLISECONDS = 8 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_TRACKED_ADDRESS_LIMIT = 10_000;
const PASSPHRASE_MIN_LENGTH = 16;

type AdminSession = {
  csrfToken: string;
  expiresAt: number;
};

type LoginAttempt = {
  failures: number;
  windowStartedAt: number;
};

export type AdminRuntime = {
  getAppStatus(appId: string): RelayAppStatus;
  disconnectApp(appId: string): boolean;
};

export type AdminApiOptions = {
  passphrase: string;
  registrationStore: RegistrationStore;
  runtime: AdminRuntime;
  secureCookies?: boolean;
  now?: () => number;
  sessionTtlMilliseconds?: number;
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export function mountAdminApi(app: Express, options: AdminApiOptions): void {
  if (options.passphrase.length < PASSPHRASE_MIN_LENGTH) {
    throw new Error(
      `RELAY_ADMIN_PASSPHRASE must be at least ${PASSPHRASE_MIN_LENGTH} characters.`
    );
  }

  const router = express.Router();
  const sessions = new Map<string, AdminSession>();
  const loginAttempts = new Map<string, LoginAttempt>();
  const now = options.now ?? Date.now;
  const sessionTtl = options.sessionTtlMilliseconds ?? SESSION_TTL_MILLISECONDS;
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const expectedPassphraseDigest = digest(options.passphrase);

  router.use((_request, response, next) => {
    applyAdminSecurityHeaders(response);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    next();
  });
  router.use(express.json({ limit: '8kb', strict: true }));

  router.post('/session', requireSameOrigin, (request, response) => {
    const remoteAddress = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const currentTime = now();
    removeExpiredLoginAttempts(loginAttempts, currentTime);
    const attempt = loginAttempts.get(remoteAddress);
    if (
      attempt
      && attempt.failures >= LOGIN_MAX_FAILURES
    ) {
      response.setHeader(
        'Retry-After',
        String(Math.ceil(
          (LOGIN_WINDOW_MILLISECONDS - (currentTime - attempt.windowStartedAt)) / 1_000
        ))
      );
      sendError(response, 429, 'LOGIN_RATE_LIMITED', 'Too many failed login attempts.');
      return;
    }

    const passphrase = readStringProperty(request.body, 'passphrase');
    if (!passphrase || !timingSafeEqual(digest(passphrase), expectedPassphraseDigest)) {
      recordLoginFailure(loginAttempts, remoteAddress, currentTime);
      sendError(response, 401, 'INVALID_CREDENTIALS', 'The admin passphrase is invalid.');
      return;
    }

    loginAttempts.delete(remoteAddress);
    removeExpiredSessions(sessions, currentTime);
    const sessionToken = randomBytes(32).toString('base64url');
    const session: AdminSession = {
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt: currentTime + sessionTtl
    };
    sessions.set(digestText(sessionToken), session);
    response.setHeader(
      'Set-Cookie',
      serializeSessionCookie(sessionToken, session.expiresAt, currentTime, secureCookies)
    );
    response.json(sessionResponse(session));
  });

  router.get('/session', authenticateSession, (request, response) => {
    response.json(sessionResponse(adminSession(request)));
  });

  router.use(authenticateSession);

  router.delete('/session', requireSameOrigin, requireCsrf, (request, response) => {
    const sessionToken = readCookie(request, ADMIN_COOKIE_NAME);
    if (sessionToken) sessions.delete(digestText(sessionToken));
    response.setHeader('Set-Cookie', clearSessionCookie(secureCookies));
    response.status(204).end();
  });

  router.get('/apps', (_request, response) => {
    response.json(options.registrationStore.list().map((registration) => (
      appSummary(registration, options.runtime)
    )));
  });

  router.post('/apps', requireSameOrigin, requireCsrf, (request, response) => {
    const appId = readStringProperty(request.body, 'appId');
    if (appId === null) {
      sendError(response, 400, 'INVALID_REQUEST', 'appId must be a string.');
      return;
    }

    const created = options.registrationStore.create(appId);
    const { preSharedKey, ...registration } = created;
    response.status(201).json({
      app: appSummary(registration, options.runtime),
      preSharedKey
    });
  });

  router.post(
    '/apps/:appId/rotate-key',
    requireSameOrigin,
    requireCsrf,
    (request, response) => {
      const rotated = options.registrationStore.rotateKey(pathAppId(request));
      options.runtime.disconnectApp(rotated.appId);
      const { preSharedKey, ...registration } = rotated;
      response.json({
        app: appSummary(registration, options.runtime),
        preSharedKey
      });
    }
  );

  router.delete(
    '/apps/:appId',
    requireSameOrigin,
    requireCsrf,
    (request, response) => {
      const appId = pathAppId(request);
      if (!options.registrationStore.delete(appId)) {
        throw new RegistrationStoreError(
          'APP_NOT_FOUND',
          `No app registration exists for "${appId}".`
        );
      }
      options.runtime.disconnectApp(appId);
      response.status(204).end();
    }
  );

  router.use((_request, response) => {
    sendError(response, 404, 'NOT_FOUND', 'Admin API route not found.');
  });

  router.use((
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction
  ) => {
    if (error instanceof RegistrationStoreError) {
      const status = error.code === 'APP_EXISTS'
        ? 409
        : error.code === 'APP_NOT_FOUND'
          ? 404
          : 400;
      sendError(response, status, error.code, error.message);
      return;
    }

    if (error instanceof SyntaxError) {
      sendError(response, 400, 'INVALID_JSON', 'The request body must be valid JSON.');
      return;
    }

    sendError(response, 500, 'INTERNAL_ERROR', 'The admin operation failed.');
  });

  app.use('/admin/api', router);

  function authenticateSession(
    request: Request,
    response: Response,
    next: NextFunction
  ): void {
    const currentTime = now();
    removeExpiredSessions(sessions, currentTime);
    const sessionToken = readCookie(request, ADMIN_COOKIE_NAME);
    const session = sessionToken
      ? sessions.get(digestText(sessionToken))
      : undefined;

    if (!session) {
      response.setHeader('Set-Cookie', clearSessionCookie(secureCookies));
      sendError(response, 401, 'AUTHENTICATION_REQUIRED', 'Admin authentication is required.');
      return;
    }

    response.locals.adminSession = session;
    next();
  }
}

function requireSameOrigin(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const origin = request.get('origin');
  const host = request.get('host');
  if (!origin || !host) {
    sendError(response, 403, 'INVALID_ORIGIN', 'A same-origin request is required.');
    return;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    sendError(response, 403, 'INVALID_ORIGIN', 'A same-origin request is required.');
    return;
  }

  if (parsedOrigin.origin !== `${request.protocol}://${host}`) {
    sendError(response, 403, 'INVALID_ORIGIN', 'A same-origin request is required.');
    return;
  }
  next();
}

function requireCsrf(request: Request, response: Response, next: NextFunction): void {
  const csrfToken = request.get('x-csrf-token');
  const session = adminSession(request);
  if (
    !csrfToken
    || !timingSafeEqual(digest(csrfToken), digest(session.csrfToken))
  ) {
    sendError(response, 403, 'INVALID_CSRF_TOKEN', 'The CSRF token is invalid.');
    return;
  }
  next();
}

function adminSession(request: Request): AdminSession {
  return request.res?.locals.adminSession as AdminSession;
}

function appSummary(registration: AppRegistration, runtime: AdminRuntime) {
  return {
    ...runtime.getAppStatus(registration.appId),
    createdAt: registration.createdAt,
    updatedAt: registration.rotatedAt ?? registration.createdAt
  };
}

function pathAppId(request: Request): string {
  const value = request.params.appId;
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function readStringProperty(input: unknown, property: string): string | null {
  if (
    typeof input !== 'object'
    || input === null
    || Array.isArray(input)
    || typeof (input as Record<string, unknown>)[property] !== 'string'
  ) {
    return null;
  }
  return (input as Record<string, string>)[property];
}

function recordLoginFailure(
  attempts: Map<string, LoginAttempt>,
  remoteAddress: string,
  currentTime: number
): void {
  const current = attempts.get(remoteAddress);
  if (!current) {
    while (attempts.size >= LOGIN_TRACKED_ADDRESS_LIMIT) {
      const oldestAddress = attempts.keys().next().value as string | undefined;
      if (!oldestAddress) break;
      attempts.delete(oldestAddress);
    }
    attempts.set(remoteAddress, {
      failures: 1,
      windowStartedAt: currentTime
    });
    return;
  }
  current.failures += 1;
}

function removeExpiredLoginAttempts(
  attempts: Map<string, LoginAttempt>,
  currentTime: number
): void {
  for (const [remoteAddress, attempt] of attempts) {
    if (currentTime - attempt.windowStartedAt >= LOGIN_WINDOW_MILLISECONDS) {
      attempts.delete(remoteAddress);
    }
  }
}

function removeExpiredSessions(sessions: Map<string, AdminSession>, currentTime: number): void {
  for (const [tokenDigest, session] of sessions) {
    if (session.expiresAt <= currentTime) sessions.delete(tokenDigest);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function digestText(value: string): string {
  return digest(value).toString('hex');
}

function sessionResponse(session: AdminSession) {
  return {
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString()
  };
}

function serializeSessionCookie(
  token: string,
  expiresAt: number,
  currentTime: number,
  secure: boolean
): string {
  return [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expiresAt).toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt - currentTime) / 1_000))}`,
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

function clearSessionCookie(secure: boolean): string {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Strict',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function applyAdminSecurityHeaders(response: Response): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string
): void {
  response.status(status).json({
    error: {
      code,
      message
    }
  } satisfies ErrorResponse);
}
