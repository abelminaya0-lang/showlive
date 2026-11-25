import React, { useState } from 'react';
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react';

export type LoginMode = 'login' | 'register' | 'reset' | 'paid_help';

interface LoginViewProps {
  onBack: () => void;
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailRegister: (email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
  authError: string | null;
  authNotice: string | null;
  loading?: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onBack,
  onGoogleSignIn,
  onEmailSignIn,
  onEmailRegister,
  onResetPassword,
  authError,
  authNotice,
  loading,
}) => {
  const [mode, setMode] = useState<LoginMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await onEmailSignIn(email.trim(), password);
      } else if (mode === 'register') {
        await onEmailRegister(email.trim(), password);
      } else if (mode === 'reset') {
        await onResetPassword(email.trim());
      }
    } finally {
      setSubmitting(false);
    }
  };

  const whatsappHelpUrl = `https://wa.me/51964708446?text=${encodeURIComponent(
    `Hola, ya pagué mi acceso a ShowLive y necesito mi clave / activación.${
      email.trim() ? ` Mi correo es: ${email.trim()}` : ''
    }`
  )}`;

  const isBusy = Boolean(loading || submitting);

  return (
    <div
      className="min-h-screen w-full text-slate-100 flex items-center justify-center p-4 sm:p-6 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.08), transparent 45%), radial-gradient(circle at 80% 15%, rgba(99, 102, 241, 0.16), transparent 48%), linear-gradient(160deg, #060913 0%, #090D1C 55%, #0D0B1C 100%)',
      }}
    >
      <div className="w-full max-w-[440px]">
        {/* Top-left Back link matching reference */}
        <button
          type="button"
          onClick={() => {
            if (mode !== 'login') setMode('login');
            else onBack();
          }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white mb-4 cursor-pointer transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver</span>
        </button>

        {/* Main Card matching reference screenshot */}
        <div className="rounded-3xl bg-[#0B1020]/90 border border-slate-700/50 shadow-[0_24px_80px_rgba(0,0,0,0.75)] p-6 sm:p-8 backdrop-blur-md">
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2 mb-6">
            <h1 className="font-display text-2xl font-bold text-white tracking-tight">
              {mode === 'register'
                ? 'Crear cuenta'
                : mode === 'reset'
                  ? 'Recuperar clave'
                  : mode === 'paid_help'
                    ? 'Ya pagué'
                    : 'Iniciar sesión'}
            </h1>

            <button
              type="button"
              onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
              className="px-3.5 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              {mode === 'register' ? 'Ya tengo cuenta' : 'No tienes cuenta? Regístrate'}
            </button>
          </div>

          {authError && (
            <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/35 text-xs text-red-200 leading-relaxed">
              {authError}
            </div>
          )}

          {authNotice && (
            <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200 leading-relaxed">
              {authNotice}
            </div>
          )}

          {mode === 'paid_help' ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Si ya realizaste tu pago, escribe tu correo abajo y contáctanos por WhatsApp para activar tu acceso al instante, o recupera tu contraseña si ya fuiste registrado.
              </p>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Tu correo (ej: micorreo@gmail.com)"
                className="w-full px-4 py-3 rounded-xl bg-[#161C2C]/90 border border-white/15 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-400/70"
              />

              <a
                href={whatsappHelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 rounded-full bg-[#16A34A] hover:bg-[#22C55E] text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-[0_8px_24px_rgba(22,163,74,0.3)]"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Enviar comprobante por WhatsApp (964 708 446)</span>
              </a>

              <button
                type="button"
                disabled={!email.trim() || isBusy}
                onClick={() => onResetPassword(email.trim())}
                className="w-full py-2.5 rounded-full border border-emerald-400/50 bg-[#082422] hover:bg-[#0B302D] disabled:opacity-50 text-xs font-semibold text-emerald-200 cursor-pointer transition-colors"
              >
                Enviar enlace para crear / restablecer mi contraseña
              </button>

              <button
                type="button"
                onClick={() => setMode('login')}
                className="w-full py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Volver a Iniciar sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl bg-[#161C2C]/85 border border-white/15 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-400/70 transition-colors"
              />

              {mode !== 'reset' && (
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className="w-full px-4 py-3 rounded-xl bg-[#161C2C]/85 border border-white/15 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-400/70 transition-colors"
                />
              )}

              {mode === 'login' && (
                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    onClick={() => setMode('reset')}
                    className="text-xs text-slate-300 hover:text-white cursor-pointer transition-colors"
                  >
                    Olvidé mi contraseña
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={isBusy}
                className="w-full py-3 rounded-full bg-[#07111F] hover:bg-[#0C1A2E] border border-cyan-400/75 text-white font-bold text-sm shadow-[0_0_24px_rgba(34,211,238,0.22)] hover:shadow-[0_0_28px_rgba(34,211,238,0.35)] disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {mode === 'register'
                    ? 'Registrarme'
                    : mode === 'reset'
                      ? 'Enviar correo de recuperación'
                      : 'Entrar'}
                </span>
              </button>
            </form>
          )}

          {/* Divider "o" */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/15" />
            <span className="text-xs text-slate-400">o</span>
            <div className="h-px flex-1 bg-white/15" />
          </div>

          {/* Bottom Secondary Buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode('paid_help')}
              className="w-full py-3 rounded-full bg-[#072623]/90 hover:bg-[#0B332F] border border-emerald-400/65 text-white text-sm font-bold cursor-pointer transition-colors"
            >
              Ya pagué y no tengo contraseña
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={onGoogleSignIn}
              className="w-full py-3 rounded-full bg-[#111626] hover:bg-[#192036] border border-white/15 text-white text-sm font-bold flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Iniciar sesión con Google</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
