import Image from 'next/image';
import { prisma } from '@hmp/db';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const [programmes, users] = await Promise.all([
    prisma.programme.count(),
    prisma.user.count(),
  ]);

  return (
    <main
      style={{
        position: 'relative',
        minHeight: '100vh',
        overflow: 'hidden',
        background: '#050816',
        color: '#fff',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Responsive helpers + animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        /* ── Keyframe animations ── */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 12px 40px rgba(79,70,229,0.35); }
          50% { box-shadow: 0 12px 60px rgba(79,70,229,0.55); }
        }

        /* ── Grid and layout animations ── */
        .hmp-login-grid {
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          min-height: 100vh;
          max-width: 1440px;
          margin: 0 auto;
        }

        /* ── Premium login card animations ── */
        @keyframes cardSlideIn {
          from {
            opacity: 0;
            transform: translateX(40px) scale(0.98);
            filter: blur(10px);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes cardGlow {
          0%, 100% { filter: drop-shadow(0 0 0 rgba(99,102,241,0)); }
          50% { filter: drop-shadow(0 0 8px rgba(99,102,241,0.4)); }
        }

        @keyframes badgeSlide {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes textSlide {
          from {
            opacity: 0;
            transform: translateY(8px);
            letter-spacing: -0.02em;
          }
          to {
            opacity: 1;
            transform: translateY(0);
            letter-spacing: 0;
          }
        }

        @keyframes inputFocusGlow {
          0% {
            border-color: rgba(99,102,241,0.3);
            box-shadow: 0 0 0 2px rgba(99,102,241,0.05);
          }
          50% {
            border-color: rgba(99,102,241,0.6);
            box-shadow: 0 0 12px 2px rgba(99,102,241,0.15);
          }
          100% {
            border-color: #6366f1;
            box-shadow: 0 0 0 4px rgba(99,102,241,0.18);
          }
        }

        @keyframes buttonPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(79,70,229,0.7);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(79,70,229,0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(79,70,229,0);
          }
        }

        .hmp-login-card {
          animation: cardSlideIn 0.9s cubic-bezier(0.23, 1, 0.320, 1) 0.15s both, cardGlow 3s ease-in-out 1.2s infinite;
          transition: all 0.4s cubic-bezier(0.23, 1, 0.320, 1);
          position: relative;
        }

        .hmp-login-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 40px 100px rgba(99,102,241,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
        }

        .hmp-login-badge {
          animation: badgeSlide 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both;
          transition: all 0.3s ease;
        }

        .hmp-login-badge:hover {
          background: rgba(99,102,241,0.15);
          border-color: rgba(99,102,241,0.3);
          transform: translateY(-2px);
        }

        .hmp-login-welcome {
          animation: textSlide 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both;
          transition: color 0.3s ease;
        }

        .hmp-login-subtitle {
          animation: textSlide 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.6s both;
        }

        .hmp-login-form {
          animation: fadeIn 0.7s ease-out 0.7s both;
        }

        /* ── Premium input animations ── */
        .hmp-login-input {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeIn 0.6s ease-out 0.8s both;
        }

        .hmp-login-input:focus {
          animation: inputFocusGlow 0.6s ease-out forwards;
          background: rgba(255,255,255,0.08) !important;
        }

        /* ── Premium button animations ── */
        .hmp-login-button {
          animation: fadeIn 0.7s ease-out 1.1s both;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative;
          overflow: hidden;
        }

        .hmp-login-button::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.3s ease;
        }

        .hmp-login-button:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 20px 80px rgba(79,70,229,0.6), inset 0 1px 0 rgba(255,255,255,0.2);
        }

        .hmp-login-button:hover::before {
          opacity: 1;
          animation: buttonPulse 1.5s ease-out;
        }

        .hmp-login-button:active {
          transform: translateY(-1px) scale(0.98);
        }

        /* ── Dev box animations ── */
        .hmp-login-devbox {
          animation: slideInUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 1.2s both;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
        }

        .hmp-login-devbox:hover {
          background: rgba(255,255,255,0.06);
          border-color: rgba(99,102,241,0.2);
        }

        /* ── Responsive ── */
        @media (max-width: 1100px) {
          .hmp-login-grid { grid-template-columns: 1fr; }
          .hmp-login-left { display: none !important; }
          .hmp-login-right { padding: 24px !important; }
          .hmp-login-card { animation: scaleIn 0.6s ease-out 0.2s both; }
        }
        @media (max-width: 600px) {
          .hmp-login-card { padding: 26px !important; border-radius: 20px !important; }
          .hmp-login-welcome { font-size: 28px !important; }
          .hmp-login-left { animation: none; }
          .hmp-login-right { animation: none; }
        }
      ` }} />

      {/* ── Cinematic background layer ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.0)' }}>
          <Image
            src="/login-tower.jpg?v=5"
            alt=""
            fill
            priority
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'right 20%', filter: 'brightness(1.15) saturate(1.28) contrast(1.10)' }}
          />
        </div>
        {/* Cinematic gradient overlay — softer so the tower stays the centerpiece */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(2,6,23,0.82) 0%, rgba(2,6,23,0.22) 42%, rgba(2,6,23,0.24) 58%, rgba(11,16,32,0.68) 100%)',
          }}
        />
        {/* Top + bottom vignette + subtle indigo bloom from below */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 85% 55% at 50% 110%, rgba(168,85,247,0.15), transparent 60%), linear-gradient(180deg, rgba(2,6,23,0.45) 0%, transparent 18%, transparent 82%, rgba(30,20,10,0.50) 100%), radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.15) 100%)',
          }}
        />
        {/* Subtle film grain */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.05,
            backgroundImage: 'radial-gradient(#fff 0.5px, transparent 0.5px)',
            backgroundSize: '4px 4px',
            pointerEvents: 'none',
            mixBlendMode: 'overlay',
          }}
        />
      </div>

      {/* ── Content grid ── */}
      <div className="hmp-login-grid" style={{ position: 'relative', zIndex: 2 }}>
        {/* ── Left hero ── */}
        <section
          className="hmp-login-left"
          style={{
            padding: '40px 56px 36px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Image
              src="/bits-logo.png"
              alt="BITS Pilani"
              width={200}
              height={100}
              priority
              style={{ width: 216, height: 'auto', objectFit: 'contain', flexShrink: 0 }}
            />
          </div>

          {/* Hero copy — vertically centered */}
          <div style={{ marginTop: 'auto', marginBottom: 32, maxWidth: 540 }}>
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'clamp(40px, 4.6vw, 60px)',
                fontWeight: 700,
                lineHeight: 1.04,
                letterSpacing: '-0.02em',
                margin: 0,
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              Handout<br />
              Management{' '}
              <span style={{ color: 'rgba(255,255,255,0.72)' }}>
                Portal
              </span>
            </h1>

            <div
              aria-hidden
              style={{
                width: 56,
                height: 3,
                borderRadius: 999,
                background: 'linear-gradient(90deg, #4F46E5, #7C3AED)',
                margin: '20px 0 22px',
                boxShadow: '0 4px 18px rgba(124,58,237,0.45)',
              }}
            />

            <p
              style={{
                maxWidth: 460,
                fontSize: 15,
                lineHeight: 1.65,
                color: 'rgba(255,255,255,0.74)',
                margin: 0,
              }}
            >
              A unified workspace for the Instruction Cell, Programme Committees, HoDs and Faculty to author, review and publish course handouts across BITS WILP.
            </p>
          </div>

          {/* Stats — pinned bottom */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <StatCard value={String(programmes)} label="Active Programmes" />
            <StatCard value={String(users)} label="Faculty Enrolled" />
            <StatCard value="Secure" label="BITS Credentials" muted />
          </div>
        </section>

        {/* ── Right form ── */}
        <section
          className="hmp-login-right"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 32px',
          }}
        >
          <div
            className="hmp-login-card"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 380,
              padding: 32,
              borderRadius: 24,
              background: 'rgba(15,23,42,0.55)',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
              overflow: 'hidden',
              willChange: 'box-shadow',
            }}
          >
            {/* Inner glow corners */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                width: 280,
                height: 280,
                top: -120,
                right: -120,
                background: 'radial-gradient(circle, rgba(99,102,241,0.28), transparent 70%)',
                pointerEvents: 'none',
              }}
            />
            <div
              aria-hidden
              style={{
                position: 'absolute',
                width: 240,
                height: 240,
                bottom: -130,
                left: -100,
                background: 'radial-gradient(circle, rgba(124,58,237,0.16), transparent 70%)',
                pointerEvents: 'none',
              }}
            />

            {/* Secure badge */}
            <div
              className="hmp-login-badge"
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 12px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                fontSize: 12,
                color: 'rgba(255,255,255,0.85)',
                fontWeight: 500,
                transition: 'all 0.3s ease',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z" />
              </svg>
              Secure sign-in
            </div>

            {/* Heading */}
            <h2
              className="hmp-login-welcome"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 32,
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '-0.015em',
                lineHeight: 1.15,
                margin: '18px 0 6px',
                position: 'relative',
              }}
            >
              Welcome back
            </h2>
            <p className="hmp-login-subtitle" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, margin: '0 0 24px', position: 'relative' }}>
              Sign in to continue to HMP
            </p>

            <div className="hmp-login-form" style={{ position: 'relative' }}>
              <LoginForm next={searchParams.next} error={searchParams.error} />
            </div>

            {/* Dev users */}
            <div
              className="hmp-login-devbox"
              style={{
                position: 'relative',
                marginTop: 22,
                padding: 14,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                transition: 'all 0.3s ease',
              }}
            >
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', margin: '0 0 10px' }}>
                Dev users · password is{' '}
                <code
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    background: 'rgba(255,255,255,0.10)',
                    padding: '2px 6px',
                    borderRadius: 5,
                    color: '#fff',
                  }}
                >
                  password
                </code>
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['admin@hmp.local', 'ic@hmp.local', 'hog@hmp.local', 'pc@hmp.local', 'faculty@hmp.local'].map((u) => (
                  <span
                    key={u}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.82)',
                    }}
                  >
                    {u}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ value, label, muted }: { value: string; label: string; muted?: boolean }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 130,
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.30)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: muted ? 18 : 24,
          fontWeight: 700,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)', marginTop: 5, letterSpacing: '0.005em' }}>
        {label}
      </div>
    </div>
  );
}
