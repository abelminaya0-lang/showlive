import React, { useEffect, useState } from 'react';
import { LogOut, Maximize2, Mic, Minimize2, Settings, User, Users } from 'lucide-react';
import { IAModelConfig, WorkspaceMode } from '../types/showlive';
import { DownloadAppButton } from './PWAInstallControls';

interface TopBarProps {
  workspaceMode: WorkspaceMode;
  onChangeMode: (mode: WorkspaceMode) => void;
  onOpenAiConfig: () => void;
  onOpenLogin?: () => void;
  onLogout: () => void;
  aiConfig: IAModelConfig;
  isAdmin?: boolean;
  onOpenAdminDashboard?: () => void;
  userPhoto?: string | null;
  userEmail?: string | null;
}

export const TopBar: React.FC<TopBarProps> = ({
  workspaceMode,
  onChangeMode,
  onOpenAiConfig,
  onOpenLogin,
  onLogout,
  aiConfig,
  isAdmin,
  onOpenAdminDashboard,
  userPhoto,
  userEmail,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState(60);
  const [ramMb, setRamMb] = useState(75);
  const [ramPct, setRamPct] = useState(2);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    let frames = 0;
    let lastTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      frames++;
      if (now - lastTime >= 1000) {
        setFps(Math.min(120, Math.round((frames * 1000) / (now - lastTime))));
        frames = 0;
        lastTime = now;

        const mem = (performance as any).memory;
        if (mem && mem.usedJSHeapSize && mem.jsHeapSizeLimit) {
          const mb = Math.round(mem.usedJSHeapSize / (1024 * 1024));
          const pct = Math.max(
            1,
            Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)
          );
          setRamMb(mb);
          setRamPct(pct);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen denied in sandboxed iframe
    }
  };

  return (
    <header className="hidden md:flex relative h-11 xl:h-12 w-full bg-[#101218] border-b border-white/10 px-2.5 lg:px-4 items-center justify-between gap-2 lg:gap-4 shrink-0 select-none">
      {/* Bottom Tri-Color Hardware Accent Line */}
      <div className="studio-tricolor-bar absolute bottom-0 inset-x-0 h-[2px] opacity-90 pointer-events-none" />

      {/* Brand */}
      <div className="flex items-center gap-2 lg:gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-full bg-[#161820] border-2 border-[#FACC15] flex items-center justify-center shadow-[0_0_12px_rgba(250,204,21,0.35)]">
          <Mic className="w-3.5 h-3.5 text-[#EC287B]" />
        </div>
        <span className="font-display font-extrabold text-base tracking-tight whitespace-nowrap">
          <span className="text-[#FACC15]">Show</span>
          <span className="text-[#22D3EE]">Live</span>
        </span>
      </div>

      {/* Right Console Controls */}
      <div className="flex items-center gap-1.5 lg:gap-2.5 overflow-x-auto no-scrollbar">
        {/* MIXER | PADS segmented toggle */}
        <div className="flex items-center bg-[#0A0B0F] border border-white/15 rounded-md p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onChangeMode('mixer')}
            className={`px-2.5 lg:px-3 py-1 text-[11px] font-extrabold tracking-wider uppercase rounded transition-all cursor-pointer whitespace-nowrap border ${
              workspaceMode === 'mixer'
                ? 'bg-[#FACC15] border-[#FACC15] text-[#090A0E] shadow-[0_0_12px_rgba(250,204,21,0.45)]'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Mixer
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('pads')}
            className={`px-2.5 lg:px-3 py-1 text-[11px] font-extrabold tracking-wider uppercase rounded transition-all cursor-pointer whitespace-nowrap border ${
              workspaceMode === 'pads'
                ? 'bg-[#EC287B] border-[#EC287B] text-white shadow-[0_0_12px_rgba(236,40,123,0.5)]'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Pads
          </button>
        </div>

        {/* Fullscreen button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-md bg-[#141720] hover:bg-[#1B202C] border border-white/15 hover:border-[#22D3EE]/60 text-xs font-semibold text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title="Pantalla Completa"
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5 text-[#22D3EE]" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5 text-[#22D3EE]" />
          )}
          <span className="hidden lg:inline">Fullscreen</span>
        </button>

        {/* Live RAM & FPS counter */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-md bg-[#0A0B0F] border border-[#22D3EE]/45 text-[#22D3EE] text-[11px] font-mono-tabular whitespace-nowrap shrink-0 shadow-[0_0_10px_rgba(34,211,238,0.12)]">
          <span className="w-2 h-2 rounded-full bg-[#FACC15]" />
          <span>
            RAM: {ramMb} MB ({ramPct}%) | {fps} FPS
          </span>
        </div>

        {/* Personal Admin Dashboard shortcut (Admin only) */}
        {isAdmin && onOpenAdminDashboard && (
          <button
            type="button"
            onClick={onOpenAdminDashboard}
            className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-md bg-[#141720] hover:bg-[#1B202C] border border-[#FACC15]/60 text-xs font-bold text-[#FACC15] transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-[0_0_10px_rgba(250,204,21,0.18)]"
            title="Panel personal de clientes y ganancias"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Mi Dashboard</span>
          </button>
        )}

        {/* IA Model button */}
        <button
          type="button"
          onClick={onOpenAiConfig}
          className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-md bg-[#141720] hover:bg-[#1B202C] border border-white/15 hover:border-[#FACC15]/60 text-xs font-semibold text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title={`Modelo activo: ${aiConfig.model}`}
        >
          <Settings className="w-3.5 h-3.5 text-[#FACC15]" />
          <span>IA Model</span>
        </button>

        {/* Direct PC/Tablet PWA Installer + Authenticated Profile */}
        <DownloadAppButton variant="desktop" />
        {userEmail && (
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#141720] hover:bg-[#1B202C] border border-[#EC287B]/50 text-xs font-semibold text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title={`Sesión: ${userEmail} (Salir)`}
          >
            {userPhoto ? (
              <img
                src={userPhoto}
                alt={userEmail || 'Usuario'}
                referrerPolicy="no-referrer"
                className="w-5 h-5 rounded-full object-cover border border-[#FACC15]/70"
              />
            ) : (
              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#EC287B] to-[#22D3EE] flex items-center justify-center">
                <User className="w-3 h-3 text-white" />
              </span>
            )}
            <span className="hidden sm:inline">Salir</span>
            <LogOut className="w-3 h-3 text-slate-400 sm:hidden" />
          </button>
        )}
      </div>
    </header>
  );
};
