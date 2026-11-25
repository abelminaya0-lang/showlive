import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Error inesperado en la aplicación.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ShowLive ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = 'Ocurrió un problema de conexión o permisos con Firebase.';
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendly = parsed.error.includes('Quota exceeded')
            ? 'Se alcanzó el límite diario gratuito de Firebase Firestore. Se restablecerá mañana.'
            : `Error de permisos o datos (${parsed.operationType || 'operación'}): ${parsed.error}`;
        }
      } catch {
        if (this.state.message) friendly = this.state.message;
      }

      return (
        <div className="min-h-screen w-full bg-[#080A0F] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-[#10131C] border border-red-500/30 p-6 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="font-display text-lg font-bold text-white mb-2">
              Problema detectado en ShowLive
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed mb-5 break-words">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F4256A] hover:bg-[#FF3478] text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Recargar ShowLive</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
