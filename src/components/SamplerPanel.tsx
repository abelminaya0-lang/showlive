import React, { useEffect, useState } from 'react';
import {
  Edit2,
  Maximize2,
  Minimize2,
  Music2,
  Plus,
  Trash2,
} from 'lucide-react';
import { audioEngine } from '../audio/audioEngine';
import { SamplerBank, SamplerPad, TriggerMode } from '../types/showlive';

interface SamplerPanelProps {
  banks: SamplerBank[];
  activeBankId: string;
  onSelectBank: (id: string) => void;
  onCreateBank: () => void;
  onRenameBank: () => void;
  onDeleteBank: () => void;
  triggerMode: TriggerMode;
  onChangeTriggerMode: (mode: TriggerMode) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isFullPadsView: boolean;
  onToggleFullPadsView: () => void;
  onEditPad: (pad: SamplerPad) => void;
  onDropAudioOnPad: (padId: number, file: File) => void;
}

export const SamplerPanel: React.FC<SamplerPanelProps> = ({
  banks,
  activeBankId,
  onSelectBank,
  onCreateBank,
  onRenameBank,
  onDeleteBank,
  triggerMode,
  onChangeTriggerMode,
  isCollapsed,
  onToggleCollapse,
  isFullPadsView,
  onToggleFullPadsView,
  onEditPad,
  onDropAudioOnPad,
}) => {
  const [activePadIds, setActivePadIds] = useState<Set<number>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const activeBank = banks.find((b) => b.id === activeBankId) || banks[0];

  // Preload buffers for active bank
  useEffect(() => {
    if (!activeBank) return;
    activeBank.pads.forEach((pad) => {
      if (pad.fxPreset || pad.customAudioUrl) {
        audioEngine.preloadPad(pad);
      }
    });
  }, [activeBank]);

  const handleTrigger = (pad: SamplerPad) => {
    if (editMode || (!pad.fxPreset && !pad.customAudioUrl)) {
      onEditPad(pad);
      return;
    }
    audioEngine.resume();
    audioEngine.triggerPad(pad, triggerMode);
    setActivePadIds((prev) => new Set(prev).add(pad.id));

    if (triggerMode !== 'gate') {
      setTimeout(() => {
        setActivePadIds((prev) => {
          const next = new Set(prev);
          next.delete(pad.id);
          return next;
        });
      }, 220);
    }
  };

  const handleRelease = (pad: SamplerPad) => {
    if (triggerMode === 'gate') {
      audioEngine.releasePad(pad.id);
      setActivePadIds((prev) => {
        const next = new Set(prev);
        next.delete(pad.id);
        return next;
      });
    }
  };

  // Global keyboard shortcuts for Sampler (1-4, Q-R, A-F, Z-V, etc.)
  useEffect(() => {
    if (!activeBank) return;
    const shortcutMap = new Map<string, SamplerPad>();
    activeBank.pads.forEach((p) => {
      if (p.shortcut) shortcutMap.set(p.shortcut.toUpperCase(), p);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      const pad = shortcutMap.get(e.key.toUpperCase());
      if (pad && (pad.fxPreset || pad.customAudioUrl)) {
        e.preventDefault();
        handleTrigger(pad);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (triggerMode !== 'gate') return;
      const pad = shortcutMap.get(e.key.toUpperCase());
      if (pad) {
        handleRelease(pad);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeBank, triggerMode]);

  if (isCollapsed && !isFullPadsView) {
    return (
      <div className="shrink-0 flex items-stretch">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-7 bg-[#101218] hover:bg-[#181B25] border border-[#FACC15]/45 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
          title="Abrir Sampler"
        >
          <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-extrabold tracking-widest uppercase text-[#FACC15]">
            ABRIR SAMPLER
          </span>
        </button>
      </div>
    );
  }

  const bankAPads = activeBank?.pads.slice(0, 16) || [];
  const bankBPads = activeBank?.pads.slice(16, 32) || [];

  const renderPadGrid = (pads: SamplerPad[], title: string) => (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      <p className="text-[10px] font-bold tracking-wider uppercase text-center text-slate-400">
        {title}
      </p>
      <div
        className={`grid grid-cols-4 ${
          isFullPadsView ? 'gap-2.5 flex-1' : 'gap-1.5'
        }`}
      >
        {pads.map((pad) => {
          const isEmpty = !pad.fxPreset && !pad.customAudioUrl;
          const isActive = activePadIds.has(pad.id);
          const isBrightBg =
            pad.color === '#FACC15' ||
            pad.color === '#EAB308' ||
            pad.color === '#2DD4BF';

          return (
            <button
              key={pad.id}
              type="button"
              onPointerDown={() => handleTrigger(pad)}
              onPointerUp={() => handleRelease(pad)}
              onPointerLeave={() => handleRelease(pad)}
              onContextMenu={(e) => {
                e.preventDefault();
                onEditPad(pad);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) onDropAudioOnPad(pad.id, file);
              }}
              style={{
                backgroundColor: isEmpty ? '#0A0B0F' : pad.color,
              }}
              className={`relative rounded-md border transition-all flex flex-col items-center justify-center p-1 select-none cursor-pointer overflow-hidden ${
                isFullPadsView ? 'min-h-[76px]' : 'h-12 sm:h-[52px]'
              } ${
                isActive
                  ? 'scale-95 ring-2 ring-[#FACC15] border-[#FACC15] shadow-[0_0_16px_rgba(250,204,21,0.55)]'
                  : isEmpty
                  ? 'border-white/10 hover:border-[#22D3EE]/50 text-slate-500'
                  : 'border-white/25 hover:brightness-110 shadow-md'
              }`}
              title={
                isEmpty
                  ? `Pad ${pad.id} (Vacío — Clic o Clic Derecho para asignar)`
                  : `${pad.label} (Atajo: ${pad.shortcut} | Clic Derecho = Opciones)`
              }
            >
              {isEmpty ? (
                <span className="text-[10px] font-medium text-slate-500">Empty</span>
              ) : (
                <>
                  <span
                    className={`text-[10px] sm:text-[11px] font-extrabold leading-tight truncate max-w-full px-1 ${
                      isBrightBg ? 'text-slate-950' : 'text-white'
                    }`}
                  >
                    {pad.label}
                  </span>
                  <span
                    className={`mt-0.5 px-1.5 py-[1px] rounded-full text-[8px] font-mono-tabular font-bold ${
                      isBrightBg
                        ? 'bg-black/20 text-slate-900'
                        : 'bg-black/35 text-white/90'
                    }`}
                  >
                    {pad.id}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className={`${
        isFullPadsView
          ? 'w-full h-full flex'
          : 'w-full lg:w-[445px] xl:w-[480px] shrink-0 flex'
      } gap-1.5`}
    >
      {/* Vertical CERRAR SAMPLER tab (hidden in full Pads view and on mobile) */}
      {!isFullPadsView && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden lg:flex w-6 shrink-0 bg-[#0A0B0F] hover:bg-[#181B25] border border-white/15 hover:border-[#FACC15]/50 rounded-lg items-center justify-center cursor-pointer transition-colors"
          title="Ocultar Sampler"
        >
          <span className="[writing-mode:vertical-rl] rotate-180 text-[9px] font-bold tracking-widest uppercase text-slate-400 hover:text-[#FACC15]">
            CERRAR SAMPLER
          </span>
        </button>
      )}

      {/* Main Sampler Chassis */}
      <div className="flex-1 min-w-0 bg-[#101218] border border-white/15 rounded-lg p-3 flex flex-col justify-between overflow-y-auto">
        {/* Top Sampler Header */}
        <div className="flex flex-col gap-2 mb-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Music2 className="w-4 h-4 text-[#EC287B]" />
              <span className="font-display text-xs font-extrabold tracking-wider uppercase text-[#FACC15]">
                Sampler
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-colors ${
                  editMode
                    ? 'bg-[#EC287B] border-[#EC287B] text-white shadow-[0_0_10px_rgba(236,40,123,0.45)]'
                    : 'bg-[#0A0B0F] border-white/15 hover:border-[#FACC15]/60 text-slate-200 hover:text-white'
                }`}
                title="Activa para tocar cualquier Pad y editarlo"
              >
                {editMode ? 'Editando Pads' : 'Editar Pad'}
              </button>
              <span className="hidden sm:inline text-[10px] font-mono-tabular text-[#22D3EE]/80">
                1-4, Q-R, A-F, Z-V
              </span>
            </div>
          </div>

          {/* Bank selector + controls + Mode selector */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <select
                value={activeBank?.id || ''}
                onChange={(e) => onSelectBank(e.target.value)}
                className="px-2.5 py-1 rounded bg-[#0A0B0F] border border-white/15 text-xs font-bold text-white focus:outline-none focus:border-[#22D3EE]"
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onCreateBank}
                className="p-1.5 rounded bg-[#0A0B0F] hover:bg-[#181B25] border border-white/15 hover:border-[#22D3EE]/60 text-[#22D3EE] cursor-pointer"
                title="Nuevo Banco de Samplers"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onRenameBank}
                className="p-1.5 rounded bg-[#0A0B0F] hover:bg-[#181B25] border border-white/15 hover:border-[#FACC15]/60 text-[#FACC15] cursor-pointer"
                title="Renombrar Banco"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onDeleteBank}
                className="p-1.5 rounded bg-[#0A0B0F] hover:bg-red-600/25 border border-white/15 text-slate-300 hover:text-red-400 cursor-pointer"
                title="Eliminar Banco"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex items-center bg-[#0A0B0F] border border-white/15 rounded p-0.5">
                {(['one-shot', 'poly', 'gate'] as TriggerMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeTriggerMode(mode)}
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold capitalize transition-all cursor-pointer border ${
                      triggerMode === mode
                        ? 'bg-[#22D3EE] border-[#22D3EE] text-[#090A0E] shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'one-shot'
                      ? 'One-Shot'
                      : mode === 'poly'
                      ? 'Poly'
                      : 'Gate'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onToggleFullPadsView}
                className="p-1.5 rounded bg-[#0A0B0F] hover:bg-[#181B25] border border-[#FACC15]/55 text-[#FACC15] cursor-pointer"
                title={isFullPadsView ? 'Volver a Vista Mixer' : 'Expandir Pads'}
              >
                {isFullPadsView ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 32-Pad Dual Bank Matrix */}
        <div
          className={`flex-1 grid grid-cols-1 sm:grid-cols-2 ${
            isFullPadsView ? 'gap-5' : 'gap-3'
          } items-stretch`}
        >
          {renderPadGrid(bankAPads, 'Bank A (1-16)')}
          {renderPadGrid(bankBPads, 'Bank B (17-32)')}
        </div>
      </div>
    </div>
  );
};
