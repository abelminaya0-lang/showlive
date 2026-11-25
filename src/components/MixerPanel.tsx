import React, { useEffect } from 'react';
import { ArrowLeftRight, FolderOpen, Repeat } from 'lucide-react';
import { audioEngine } from '../audio/audioEngine';
import { ChannelEqState, DeckId, MixerState } from '../types/showlive';

interface MixerPanelProps {
  mixer: MixerState;
  onChangeChannel: (deck: DeckId, patch: Partial<ChannelEqState>) => void;
  onChangeCrossfader: (value: number) => void;
  onToggleAutoMix: () => void;
  onManualCrossfadeNow: () => void;
  onFocusFiles: () => void;
}

interface HardwareKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  unit?: string;
  onChange: (val: number) => void;
}

const HardwareKnob: React.FC<HardwareKnobProps> = ({
  label,
  value,
  min,
  max,
  defaultValue,
  unit = '',
  onChange,
}) => {
  let angleDeg = 0;
  if (value < defaultValue && defaultValue > min) {
    angleDeg = -135 * ((defaultValue - value) / (defaultValue - min));
  } else if (value > defaultValue && max > defaultValue) {
    angleDeg = 135 * ((value - defaultValue) / (max - defaultValue));
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onDoubleClick={() => onChange(defaultValue)}
        onWheel={(e) => {
          e.preventDefault();
          const step = (max - min) / 24;
          const delta = e.deltaY < 0 ? step : -step;
          const next = Math.max(min, Math.min(max, value + delta));
          onChange(Number(next.toFixed(2)));
        }}
        onPointerDown={(e) => {
          const startY = e.clientY;
          const startVal = value;
          const range = max - min;
          const onMove = (ev: PointerEvent) => {
            const dy = startY - ev.clientY;
            const next = Math.max(min, Math.min(max, startVal + (dy / 110) * range));
            onChange(Number(next.toFixed(2)));
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }}
        title={`${label}: ${value > 0 ? '+' : ''}${value}${unit} (Arrastra arriba/abajo, doble clic = centro)`}
        className="relative w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-[#09090D] p-[2.5px] shadow-[0_2px_6px_rgba(0,0,0,0.85)] flex items-center justify-center cursor-ns-resize group touch-none"
      >
        <div className="w-full h-full rounded-full bg-gradient-to-b from-[#555A65] via-[#3A3E47] to-[#282B33] border border-white/15 group-hover:border-white/35 transition-colors flex items-center justify-center">
          <div
            className="w-full h-full flex items-start justify-center pt-[3px] pointer-events-none"
            style={{ transform: `rotate(${angleDeg}deg)` }}
          >
            <span className="w-[2.5px] h-3 rounded-full bg-white shadow-[0_0_3px_rgba(255,255,255,0.8)]" />
          </div>
        </div>
      </div>
      <span className="text-[11px] font-medium text-slate-400 lowercase leading-none tracking-wide">
        {label}
      </span>
    </div>
  );
};

const TwinRailFader: React.FC<TwinRailFaderProps> = ({
  label,
  volume,
  railFillRefs,
  tipColor,
  onChange,
  compactMobile = false,
}) => {
  const pct = Math.max(0, Math.min(100, (volume / 1.2) * 100));

  return (
    <div
      className={`relative flex items-center justify-center cursor-ns-resize select-none touch-none ${
        compactMobile ? 'w-12 flex-1 min-h-[84px] py-2' : 'w-12 h-[182px] py-2.5'
      }`}
      onDoubleClick={() => onChange(1.0)}
      title={`${label}: ${Math.round((volume / 1.2) * 100)}% (Doble clic = 100%)`}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pad = 10;
        const update = (clientY: number) => {
          const usable = Math.max(1, rect.height - pad * 2);
          const rel = 1 - Math.max(0, Math.min(1, (clientY - (rect.top + pad)) / usable));
          onChange(Number((rel * 1.2).toFixed(2)));
        };
        update(e.clientY);
        const onMove = (ev: PointerEvent) => update(ev.clientY);
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
    >
      {/* Twin black vertical rails with colored bottom tips */}
      <div className="h-full flex items-stretch gap-2.5 relative">
        {[0, 1].map((rail) => (
          <div
            key={rail}
            className="w-[4.5px] h-full rounded-full bg-[#050508] relative overflow-hidden border border-white/[0.04]"
          >
            {/* Live VU level inside rails (updated via DOM ref without React re-renders) */}
            <div
              ref={(el) => {
                railFillRefs.current[rail] = el;
              }}
              className="absolute bottom-0 inset-x-0 opacity-45"
              style={{
                height: '0%',
                backgroundColor: tipColor,
              }}
            />
            {/* Colored tip at the very bottom */}
            <div
              className="absolute bottom-0 inset-x-0 h-[3px]"
              style={{ backgroundColor: tipColor }}
            />
          </div>
        ))}

        {/* Wide metallic grey fader cap */}
        <div
          className="absolute left-1/2 w-11 h-[19px] rounded-[4px] bg-gradient-to-b from-[#969CA6] via-[#676C76] to-[#4A4E58] border border-black shadow-[0_3px_8px_rgba(0,0,0,0.85)] pointer-events-none flex items-center justify-center"
          style={{
            bottom: `calc(${pct}% - ${pct * 0.19}px)`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="w-8 h-[1px] bg-white/35 rounded-full" />
        </div>
      </div>
    </div>
  );
};

interface TwinRailFaderProps {
  label: string;
  volume: number; // 0 to 1.2
  railFillRefs: React.MutableRefObject<Array<HTMLDivElement | null>>;
  tipColor: string;
  onChange: (vol: number) => void;
  compactMobile?: boolean;
}

export const MixerPanel: React.FC<MixerPanelProps> = ({
  mixer,
  onChangeChannel,
  onChangeCrossfader,
  onToggleAutoMix,
  onManualCrossfadeNow,
  onFocusFiles,
}) => {
  const desktopVuARefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const desktopVuBRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const mobileVuARefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const mobileVuBRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let rafId = 0;
    let lastA = -1;
    let lastB = -1;
    const updateVu = () => {
      const a = Math.min(100, Math.round(audioEngine.getDeckFrequencyData('A').level * 100));
      const b = Math.min(100, Math.round(audioEngine.getDeckFrequencyData('B').level * 100));
      if (a !== lastA) {
        lastA = a;
        const h = `${a}%`;
        desktopVuARefs.current.forEach((el) => {
          if (el) el.style.height = h;
        });
        mobileVuARefs.current.forEach((el) => {
          if (el) el.style.height = h;
        });
      }
      if (b !== lastB) {
        lastB = b;
        const h = `${b}%`;
        desktopVuBRefs.current.forEach((el) => {
          if (el) el.style.height = h;
        });
        mobileVuBRefs.current.forEach((el) => {
          if (el) el.style.height = h;
        });
      }
      rafId = requestAnimationFrame(updateVu);
    };
    rafId = requestAnimationFrame(updateVu);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const xfPct = ((mixer.crossfader + 1) / 2) * 100; // 0..100

  const CrossfaderTrack = (
    <div className="pt-1 flex items-center gap-2 px-1 shrink-0">
      <span
        className="text-[10px] text-slate-500 cursor-pointer hover:text-white"
        onClick={() => onChangeCrossfader(-1)}
        title="Ir a Deck A"
      >
        ◀
      </span>

      <div
        className="relative flex-1 h-9 lg:h-10 flex items-center cursor-ew-resize touch-none"
        onDoubleClick={() => onChangeCrossfader(0)}
        title="Crossfader (Doble clic para centrar)"
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pad = 10;
          const update = (clientX: number) => {
            const usable = Math.max(1, rect.width - pad * 2);
            const rel = Math.max(0, Math.min(1, (clientX - (rect.left + pad)) / usable));
            onChangeCrossfader(Number((rel * 2 - 1).toFixed(2)));
          };
          update(e.clientX);
          const onMove = (ev: PointerEvent) => update(ev.clientX);
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }}
      >
        {/* Twin horizontal black rails */}
        <div className="w-full flex flex-col gap-1.5">
          <div className="w-full h-[4px] rounded-full bg-[#050508] border border-white/[0.04]" />
          <div className="w-full h-[4px] rounded-full bg-[#050508] border border-white/[0.04]" />
        </div>

        {/* Vertical metallic grey crossfader cap */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-8 lg:h-9 rounded-[4px] bg-gradient-to-r from-[#969CA6] via-[#676C76] to-[#4A4E58] border border-black shadow-[0_3px_8px_rgba(0,0,0,0.85)] pointer-events-none flex items-center justify-center"
          style={{
            left: `calc(${xfPct}% - ${xfPct * 0.2}px)`,
          }}
        >
          <div className="h-5 lg:h-6 w-[1px] bg-white/35 rounded-full" />
        </div>
      </div>

      <span
        className="text-[10px] text-slate-500 cursor-pointer hover:text-white"
        onClick={() => onChangeCrossfader(1)}
        title="Ir a Deck B"
      >
        ▶
      </span>
    </div>
  );

  return (
    <div className="w-full flex-1 lg:flex-none lg:w-[248px] shrink-0 bg-[#1B1028] border border-white/10 rounded-lg px-2.5 py-2 flex flex-col justify-between select-none min-h-0">
      {/* DESKTOP TOP UTILITY ROW (lg+) */}
      <div className="hidden lg:flex items-center gap-1.5 w-full mb-1">
        <button
          type="button"
          onClick={onFocusFiles}
          className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-white/15 bg-black/30 hover:bg-black/50 text-slate-300 hover:text-white text-[10px] font-bold tracking-wider cursor-pointer transition-colors"
          title="Ir a Biblioteca de Archivos"
        >
          <FolderOpen className="w-3 h-3" />
          <span>FILES</span>
        </button>

        <button
          type="button"
          onClick={onToggleAutoMix}
          className={`flex-1 flex items-center justify-center gap-1 py-1 rounded border text-[10px] font-bold tracking-wider cursor-pointer transition-all ${
            mixer.autoMixEnabled
              ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
              : 'border-white/15 bg-black/30 hover:bg-black/50 text-slate-300 hover:text-white'
          }`}
          title="AutoMix: Al terminar la canción de un Deck, pasa automáticamente al otro Deck"
        >
          <Repeat className="w-3 h-3" />
          <span>{mixer.autoMixEnabled ? 'AUTOMIX ON' : 'AUTOMIX'}</span>
        </button>

        <button
          type="button"
          onClick={onManualCrossfadeNow}
          className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/25 text-amber-300 text-[10px] font-bold cursor-pointer transition-colors"
          title="Hacer transición automática al otro Deck ahora"
        >
          <ArrowLeftRight className="w-3 h-3" />
        </button>
      </div>

      {/* DESKTOP 4-COLUMN HARDWARE MIXER (lg+) */}
      <div className="hidden lg:flex flex-1 items-center justify-between gap-1 px-0.5">
        <div className="flex flex-col items-center justify-evenly h-full py-1">
          <HardwareKnob
            label="mid"
            value={mixer.A.mid}
            min={-24}
            max={12}
            defaultValue={0}
            unit=" dB"
            onChange={(v) => onChangeChannel('A', { mid: v })}
          />
          <HardwareKnob
            label="bass"
            value={mixer.A.low}
            min={-24}
            max={12}
            defaultValue={0}
            unit=" dB"
            onChange={(v) => onChangeChannel('A', { low: v })}
          />
          <HardwareKnob
            label="filter"
            value={mixer.A.filter}
            min={-1}
            max={1}
            defaultValue={0}
            onChange={(v) => onChangeChannel('A', { filter: v })}
          />
        </div>

        <div className="flex items-center justify-center gap-2">
          <TwinRailFader
            label="VOL A"
            volume={mixer.A.volume}
            railFillRefs={desktopVuARefs}
            tipColor="#EA580C"
            onChange={(v) => onChangeChannel('A', { volume: v })}
          />
          <TwinRailFader
            label="VOL B"
            volume={mixer.B.volume}
            railFillRefs={desktopVuBRefs}
            tipColor="#EF4444"
            onChange={(v) => onChangeChannel('B', { volume: v })}
          />
        </div>

        <div className="flex flex-col items-center justify-evenly h-full py-1">
          <HardwareKnob
            label="mid"
            value={mixer.B.mid}
            min={-24}
            max={12}
            defaultValue={0}
            unit=" dB"
            onChange={(v) => onChangeChannel('B', { mid: v })}
          />
          <HardwareKnob
            label="bass"
            value={mixer.B.low}
            min={-24}
            max={12}
            defaultValue={0}
            unit=" dB"
            onChange={(v) => onChangeChannel('B', { low: v })}
          />
          <HardwareKnob
            label="filter"
            value={mixer.B.filter}
            min={-1}
            max={1}
            defaultValue={0}
            onChange={(v) => onChangeChannel('B', { filter: v })}
          />
        </div>
      </div>

      {/* MOBILE CELLULAR MIXER STRUCTURE (< lg) matching cellular reference */}
      <div className="flex lg:hidden flex-1 min-h-0 items-stretch justify-between gap-1.5 px-0.5">
        {/* CH A Column */}
        <div className="flex-1 flex flex-col items-center justify-between py-0.5 min-h-0">
          <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase mb-1">
            CH A
          </span>
          <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 w-full">
            <HardwareKnob
              label="mid"
              value={mixer.A.mid}
              min={-24}
              max={12}
              defaultValue={0}
              unit=" dB"
              onChange={(v) => onChangeChannel('A', { mid: v })}
            />
            <HardwareKnob
              label="bass"
              value={mixer.A.low}
              min={-24}
              max={12}
              defaultValue={0}
              unit=" dB"
              onChange={(v) => onChangeChannel('A', { low: v })}
            />
            <HardwareKnob
              label="filter"
              value={mixer.A.filter}
              min={-1}
              max={1}
              defaultValue={0}
              onChange={(v) => onChangeChannel('A', { filter: v })}
            />
          </div>
          <TwinRailFader
            label="VOL A"
            volume={mixer.A.volume}
            railFillRefs={mobileVuARefs}
            tipColor="#EA580C"
            compactMobile
            onChange={(v) => onChangeChannel('A', { volume: v })}
          />
          <span className="text-[9px] font-bold tracking-wider text-slate-400">
            VOL A
          </span>
        </div>

        {/* Center Action Column: FILES + AUTOMIX + Mix Now */}
        <div className="w-[48px] shrink-0 flex flex-col items-center justify-start gap-1.5 pt-1 border-x border-white/10 px-1">
          <button
            type="button"
            onClick={onFocusFiles}
            className="w-full py-1.5 rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>FILES</span>
          </button>

          <button
            type="button"
            onClick={onToggleAutoMix}
            className={`w-full py-2 rounded border text-[9px] font-extrabold tracking-wide flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all ${
              mixer.autoMixEnabled
                ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                : 'border-white/15 bg-black/35 text-slate-300'
            }`}
            title="AutoMix automático al terminar canción"
          >
            <Repeat className="w-3 h-3" />
            <span>{mixer.autoMixEnabled ? 'AUTO' : 'MIX'}</span>
          </button>

          <button
            type="button"
            onClick={onManualCrossfadeNow}
            className="w-full py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 flex items-center justify-center cursor-pointer"
            title="Cambiar de Deck ahora"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* CH B Column */}
        <div className="flex-1 flex flex-col items-center justify-between py-0.5 min-h-0">
          <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase mb-1">
            CH B
          </span>
          <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 w-full">
            <HardwareKnob
              label="mid"
              value={mixer.B.mid}
              min={-24}
              max={12}
              defaultValue={0}
              unit=" dB"
              onChange={(v) => onChangeChannel('B', { mid: v })}
            />
            <HardwareKnob
              label="bass"
              value={mixer.B.low}
              min={-24}
              max={12}
              defaultValue={0}
              unit=" dB"
              onChange={(v) => onChangeChannel('B', { low: v })}
            />
            <HardwareKnob
              label="filter"
              value={mixer.B.filter}
              min={-1}
              max={1}
              defaultValue={0}
              onChange={(v) => onChangeChannel('B', { filter: v })}
            />
          </div>
          <TwinRailFader
            label="VOL B"
            volume={mixer.B.volume}
            railFillRefs={mobileVuBRefs}
            tipColor="#EF4444"
            compactMobile
            onChange={(v) => onChangeChannel('B', { volume: v })}
          />
          <span className="text-[9px] font-bold tracking-wider text-slate-400">
            VOL B
          </span>
        </div>
      </div>

      {/* Bottom Twin-Rail Hardware Crossfader */}
      {CrossfaderTrack}
    </div>
  );
};
