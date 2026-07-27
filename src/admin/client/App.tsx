import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react';
import {
  AdminApiError,
  createApp,
  createSession,
  deleteApp,
  deleteSession,
  getSession,
  listApps,
  rotateAppKey,
  type AdminSession,
  type AppCredential,
  type RelayApp
} from './api.js';

const APP_ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const APP_ID_MAX_LENGTH = 128;

type Confirmation =
  | { kind: 'rotate'; app: RelayApp }
  | { kind: 'delete'; app: RelayApp };

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [apps, setApps] = useState<RelayApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [credential, setCredential] = useState<AppCredential | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sortedApps = useMemo(
    () => [...apps].sort((a, b) => a.appId.localeCompare(b.appId)),
    [apps]
  );

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const restored = await getSession();
        if (!active) return;
        setSession(restored);
        setAppsLoading(true);
        try {
          setApps(await listApps());
          setAppsError(null);
        } catch (error) {
          if (!active) return;
          if (isUnauthorized(error)) {
            clearLocalSession();
          } else {
            setAppsError(messageFrom(error));
          }
        } finally {
          if (active) setAppsLoading(false);
        }
      } catch (error) {
        if (active && !isUnauthorized(error)) {
          setLoginError(messageFrom(error));
        }
      } finally {
        if (active) setSessionLoading(false);
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    const expiresAt = new Date(session.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return;

    const delay = Math.min(Math.max(expiresAt - Date.now(), 0), 2_147_483_647);
    const timer = window.setTimeout(() => {
      clearLocalSession();
      setLoginError('Your admin session expired. Sign in again to continue.');
    }, delay);

    return () => window.clearTimeout(timer);
  }, [session]);

  async function loadApps() {
    setAppsLoading(true);
    setAppsError(null);
    try {
      setApps(await listApps());
    } catch (error) {
      if (isUnauthorized(error)) {
        clearLocalSession();
        setLoginError('Your admin session expired. Sign in again to continue.');
        return;
      }
      setAppsError(messageFrom(error));
    } finally {
      setAppsLoading(false);
    }
  }

  async function handleLogin(passphrase: string) {
    setLoginBusy(true);
    setLoginError(null);
    try {
      const nextSession = await createSession(passphrase);
      setSession(nextSession);
      setAppsLoading(true);
      try {
        setApps(await listApps());
        setAppsError(null);
      } catch (error) {
        if (isUnauthorized(error)) {
          clearLocalSession();
          setLoginError('The relay did not accept the new admin session.');
          return;
        }
        setAppsError(messageFrom(error));
      } finally {
        setAppsLoading(false);
      }
    } catch (error) {
      setLoginError(messageFrom(error));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    if (!session) return;
    setMutationBusy(true);
    setNotice(null);
    try {
      await deleteSession(session.csrfToken);
      clearLocalSession();
    } catch (error) {
      if (isUnauthorized(error)) {
        clearLocalSession();
        return;
      }
      setNotice(messageFrom(error));
    } finally {
      setMutationBusy(false);
    }
  }

  async function handleCreate(appId: string) {
    if (!session) return;
    setMutationBusy(true);
    setMutationError(null);
    setNotice(null);
    try {
      const result = await createApp(appId, session.csrfToken);
      setApps((current) => [
        ...current.filter((app) => app.appId !== result.app.appId),
        result.app
      ]);
      setAppsError(null);
      setCreateOpen(false);
      setCredential(result);
    } catch (error) {
      if (isUnauthorized(error)) {
        clearLocalSession();
        setLoginError('Your admin session expired. Sign in again to continue.');
        return;
      }
      setMutationError(messageFrom(error));
    } finally {
      setMutationBusy(false);
    }
  }

  async function handleConfirm() {
    if (!session || !confirmation) return;
    setMutationBusy(true);
    setMutationError(null);
    setNotice(null);
    try {
      if (confirmation.kind === 'rotate') {
        const result = await rotateAppKey(
          confirmation.app.appId,
          session.csrfToken
        );
        setApps((current) => current.map((app) => (
          app.appId === result.app.appId ? result.app : app
        )));
        setConfirmation(null);
        setCredential(result);
      } else {
        await deleteApp(confirmation.app.appId, session.csrfToken);
        setApps((current) => current.filter(
          (app) => app.appId !== confirmation.app.appId
        ));
        setConfirmation(null);
        setNotice(`${confirmation.app.appId} was deleted.`);
      }
    } catch (error) {
      if (isUnauthorized(error)) {
        clearLocalSession();
        setLoginError('Your admin session expired. Sign in again to continue.');
        return;
      }
      setMutationError(messageFrom(error));
    } finally {
      setMutationBusy(false);
    }
  }

  function clearLocalSession() {
    setSession(null);
    setApps([]);
    setAppsError(null);
    setCreateOpen(false);
    setConfirmation(null);
    setCredential(null);
    setMutationError(null);
    setNotice(null);
  }

  if (sessionLoading) {
    return <SessionLoadingScreen />;
  }

  if (!session) {
    return (
      <LoginScreen
        busy={loginBusy}
        error={loginError}
        onSubmit={handleLogin}
      />
    );
  }

  const connectedApps = apps.filter((app) => app.connected).length;
  const clients = apps.reduce((total, app) => total + app.clients, 0);
  const pendingClients = apps.reduce(
    (total, app) => total + app.pendingClients,
    0
  );

  return (
    <div className="admin-shell">
      <header className="topbar">
        <Brand compact />
        <div className="session-controls">
          <div className="session-copy">
            <span className="session-dot" aria-hidden="true" />
            <span>Admin session</span>
            <span className="session-expiry">
              expires {formatTime(session.expiresAt)}
            </span>
          </div>
          <button
            className="button button-quiet"
            type="button"
            disabled={mutationBusy}
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="dashboard">
        <section className="page-heading" aria-labelledby="applications-title">
          <div>
            <p className="eyebrow">Relay control plane</p>
            <h1 id="applications-title">Applications</h1>
            <p className="lede">
              Register app servers and monitor the connections routed through
              this relay.
            </p>
          </div>
          <button
            className="button button-primary button-large"
            type="button"
            onClick={() => {
              setMutationError(null);
              setCreateOpen(true);
            }}
          >
            <span aria-hidden="true">+</span>
            Register app
          </button>
        </section>

        <section className="trust-boundary" aria-labelledby="trust-title">
          <div className="trust-icon" aria-hidden="true">✓</div>
          <div className="trust-copy">
            <p className="trust-label">Identity boundary</p>
            <h2 id="trust-title">Verification only, by design</h2>
            <p>
              This relay verifies user JWTs with the configured public key.
              Signing keys and token issuance stay with your identity server.
            </p>
          </div>
          <span className="boundary-badge">No private key loaded</span>
        </section>

        <section className="metrics" aria-label="Relay application summary">
          <Metric
            label="Registered"
            value={apps.length}
            detail={apps.length === 1 ? 'application' : 'applications'}
          />
          <Metric
            label="Online"
            value={connectedApps}
            detail={`${apps.length - connectedApps} offline`}
            accent="online"
          />
          <Metric
            label="Active clients"
            value={clients}
            detail={`${pendingClients} pending admission`}
          />
        </section>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}

        <section className="apps-panel" aria-labelledby="registrations-title">
          <div className="panel-header">
            <div>
              <h2 id="registrations-title">App registrations</h2>
              <p>Credentials are shown only when created or rotated.</p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              disabled={appsLoading}
              onClick={loadApps}
            >
              <span className={appsLoading ? 'refresh spinning' : 'refresh'} aria-hidden="true">
                ↻
              </span>
              Refresh
            </button>
          </div>

          {appsLoading ? (
            <LoadingState />
          ) : appsError ? (
            <ErrorState message={appsError} onRetry={loadApps} />
          ) : sortedApps.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : (
            <AppList
              apps={sortedApps}
              onRotate={(app) => {
                setMutationError(null);
                setConfirmation({ kind: 'rotate', app });
              }}
              onDelete={(app) => {
                setMutationError(null);
                setConfirmation({ kind: 'delete', app });
              }}
            />
          )}
        </section>
      </main>

      {createOpen && (
        <CreateAppDialog
          busy={mutationBusy}
          error={mutationError}
          onClose={() => {
            if (mutationBusy) return;
            setCreateOpen(false);
            setMutationError(null);
          }}
          onSubmit={handleCreate}
        />
      )}

      {confirmation && (
        <ConfirmationDialog
          confirmation={confirmation}
          busy={mutationBusy}
          error={mutationError}
          onClose={() => {
            if (mutationBusy) return;
            setConfirmation(null);
            setMutationError(null);
          }}
          onConfirm={handleConfirm}
        />
      )}

      {credential && (
        <CredentialDialog
          credential={credential}
          onDismiss={() => setCredential(null)}
        />
      )}
    </div>
  );
}

function SessionLoadingScreen() {
  return (
    <div className="login-shell">
      <header className="login-header">
        <Brand />
        <span className="environment-label">Admin control plane</span>
      </header>
      <main className="session-loading" role="status">
        <span className="large-spinner" aria-hidden="true" />
        <strong>Checking your admin session</strong>
        <span>Connecting to the relay control plane…</span>
      </main>
      <footer className="login-footer">
        <span>Citadel Relay</span>
        <span>Public-key verification · Private-key isolation</span>
      </footer>
    </div>
  );
}

function LoginScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit(passphrase: string): Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passphrase || props.busy) return;
    await props.onSubmit(passphrase);
    setPassphrase('');
  }

  return (
    <div className="login-shell">
      <header className="login-header">
        <Brand />
        <span className="environment-label">Admin control plane</span>
      </header>

      <main className="login-main">
        <section className="login-intro" aria-labelledby="login-title">
          <p className="eyebrow eyebrow-light">Citadel Relay</p>
          <h1 id="login-title">
            A quiet gatekeeper for your application network.
          </h1>
          <p>
            Register trusted app servers, rotate their credentials, and see
            current routing status from one secure place.
          </p>
          <div className="verification-note">
            <div className="verification-symbol" aria-hidden="true">✓</div>
            <div>
              <strong>Public-key verification</strong>
              <span>
                User tokens are issued elsewhere and only verified here.
              </span>
            </div>
          </div>
        </section>

        <section className="login-card" aria-labelledby="sign-in-title">
          <div className="login-card-heading">
            <div className="lock-mark" aria-hidden="true" />
            <div>
              <p className="eyebrow">Restricted access</p>
              <h2 id="sign-in-title">Sign in to the relay</h2>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label htmlFor="admin-passphrase">Admin passphrase</label>
            <input
              autoComplete="current-password"
              autoFocus
              id="admin-passphrase"
              name="passphrase"
              type="password"
              value={passphrase}
              disabled={props.busy}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <p className="field-hint">
              Sessions last up to eight hours and are cleared when the relay
              restarts.
            </p>

            {props.error && (
              <div className="form-error" role="alert">
                <span aria-hidden="true">!</span>
                {props.error}
              </div>
            )}

            <button
              className="button button-primary button-login"
              type="submit"
              disabled={props.busy || passphrase.length === 0}
            >
              {props.busy ? (
                <>
                  <span className="mini-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in to relay
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </form>
        </section>
      </main>

      <footer className="login-footer">
        <span>Citadel Relay</span>
        <span>App registration · Connection oversight · JWT verification</span>
      </footer>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span className="brand-name">
        Citadel
        <small>Relay</small>
      </span>
    </div>
  );
}

function Metric(props: {
  label: string;
  value: number;
  detail: string;
  accent?: 'online';
}) {
  return (
    <article className="metric">
      <div className="metric-topline">
        <span>{props.label}</span>
        {props.accent && <span className="live-pulse" aria-hidden="true" />}
      </div>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function AppList(props: {
  apps: RelayApp[];
  onRotate(app: RelayApp): void;
  onDelete(app: RelayApp): void;
}) {
  return (
    <div className="app-list" role="table" aria-label="Registered applications">
      <div className="app-list-head" role="row">
        <span role="columnheader">Application</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Client traffic</span>
        <span role="columnheader">Last changed</span>
        <span role="columnheader" className="visually-hidden">Actions</span>
      </div>
      {props.apps.map((app) => (
        <div className="app-row" role="row" key={app.appId}>
          <div className="app-identity" role="cell">
            <span className="app-avatar" aria-hidden="true">
              {app.appId.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{app.appId}</strong>
              <small>Registered {formatDate(app.createdAt)}</small>
            </div>
          </div>
          <div role="cell">
            <span className={app.connected ? 'status status-online' : 'status status-offline'}>
              <span aria-hidden="true" />
              {app.connected ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="traffic-cell" role="cell">
            <strong>{app.clients}</strong>
            <span>active</span>
            <i aria-hidden="true" />
            <strong>{app.pendingClients}</strong>
            <span>pending</span>
          </div>
          <div className="changed-cell" role="cell">
            <span>{formatDate(app.updatedAt)}</span>
            <small>{formatTime(app.updatedAt)}</small>
          </div>
          <div className="row-actions" role="cell">
            <button
              className="button button-secondary button-small"
              type="button"
              aria-label={`Rotate key for ${app.appId}`}
              onClick={() => props.onRotate(app)}
            >
              Rotate key
            </button>
            <button
              className="icon-button icon-button-danger"
              type="button"
              aria-label={`Delete ${app.appId}`}
              title={`Delete ${app.appId}`}
              onClick={() => props.onDelete(app)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate(): void }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <span>+</span>
      </div>
      <h3>No apps registered</h3>
      <p>
        Register an app server to create its first pre-shared connection key.
      </p>
      <button className="button button-secondary" type="button" onClick={onCreate}>
        Register your first app
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="large-spinner" aria-hidden="true" />
      <strong>Loading registrations</strong>
      <span>Checking the relay’s application store…</span>
    </div>
  );
}

function ErrorState(props: { message: string; onRetry(): void }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-mark" aria-hidden="true">!</span>
      <div>
        <strong>Registrations could not be loaded</strong>
        <p>{props.message}</p>
      </div>
      <button className="button button-secondary" type="button" onClick={props.onRetry}>
        Try again
      </button>
    </div>
  );
}

function CreateAppDialog(props: {
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(appId: string): Promise<void>;
}) {
  const [appId, setAppId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  function validate() {
    if (!appId) return 'Enter an app ID.';
    if (!APP_ID_PATTERN.test(appId)) {
      return 'Use lowercase letters, numbers, and internal hyphens only.';
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;
    await props.onSubmit(appId);
  }

  return (
    <Modal titleId="create-app-title" onBackdrop={props.onClose}>
      <form className="dialog-card" onSubmit={handleSubmit}>
        <DialogHeading
          eyebrow="New registration"
          title="Register an app"
          id="create-app-title"
          onClose={props.onClose}
          closeDisabled={props.busy}
        />
        <div className="dialog-body">
          <label htmlFor="new-app-id">App ID</label>
          <div className="input-prefix">
            <span aria-hidden="true">/</span>
            <input
              autoFocus
              id="new-app-id"
              maxLength={APP_ID_MAX_LENGTH}
              placeholder="customer-portal"
              spellCheck={false}
              value={appId}
              disabled={props.busy}
              aria-describedby="app-id-help"
              aria-invalid={Boolean(validationError || props.error)}
              onChange={(event) => {
                setAppId(event.target.value);
                setValidationError(null);
              }}
            />
          </div>
          <p className="field-hint" id="app-id-help">
            Lowercase letters, numbers, and hyphens. This ID is used by app
            servers and clients when opening a connection.
          </p>
          {(validationError || props.error) && (
            <div className="form-error" role="alert">
              <span aria-hidden="true">!</span>
              {validationError ?? props.error}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={props.busy}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={props.busy}
          >
            {props.busy ? 'Creating…' : 'Create registration'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmationDialog(props: {
  confirmation: Confirmation;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onConfirm(): Promise<void>;
}) {
  const deleting = props.confirmation.kind === 'delete';
  const appId = props.confirmation.app.appId;

  return (
    <Modal titleId="confirmation-title" onBackdrop={props.onClose}>
      <div className="dialog-card dialog-card-small">
        <DialogHeading
          eyebrow={deleting ? 'Permanent action' : 'Credential rotation'}
          title={deleting ? `Delete ${appId}?` : `Rotate ${appId}’s key?`}
          id="confirmation-title"
          onClose={props.onClose}
          closeDisabled={props.busy}
          danger={deleting}
        />
        <div className="dialog-body">
          <p className="confirmation-copy">
            {deleting
              ? 'This removes the registration and immediately disconnects its app server and clients. This cannot be undone.'
              : 'The current key will stop working immediately. The app server and all connected clients will be disconnected.'}
          </p>
          {!deleting && (
            <div className="callout">
              Have the app server ready to receive the new key before you
              continue.
            </div>
          )}
          {props.error && (
            <div className="form-error" role="alert">
              <span aria-hidden="true">!</span>
              {props.error}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={props.busy}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className={deleting ? 'button button-danger' : 'button button-primary'}
            type="button"
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {props.busy
              ? (deleting ? 'Deleting…' : 'Rotating…')
              : (deleting ? 'Delete app' : 'Rotate key')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CredentialDialog(props: {
  credential: AppCredential;
  onDismiss(): void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyCredential() {
    try {
      await navigator.clipboard.writeText(props.credential.preSharedKey);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <Modal titleId="credential-title">
      <div className="dialog-card credential-dialog">
        <div className="success-seal" aria-hidden="true">✓</div>
        <div className="credential-heading">
          <p className="eyebrow">One-time credential</p>
          <h2 id="credential-title">Save this pre-shared key</h2>
          <p>
            This is the only time the key for{' '}
            <strong>{props.credential.app.appId}</strong> will be shown.
          </p>
        </div>
        <div className="secret-block">
          <div className="secret-label">
            <span>Pre-shared key</span>
            <span>256-bit</span>
          </div>
          <textarea
            aria-label="Pre-shared key"
            className="secret-value"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            rows={2}
            spellCheck={false}
            value={props.credential.preSharedKey}
          />
          <button
            className="button button-copy"
            type="button"
            onClick={copyCredential}
          >
            {copyState === 'copied' ? 'Copied' : 'Copy key'}
          </button>
        </div>
        <p
          className={copyState === 'failed' ? 'copy-feedback copy-failed' : 'copy-feedback'}
          role="status"
        >
          {copyState === 'copied' && 'Copied to clipboard.'}
          {copyState === 'failed' && 'Could not copy automatically. Select and copy the key above.'}
        </p>
        <div className="secret-warning">
          <span aria-hidden="true">!</span>
          <p>
            Store this key in your app server’s secret manager. It will be
            discarded from this screen when you close it.
          </p>
        </div>
        <button
          className="button button-primary button-full"
          type="button"
          onClick={props.onDismiss}
        >
          I’ve saved it
        </button>
      </div>
    </Modal>
  );
}

function Modal(props: {
  titleId: string;
  children: ReactNode;
  onBackdrop?(): void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onBackdrop);
  closeRef.current = props.onBackdrop;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const modal = modalRef.current;
    if (modal && !modal.contains(document.activeElement)) {
      modal.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && closeRef.current) {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !modal) return;

      const focusable = [...modal.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onBackdrop?.();
      }}
    >
      <div
        aria-labelledby={props.titleId}
        aria-modal="true"
        className="modal-position"
        ref={modalRef}
        role="dialog"
        tabIndex={-1}
      >
        {props.children}
      </div>
    </div>
  );
}

function DialogHeading(props: {
  eyebrow: string;
  title: string;
  id: string;
  onClose(): void;
  closeDisabled: boolean;
  danger?: boolean;
}) {
  return (
    <div className="dialog-heading">
      <div className={props.danger ? 'dialog-symbol dialog-symbol-danger' : 'dialog-symbol'}>
        <span aria-hidden="true">{props.danger ? '!' : '⌁'}</span>
      </div>
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h2 id={props.id}>{props.title}</h2>
      </div>
      <button
        className="dialog-close"
        type="button"
        aria-label="Close dialog"
        disabled={props.closeDisabled}
        onClick={props.onClose}
      >
        ×
      </button>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function isUnauthorized(error: unknown) {
  return error instanceof AdminApiError && error.status === 401;
}
