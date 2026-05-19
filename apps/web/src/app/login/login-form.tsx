'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { signInAction } from './actions';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'rgba(255,255,255,0.72)',
  marginBottom: 7,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 46,
  borderRadius: 11,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  padding: '0 14px',
  color: '#fff',
  fontSize: 14,
  fontFamily: 'var(--font-sans)',
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
};

export function LoginForm({ next, error: initialError }: { next?: string; error?: string }) {
  const [email, setEmail] = useState('admin@hmp.local');
  const [password, setPassword] = useState('password');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | undefined>(initialError);
  const [pending, startTransition] = useTransition();
  const [hover, setHover] = useState(false);
  const router = useRouter();

  return (
    <>
      {/* Local CSS for placeholders + focus (inline `style` can't reach pseudo-elements) */}
      <style dangerouslySetInnerHTML={{ __html: `
        .hmp-login-input::placeholder { color: rgba(255,255,255,0.42); }
        .hmp-login-input:focus {
          border-color: #6366f1 !important;
          box-shadow: 0 0 0 4px rgba(99,102,241,0.18) !important;
          background: rgba(255,255,255,0.07) !important;
        }
        .hmp-login-input:-webkit-autofill,
        .hmp-login-input:-webkit-autofill:hover,
        .hmp-login-input:-webkit-autofill:focus {
          -webkit-text-fill-color: #fff;
          -webkit-box-shadow: 0 0 0 1000px rgba(15,23,42,0.92) inset;
          caret-color: #fff;
          transition: background-color 9999s ease-in-out 0s;
        }
        .hmp-login-checkbox {
          appearance: none;
          width: 16px; height: 16px;
          border-radius: 5px;
          border: 1px solid rgba(255,255,255,0.25);
          background: rgba(255,255,255,0.06);
          cursor: pointer;
          display: inline-grid;
          place-items: center;
          transition: background 0.15s, border-color 0.15s;
        }
        .hmp-login-checkbox:checked {
          background: linear-gradient(135deg, #4F46E5, #7C3AED);
          border-color: transparent;
        }
        .hmp-login-checkbox:checked::after {
          content: '';
          width: 9px; height: 5px;
          border-left: 2px solid #fff;
          border-bottom: 2px solid #fff;
          transform: rotate(-45deg) translate(1px,-1px);
        }
        .hmp-login-checkbox:focus-visible {
          outline: 2px solid #6366f1;
          outline-offset: 2px;
        }
        .hmp-login-forgot { color: #9ab6ff; text-decoration: none; transition: color 0.15s; }
        .hmp-login-forgot:hover { color: #c4d2ff; }
      ` }} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          startTransition(async () => {
            const result = await signInAction({ email, password, next });
            if (result.error) setError(result.error);
            else if (result.redirectTo) router.push(result.redirectTo);
          });
        }}
      >
        {/* Email */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="login-email" style={labelStyle}>Email</label>
          <input
            id="login-email"
            className="hmp-login-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="admin@hmp.local"
            autoComplete="username"
            style={inputStyle}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="login-password" style={labelStyle}>Password</label>
          <input
            id="login-password"
            className="hmp-login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            autoComplete="current-password"
            style={inputStyle}
          />
        </div>

        {/* Remember + Forgot */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: '4px 0 20px',
          fontSize: 12.5,
        }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.78)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              className="hmp-login-checkbox"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember me
          </label>
          <a className="hmp-login-forgot" href="#" onClick={(e) => e.preventDefault()}>
            Forgot password?
          </a>
        </div>

        {/* Error */}
        {error && (
          <p role="alert" style={{
            fontSize: 13,
            color: '#fda4a4',
            background: 'rgba(196,59,59,0.12)',
            border: '1px solid rgba(196,59,59,0.4)',
            padding: '10px 14px',
            borderRadius: 10,
            marginBottom: 14,
          }}>
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          className="hmp-login-button"
          type="submit"
          disabled={pending}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            height: 48,
            border: 'none',
            outline: 'none',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
            color: '#fff',
            fontSize: 14.5,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            letterSpacing: '0.005em',
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.65 : 1,
            transform: hover && !pending ? 'translateY(-2px)' : 'translateY(0)',
            boxShadow: hover && !pending
              ? '0 18px 60px rgba(79,70,229,0.5)'
              : '0 12px 40px rgba(79,70,229,0.35)',
            transition: 'transform 0.2s, box-shadow 0.2s, opacity 0.15s',
          }}
        >
          {pending ? 'Signing in…' : 'Sign in'}
          {!pending && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="13 6 19 12 13 18" />
            </svg>
          )}
        </button>
      </form>
    </>
  );
}
