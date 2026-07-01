import { useState, type FormEvent, type CSSProperties } from 'react';
import { requestPasswordToken, LoginError, type UserTokenResponse } from './password.js';
import { startGoogleLoginRedirect } from './google.js';

export interface LoginClassNames {
  form?: string;
  field?: string;
  label?: string;
  input?: string;
  button?: string;
  error?: string;
  googleButton?: string;
  divider?: string;
}

export interface GoogleLoginOptions {
  /** where identity-service returns the browser — must be registered on the client (exact match) */
  redirectUri: string;
  /** optional OAuth scopes to request from the upstream */
  scope?: string[];
  /** button label */
  label?: string;
}

export interface LoginProps {
  /** identity-service base URL, e.g. https://auth-dev.example.com */
  baseUrl: string;
  /** an OAuth client that allows the `password` grant and has an `audience` */
  clientId: string;
  /** called with the issued token on a successful login */
  onSuccess: (token: UserTokenResponse) => void;
  onError?: (error: Error) => void;
  /** heading text; pass null to omit */
  title?: string | null;
  submitLabel?: string;
  emailLabel?: string;
  passwordLabel?: string;
  /** className on the root <form> */
  className?: string;
  /** per-element classNames — for Tailwind/shadcn or any design system */
  classNames?: LoginClassNames;
  /** drop the built-in inline styles entirely (when you fully style via classNames) */
  unstyled?: boolean;
  /** override fetch (tests / SSR) */
  fetchImpl?: typeof fetch;
  /**
   * Enable a "Continue with Google" button (RQ-0012). The button starts the redirect flow and stashes
   * the PKCE verifier; the host app completes it on its callback route with `completeGoogleLoginFromRedirect`.
   * The client must allow the `authorization_code` grant and have an `audience`.
   */
  google?: GoogleLoginOptions;
  /** hide the email/password form (e.g. Google-only login). Requires `google`. */
  hidePasswordForm?: boolean;
}

// Minimal, neutral defaults so the component is usable with zero styling, yet every element takes a
// className for Tailwind/shadcn consumers, and `unstyled` removes the inline styles entirely.
const baseStyles: Record<string, CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 14, fontWeight: 500 },
  input: { padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 },
  button: { padding: '9px 12px', borderRadius: 6, border: 'none', background: '#0f172a', color: '#fff', fontSize: 14, cursor: 'pointer' },
  error: { color: '#b91c1c', fontSize: 13 },
  googleButton: { padding: '9px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 14, cursor: 'pointer' },
  divider: { textAlign: 'center', color: '#94a3b8', fontSize: 12 }
};

/**
 * Drop-in email/password login for identity-service's local IdP (RQ-0003). Renders a small form,
 * performs the `password` grant, and hands the issued token back via `onSuccess`. Token storage,
 * route guarding, and "remember me" are intentionally the host app's concern.
 */
export function Login(props: LoginProps) {
  const {
    baseUrl, clientId, onSuccess, onError,
    title = 'Sign in', submitLabel = 'Sign in',
    emailLabel = 'Email', passwordLabel = 'Password',
    className, classNames = {}, unstyled = false, fetchImpl,
    google, hidePasswordForm = false
  } = props;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const style = (key: keyof typeof baseStyles): CSSProperties | undefined =>
    unstyled ? undefined : baseStyles[key];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const token = await requestPasswordToken({ baseUrl, clientId, username: email, password, fetchImpl });
      onSuccess(token);
    } catch (err) {
      const e = err instanceof Error ? err : new LoginError('Login failed', 0);
      setError(e.message);
      onError?.(e);
    } finally {
      setSubmitting(false);
    }
  }

  // Google is a redirect flow: kick it off (stashing the PKCE verifier) and navigate away. The host
  // app completes it on its callback route with `completeGoogleLoginFromRedirect` (RQ-0012).
  async function handleGoogle() {
    if (submitting || !google) return;
    setError(null);
    setSubmitting(true);
    try {
      await startGoogleLoginRedirect({ baseUrl, clientId, redirectUri: google.redirectUri, scope: google.scope });
      // On success the browser navigates to Google; control does not return here.
    } catch (err) {
      const e = err instanceof Error ? err : new LoginError('Google login failed', 0);
      setError(e.message);
      onError?.(e);
      setSubmitting(false);
    }
  }

  const googleButton = google ? (
    <button
      type="button"
      className={classNames.googleButton}
      style={style('googleButton')}
      onClick={handleGoogle}
      disabled={submitting}
    >
      {google.label ?? 'Continue with Google'}
    </button>
  ) : null;

  return (
    <form className={className} style={style('form')} onSubmit={handleSubmit} noValidate>
      {title ? <h2>{title}</h2> : null}

      {hidePasswordForm && google ? (
        <>
          {googleButton}
          {error ? <div role="alert" className={classNames.error} style={style('error')}>{error}</div> : null}
        </>
      ) : (
      <>
      <div className={classNames.field} style={style('field')}>
        <label className={classNames.label} style={style('label')} htmlFor="identity-service-email">{emailLabel}</label>
        <input
          id="identity-service-email"
          className={classNames.input}
          style={style('input')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className={classNames.field} style={style('field')}>
        <label className={classNames.label} style={style('label')} htmlFor="identity-service-password">{passwordLabel}</label>
        <input
          id="identity-service-password"
          className={classNames.input}
          style={style('input')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {error ? <div role="alert" className={classNames.error} style={style('error')}>{error}</div> : null}

      <button className={classNames.button} style={style('button')} type="submit" disabled={submitting}>
        {submitting ? '…' : submitLabel}
      </button>

      {googleButton ? (
        <>
          <div className={classNames.divider} style={style('divider')}>or</div>
          {googleButton}
        </>
      ) : null}
      </>
      )}
    </form>
  );
}
