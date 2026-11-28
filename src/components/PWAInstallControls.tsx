import React, { useState } from 'react';
import { Download, ExternalLink, Laptop, Share, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface DownloadAppButtonProps {
  variant?: 'desktop' | 'mobile' | 'landing';
}

export const DownloadAppButton: React.FC<DownloadAppButtonProps> = ({
  variant = 'desktop',
}) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Suppress install CTA when already launched inside installed standalone desktop/tablet app
  if (isInstalled) {
    return null;
  }

  const handleDownloadClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        const result = await install();
        if (result === 'unavailable') {
          setShowGuideModal(true);
        }
      } catch {
        setShowGuideModal(true);
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowGuideModal(true);
  };

  const buttonClasses =
    variant === 'landing'
      ? 'inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#22D3EE]/20 to-[#FACC15]/15 hover:from-[#22D3EE]/30 hover:to-[#FACC15]/25 border border-[#22D3EE]/65 text-white text-xs sm:text-sm font-bold shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all cursor-pointer whitespace-nowrap'
      : variant === 'mobile'
      ? 'h-8 px-2.5 rounded bg-[#141720] hover:bg-[#1B202C] border border-[#22D3EE]/65 text-[11px] font-bold text-[#22D3EE] inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap'
      : 'flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-md bg-[#141720] hover:bg-[#1B202C] border border-[#22D3EE]/65 hover:border-[#FACC15]/80 text-xs font-bold text-[#22D3EE] hover:text-[#FACC15] transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-[0_0_12px_rgba(34,211,238,0.22)]';

  return (
    <>
      <button
        type="button"
        onClick={handleDownloadClick}
        disabled={installing}
        className={buttonClasses}
        title="Descargar e instalar ShowLive en tu PC o Tablet para usarlo sin internet"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Descargar App</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[#0D1018] border border-[#22D3EE]/45 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0A0C12]">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-[#22D3EE]" />
                <h3 className="font-display text-sm font-bold text-white">
                  Instalar ShowLive en PC o Tablet (Sin Internet)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-300 leading-relaxed">
              <p className="text-slate-200">
                Instala <strong className="text-[#FACC15]">ShowLive</strong> directamente como
                programa en tu computador o tablet para abrirlo desde el escritorio y mezclar
                tus canciones y 32 pads incluso <strong className="text-[#22D3EE]">sin conexión a internet</strong>.
              </p>

              {isInIframe && (
                <div className="p-3 rounded-lg bg-[#22D3EE]/10 border border-[#22D3EE]/40 space-y-2">
                  <p className="font-semibold text-[#22D3EE]">
                    Abre ShowLive en ventana directa para activar el instalador de PC:
                  </p>
                  <a
                    href={typeof window !== 'undefined' ? window.location.href : '/'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-lg bg-[#22D3EE] hover:bg-[#38E2FB] text-[#090A0E] font-extrabold text-xs transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Abrir Instalador Directo en Nueva Pestaña</span>
                  </a>
                </div>
              )}

              {isIOS ? (
                <div className="p-3.5 rounded-lg bg-[#141824] border border-white/10 space-y-2">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <Share className="w-3.5 h-3.5 text-[#FACC15]" />
                    Cómo instalar en iPad / iPhone (Safari):
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300">
                    <li>
                      Toca el botón <strong>Compartir</strong> en la barra de Safari.
                    </li>
                    <li>
                      Desliza y selecciona <strong>Agregar a pantalla de inicio</strong>.
                    </li>
                    <li>
                      Toca <strong>Agregar</strong> y ábrelo como app en pantalla completa.
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="p-3.5 rounded-lg bg-[#141824] border border-white/10 space-y-2">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5 text-[#FACC15]" />
                    Cómo instalar en PC (Windows / Mac) o Tablet Android:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                    <li>
                      En <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>, haz clic
                      en el ícono de instalar (<strong>⊕ / Pantalla con flecha</strong>) en la
                      barra de direcciones arriba a la derecha.
                    </li>
                    <li>
                      O abre el menú <strong>⋮</strong> del navegador y elige{' '}
                      <strong className="text-[#22D3EE]">“Instalar ShowLive”</strong> (o{' '}
                      <em>Aplicaciones → Instalar este sitio como aplicación</em>).
                    </li>
                    <li>
                      Se agregará un acceso directo en tu <strong>Escritorio / Menú Inicio</strong>{' '}
                      y funcionará offline con tus archivos locales y Sampler.
                    </li>
                  </ol>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="w-full py-2.5 rounded-lg bg-[#FACC15] hover:bg-[#FDE047] text-[#090A0E] font-extrabold text-xs cursor-pointer transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 md:bottom-4 left-3 z-[70] flex items-center gap-2 rounded-lg bg-amber-500/95 px-3 py-1.5 text-[11px] font-bold text-[#090A0E] shadow-lg border border-amber-200/40 pointer-events-none">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Modo Sin Internet — Pistas locales y Sampler activos</span>
    </div>
  );
};
