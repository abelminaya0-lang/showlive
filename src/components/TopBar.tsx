import React, { useEffect, useState } from 'react';
import { LogOut, Maximize2, Mic, Minimize2, Settings, User, Users } from 'lucide-react';
import { IAModelConfig, WorkspaceMode } from '../types/showlive';

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
    <header className="hidden lg:flex h-12 w-full bg-[#090B10] border-b border-white/10 px-4 items-center justify-between gap-4 shrink-0 select-none">
      {/* Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#F4256A] to-[#BE123C] flex items-center justify-center shadow-md shadow-[#F4256A]/25">
          <Mic className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-display font-bold text-base tracking-tight whitespace-nowrap">
          <span className="text-white">Show</span>
          <span className="text-[#F4256A]">Live</span>
        </span>
      </div>

      {/* Right Console Controls */}
      <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
        {/* MIXER | PADS segmented toggle */}
        <div className="flex items-center bg-[#141722] border border-white/10 rounded-md p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onChangeMode('mixer')}
            className={`px-3 py-1 text-[11px] font-bold tracking-wider uppercase rounded transition-colors cursor-pointer whitespace-nowrap ${
              workspaceMode === 'mixer'
                ? 'bg-[#252A3B] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Mixer
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('pads')}
            className={`px-3 py-1 text-[11px] font-bold tracking-wider uppercase rounded transition-colors cursor-pointer whitespace-nowrap ${
              workspaceMode === 'pads'
                ? 'bg-[#F4256A] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Pads
          </button>
        </div>

        {/* Fullscreen button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#131620] hover:bg-[#1B202E] border border-white/10 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title="Pantalla Completa"
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5 text-slate-300" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5 text-slate-300" />
          )}
          <span className="hidden sm:inline">Fullscreen</span>
        </button>

        {/* Live RAM & FPS counter matching screenshot */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-md bg-[#0B1914] border border-emerald-500/35 text-emerald-400 text-[11px] font-mono-tabular whitespace-nowrap shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>
            RAM: {ramMb} MB ({ramPct}%) | {fps} FPS
          </span>
        </div>

        {/* Personal Admin Dashboard shortcut (Admin only) */}
        {isAdmin && onOpenAdminDashboard && (
          <button
            type="button"
            onClick={onOpenAdminDashboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-xs font-bold text-emerald-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#131620] hover:bg-[#1B202E] border border-white/10 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title={`Modelo activo: ${aiConfig.model}`}
        >
          <Settings className="w-3.5 h-3.5 text-slate-300" />
          <span>IA Model</span>
        </button>

        {/* Auth / Profile button */}
        {!userEmail && onOpenLogin ? (
          <button
            type="button"
            onClick={onOpenLogin}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-xs font-bold text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Iniciar sesión con Google o correo"
          >
            <User className="w-3.5 h-3.5 text-cyan-300" />
            <span>Iniciar sesión</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#131620] hover:bg-[#1B202E] border border-white/10 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title={userEmail ? `Sesión: ${userEmail} (Salir)` : 'Cerrar sesión'}
          >
            {userPhoto ? (
              <img
                src={userPhoto}
                alt={userEmail || 'Usuario'}
                referrerPolicy="no-referrer"
                className="w-5 h-5 rounded-full object-cover"
              />
            ) : (
              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
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
