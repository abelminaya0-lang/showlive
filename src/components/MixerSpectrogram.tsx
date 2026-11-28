import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/audioEngine';

interface MixerSpectrogramProps {
  compact?: boolean;
}

type SpectrogramMode = 'spectrum' | 'waterfall';

const NUM_BARS = 36;
const WATERFALL_W = 160;
const WATERFALL_H = 64;

/**
 * Maps normalized energy [0..1] into the Mashup Reverse hardware heatmap:
 * Silence (#07090D) -> Deep Pink -> Hot Pink (#EC287B) -> Studio Yellow (#FACC15) -> Cyan (#22D3EE) -> White peak
 */
function energyToHeatRgb(v: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, v));
  if (c < 0.03) return [7, 9, 13];
  if (c < 0.35) {
    const t = (c - 0.03) / 0.32;
    return [
      Math.round(7 + (236 - 7) * t),
      Math.round(9 + (40 - 9) * t),
      Math.round(13 + (123 - 13) * t),
    ];
  }
  if (c < 0.68) {
    const t = (c - 0.35) / 0.33;
    return [
      Math.round(236 + (250 - 236) * t),
      Math.round(40 + (204 - 40) * t),
      Math.round(123 + (21 - 123) * t),
    ];
  }
  const t = (c - 0.68) / 0.32;
  return [
    Math.round(250 + (34 - 250) * t * 0.75 + 255 * t * 0.25),
    Math.round(204 + (211 - 204) * t),
    Math.round(21 + (238 - 21) * t),
  ];
}

export const MixerSpectrogram: React.FC<MixerSpectrogramProps> = ({ compact = false }) => {
  const [mode, setMode] = useState<SpectrogramMode>('spectrum');
  const modeRef = useRef<SpectrogramMode>(mode);
  modeRef.current = mode;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 224,
    height: compact ? 38 : 46,
    dpr: 1,
  });

  // Zero-rerender refs for live Bass / Mid / Treble meters
  const bassBarRef = useRef<HTMLDivElement | null>(null);
  const midBarRef = useRef<HTMLDivElement | null>(null);
  const trebleBarRef = useRef<HTMLDivElement | null>(null);
  const bassPctRef = useRef<HTMLSpanElement | null>(null);
  const midPctRef = useRef<HTMLSpanElement | null>(null);
  const treblePctRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(120, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      sizeRef.current = { width: w, height: h, dpr };
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const peaks = new Float32Array(NUM_BARS);
    const smoothedBars = new Float32Array(NUM_BARS);

    // Offscreen canvas for scrolling time-frequency spectrogram (cascada)
    const wfCanvas = document.createElement('canvas');
    wfCanvas.width = WATERFALL_W;
    wfCanvas.height = WATERFALL_H;
    const wfCtx = wfCanvas.getContext('2d');
    if (wfCtx) {
      wfCtx.fillStyle = '#07090D';
      wfCtx.fillRect(0, 0, WATERFALL_W, WATERFALL_H);
    }

    let rafId = 0;
    let lastBass = -1;
    let lastMid = -1;
    let lastTreble = -1;

    const renderFrame = () => {
      const { bins, bass, mid, treble, sampleRate } = audioEngine.getMasterSpectrumData();

      // 1. Update dynamic Bass / Mid / Treble meter bars + numeric % via DOM refs
      const bassPct = Math.round(bass * 100);
      const midPct = Math.round(mid * 100);
      const treblePct = Math.round(treble * 100);

      if (bassPct !== lastBass) {
        lastBass = bassPct;
        if (bassBarRef.current) bassBarRef.current.style.width = `${bassPct}%`;
        if (bassPctRef.current) bassPctRef.current.textContent = `${bassPct}%`;
      }
      if (midPct !== lastMid) {
        lastMid = midPct;
        if (midBarRef.current) midBarRef.current.style.width = `${midPct}%`;
        if (midPctRef.current) midPctRef.current.textContent = `${midPct}%`;
      }
      if (treblePct !== lastTreble) {
        lastTreble = treblePct;
        if (trebleBarRef.current) trebleBarRef.current.style.width = `${treblePct}%`;
        if (treblePctRef.current) treblePctRef.current.textContent = `${treblePct}%`;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const { width, height, dpr } = sizeRef.current;
        if (ctx && width > 0 && height > 0) {
          ctx.save();
          ctx.scale(dpr, dpr);

          // Sample logarithmic frequency bins (20 Hz -> 16 kHz)
          const minHz = 28;
          const maxHz = Math.min(16000, sampleRate * 0.45);
          const fftSize = bins.length * 2;
          const binHz = sampleRate / fftSize;

          const sampleBandEnergy = (normPos: number, span: number): number => {
            const fLow = minHz * Math.pow(maxHz / minHz, Math.max(0, normPos - span * 0.5));
            const fHigh = minHz * Math.pow(maxHz / minHz, Math.min(1, normPos + span * 0.5));
            const iStart = Math.max(0, Math.floor(fLow / binHz));
            const iEnd = Math.max(iStart, Math.min(bins.length - 1, Math.ceil(fHigh / binHz)));
            let maxVal = 0;
            let sum = 0;
            for (let i = iStart; i <= iEnd; i++) {
              const val = bins[i];
              sum += val;
              if (val > maxVal) maxVal = val;
            }
            const avg = sum / Math.max(1, iEnd - iStart + 1);
            // Slight high-frequency compensation so Agudos remain visually lively
            const tiltBoost = 1 + normPos * 0.45;
            return Math.min(1, ((avg * 0.6 + maxVal * 0.4) / 255) * tiltBoost);
          };

          if (modeRef.current === 'waterfall' && wfCtx) {
            // Shift waterfall 2px to the left and paint newest slice on right edge
            wfCtx.drawImage(wfCanvas, -2, 0);
            for (let y = 0; y < WATERFALL_H; y++) {
              // Bottom = low bass (0), Top = high treble (1)
              const normFreq = 1 - y / (WATERFALL_H - 1);
              const e = sampleBandEnergy(normFreq, 0.045);
              const [r, g, b] = energyToHeatRgb(e);
              wfCtx.fillStyle = `rgb(${r},${g},${b})`;
              wfCtx.fillRect(WATERFALL_W - 2, y, 2, 1);
            }

            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(wfCanvas, 0, 0, width, height);

            // Subtle band separator guide lines (Bass/Mid at 33% from bottom, Mid/Treble at 67%)
            const yTreble = Math.round(height * 0.32);
            const yBass = Math.round(height * 0.68);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(0, yTreble + 0.5);
            ctx.lineTo(width, yTreble + 0.5);
            ctx.moveTo(0, yBass + 0.5);
            ctx.lineTo(width, yBass + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            // Spectrum Analyzer Mode (Bars + Peak Hold + Sub-zone background)
            ctx.fillStyle = '#07090D';
            ctx.fillRect(0, 0, width, height);

            // Subtle hardware horizontal & zone grid
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.09)';
            ctx.lineWidth = 1;
            for (let row = 1; row <= 3; row++) {
              const y = Math.round((height * row) / 4) + 0.5;
              ctx.beginPath();
              ctx.moveTo(0, y);
              ctx.lineTo(width, y);
              ctx.stroke();
            }

            // Dynamic reactive zone glow (left = Bajos pink, right = Agudos cyan)
            if (bass > 0.02) {
              const bassGlow = ctx.createRadialGradient(
                width * 0.16,
                height,
                2,
                width * 0.16,
                height,
                width * 0.35
              );
              bassGlow.addColorStop(0, `rgba(236, 40, 123, ${(bass * 0.28).toFixed(3)})`);
              bassGlow.addColorStop(1, 'rgba(236, 40, 123, 0)');
              ctx.fillStyle = bassGlow;
              ctx.fillRect(0, 0, width * 0.5, height);
            }
            if (treble > 0.02) {
              const trebleGlow = ctx.createRadialGradient(
                width * 0.84,
                height,
                2,
                width * 0.84,
                height,
                width * 0.35
              );
              trebleGlow.addColorStop(0, `rgba(34, 211, 238, ${(treble * 0.28).toFixed(3)})`);
              trebleGlow.addColorStop(1, 'rgba(34, 211, 238, 0)');
              ctx.fillStyle = trebleGlow;
              ctx.fillRect(width * 0.5, 0, width * 0.5, height);
            }

            const gap = 1.5;
            const totalGap = gap * (NUM_BARS - 1);
            const barW = Math.max(2, (width - 4 - totalGap) / NUM_BARS);
            const startX = 2;

            for (let b = 0; b < NUM_BARS; b++) {
              const normPos = b / (NUM_BARS - 1);
              const target = sampleBandEnergy(normPos, 1 / NUM_BARS);
              smoothedBars[b] =
                target > smoothedBars[b]
                  ? smoothedBars[b] * 0.35 + target * 0.65
                  : smoothedBars[b] * 0.8 + target * 0.2;

              const val = smoothedBars[b];
              if (val > peaks[b]) {
                peaks[b] = val;
              } else {
                peaks[b] = Math.max(0, peaks[b] - 0.014);
              }

              const x = startX + b * (barW + gap);
              const barH = Math.max(1.5, val * (height - 4));
              const y = height - 2 - barH;

              // Zone color: Bass (0..0.33) -> #EC287B, Mids (0.33..0.66) -> #FACC15, Treble (0.66..1) -> #22D3EE
              let baseColor = '#22D3EE';
              if (normPos < 0.34) {
                baseColor = '#EC287B';
              } else if (normPos < 0.67) {
                baseColor = '#FACC15';
              }

              const grad = ctx.createLinearGradient(0, height - 2, 0, 2);
              grad.addColorStop(0, baseColor);
              grad.addColorStop(0.75, baseColor);
              grad.addColorStop(1, '#FFFFFF');

              ctx.fillStyle = val > 0.015 ? grad : 'rgba(255,255,255,0.08)';
              ctx.fillRect(x, y, barW, barH);

              // Floating peak-hold cap
              if (peaks[b] > 0.03) {
                const peakY = Math.max(1, height - 2 - peaks[b] * (height - 4) - 1.5);
                ctx.fillStyle = normPos < 0.34 ? '#FDA4AF' : normPos < 0.67 ? '#FEF08A' : '#A5F3FC';
                ctx.fillRect(x, peakY, barW, 1.5);
              }
            }
          }

          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="w-full shrink-0 rounded-md bg-[#07090D] border border-white/15 px-1.5 xl:px-2 py-1 xl:py-1.5 flex flex-col gap-0.5 xl:gap-1 shadow-inner">
      {/* Header row: Title + Mode Toggle */}
      <div className="flex items-center justify-between gap-1.5 leading-none">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE] shadow-[0_0_6px_rgba(34,211,238,0.85)]" />
          <span className="text-[8.5px] xl:text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-300">
            ESPECTROGRAMA MASTER
          </span>
        </div>

        <button
          type="button"
          onClick={() => setMode((m) => (m === 'spectrum' ? 'waterfall' : 'spectrum'))}
          className="px-1.5 py-[2px] rounded border border-[#FACC15]/45 bg-[#11131A] hover:bg-[#191D28] text-[8px] xl:text-[8.5px] font-extrabold uppercase tracking-wider text-[#FACC15] cursor-pointer transition-colors"
          title="Cambiar vista entre Barras de Espectro y Cascada de Frecuencias"
        >
          {mode === 'spectrum' ? 'BARRAS' : 'CASCADA'}
        </button>
      </div>

      {/* Real-Time Web Audio Canvas */}
      <div
        ref={containerRef}
        className={`w-full relative rounded-[4px] overflow-hidden border border-white/10 bg-[#07090D] ${
          compact ? 'h-[30px]' : 'h-[36px] md:h-[24px] lg:h-[26px] xl:h-[44px]'
        }`}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>

      {/* Dynamic Bass / Mid / Treble Intensity Meters (updated via DOM refs at 60fps) */}
      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        {/* BAJOS */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center justify-between text-[8px] font-extrabold uppercase tracking-wider leading-none">
            <span className="text-[#EC287B]">BAJOS</span>
            <span ref={bassPctRef} className="font-mono-tabular text-slate-300">
              0%
            </span>
          </div>
          <div className="w-full h-[3.5px] rounded-full bg-[#12151F] overflow-hidden">
            <div
              ref={bassBarRef}
              className="h-full rounded-full bg-[#EC287B] shadow-[0_0_6px_rgba(236,40,123,0.7)]"
              style={{ width: '0%' }}
            />
          </div>
        </div>

        {/* MEDIOS */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center justify-between text-[8px] font-extrabold uppercase tracking-wider leading-none">
            <span className="text-[#FACC15]">MEDIOS</span>
            <span ref={midPctRef} className="font-mono-tabular text-slate-300">
              0%
            </span>
          </div>
          <div className="w-full h-[3.5px] rounded-full bg-[#12151F] overflow-hidden">
            <div
              ref={midBarRef}
              className="h-full rounded-full bg-[#FACC15] shadow-[0_0_6px_rgba(250,204,21,0.7)]"
              style={{ width: '0%' }}
            />
          </div>
        </div>

        {/* AGUDOS */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center justify-between text-[8px] font-extrabold uppercase tracking-wider leading-none">
            <span className="text-[#22D3EE]">AGUDOS</span>
            <span ref={treblePctRef} className="font-mono-tabular text-slate-300">
              0%
            </span>
          </div>
          <div className="w-full h-[3.5px] rounded-full bg-[#12151F] overflow-hidden">
            <div
              ref={trebleBarRef}
              className="h-full rounded-full bg-[#22D3EE] shadow-[0_0_6px_rgba(34,211,238,0.7)]"
              style={{ width: '0%' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
