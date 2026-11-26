import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Disc3,
  Maximize2,
  Mic,
  Minimize2,
  Music,
  Pause,
  Play,
  Sparkles,
  Trash2,
  Youtube,
} from 'lucide-react';
import { audioEngine } from '../audio/audioEngine';
import { getOrCreateDemoTrackUrl } from '../audio/demoTracks';
import { DeckSource, DeckState, StemMode } from '../types/showlive';
import {
  CHROMATIC_NOTES,
  formatKeyIntl,
  getTransposedKey,
  shortestSemitoneDelta,
} from '../utils/musicalNotes';

interface DeckPanelProps {
  deck: DeckState;
  channelVolume: number; // effective gain 0..1.2 * crossfader
  onTogglePlay: () => void;
  onCue: () => void;
  onSeek: (timeSec: number) => void;
  onTimeUpdate: (timeSec: number, durationSec: number) => void;
  onEnded: () => void;
  onChangePitch: (semitones: number) => void;
  onChangeTrackBaseKey?: (musicalKey: string) => void;
  onChangeSource: (source: DeckSource) => void;
  onToggleExpand: () => void;
  onToggleLyricsOverlay: () => void;
  onRequestAiLyrics: () => void;
  onChangeStemMode: (mode: StemMode) => void;
  onSelectYoutubeTab: () => void;
  onUnloadTrack?: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const DeckPanel: React.FC<DeckPanelProps> = ({
  deck,
  channelVolume,
  onTogglePlay,
  onCue,
  onSeek,
  onTimeUpdate,
  onEnded,
  onChangePitch,
  onChangeTrackBaseKey,
  onChangeSource,
  onToggleExpand,
  onToggleLyricsOverlay,
  onRequestAiLyrics,
  onChangeStemMode,
  onSelectYoutubeTab,
  onUnloadTrack,
}) => {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const isPlayingRef = useRef(deck.isPlaying);
  const channelVolumeRef = useRef(channelVolume);
  isPlayingRef.current = deck.isPlaying;
  channelVolumeRef.current = channelVolume;
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [showKeyPicker, setShowKeyPicker] = useState(false);

  const transposed = getTransposedKey(deck.track?.musicalKey, deck.pitchSemitones);

  // Resolve local file URL or synthesized demo WAV URL
  useEffect(() => {
    if (!deck.track || deck.track.sourceType === 'youtube') {
      setResolvedUrl(null);
      return;
    }
    if (deck.track.sourceType === 'file') {
      setResolvedUrl(deck.track.videoUrl || deck.track.audioUrl || null);
      return;
    }
    const url = getOrCreateDemoTrackUrl(deck.track);
    setResolvedUrl(url);
  }, [deck.track]);

  // Attach media element to Web Audio graph
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !resolvedUrl) return;
    audioEngine.attachMediaElement(deck.id, el);
  }, [deck.id, resolvedUrl]);

  // Sync play/pause for local media & YouTube iframe
  useEffect(() => {
    if (deck.source === 'local') {
      const el = mediaRef.current;
      if (!el || !resolvedUrl) return;
      if (deck.isPlaying) {
        audioEngine.resume();
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    } else if (deck.source === 'youtube' && ytIframeRef.current?.contentWindow) {
      const cmd = deck.isPlaying ? 'playVideo' : 'pauseVideo';
      ytIframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: cmd, args: [] }),
        '*'
      );
    }
  }, [deck.isPlaying, deck.source, resolvedUrl]);

  // Sync YouTube volume with mixer fader + crossfader
  useEffect(() => {
    if (deck.source === 'youtube' && ytIframeRef.current?.contentWindow) {
      const volPct = Math.round(Math.max(0, Math.min(1, channelVolume)) * 100);
      ytIframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'setVolume', args: [volPct] }),
        '*'
      );
    }
  }, [deck.source, channelVolume]);

  // Sync seek changes when user scrubs progress bar or hits CUE
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || deck.source !== 'local') return;
    if (Math.abs(el.currentTime - deck.currentTime) > 0.6) {
      el.currentTime = deck.currentTime;
    }
  }, [deck.currentTime, deck.source]);

  // Sync pitch shifter & stem isolation
  useEffect(() => {
    audioEngine.setDeckPitch(deck.id, deck.pitchSemitones);
  }, [deck.id, deck.pitchSemitones]);

  useEffect(() => {
    audioEngine.setDeckStemMode(deck.id, deck.stemMode);
  }, [deck.id, deck.stemMode]);

  // Real-time 60fps audio spectrum visualizer (runs rAF loop only while playing)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    let rafId = 0;
    const drawFrame = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);

      const { bins, level } = audioEngine.getDeckFrequencyData(deck.id);
      const barCount = 48;
      const gap = 3;
      const barWidth = (w - gap * (barCount - 1)) / barCount;

      const accentPrimary = deck.id === 'A' ? '#67E8F9' : '#F472B6';
      const accentSecondary = deck.id === 'A' ? '#22D3EE' : '#EC287B';

      for (let i = 0; i < barCount; i++) {
        const binIdx = Math.min(bins.length - 1, Math.floor((i / barCount) * (bins.length * 0.7)));
        const raw = bins[binIdx] / 255;
        const val = deck.isPlaying ? Math.max(0.06, raw) : 0.04;
        const barH = val * (h * 0.72);
        const x = i * (barWidth + gap);
        const y = h - barH;

        const grad = ctx2d.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, accentPrimary);
        grad.addColorStop(1, accentSecondary);
        ctx2d.fillStyle = grad;
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, barWidth, barH, [3, 3, 0, 0]);
        ctx2d.fill();
      }

      if (deck.isPlaying && level > 0.05) {
        ctx2d.strokeStyle =
          deck.id === 'A'
            ? `rgba(34, 211, 238, ${0.2 + level * 0.4})`
            : `rgba(236, 40, 123, ${0.2 + level * 0.4})`;
        ctx2d.lineWidth = 2;
        ctx2d.beginPath();
        ctx2d.arc(w / 2, h * 0.36, 28 + level * 22, 0, Math.PI * 2);
        ctx2d.stroke();
      }
    };

    drawFrame();
    if (!deck.isPlaying || deck.source !== 'local' || !deck.track || deck.track.isVideo) {
      return;
    }

    const loop = () => {
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [deck.id, deck.isPlaying, deck.source, deck.track]);

  // Active lyric line computation
  const lyrics = deck.track?.lyrics || [];
  let activeLyricIdx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (deck.currentTime >= lyrics[i].timeSec) {
      activeLyricIdx = i;
    }
  }

  const progressPct =
    deck.duration > 0 ? Math.min(100, (deck.currentTime / deck.duration) * 100) : 0;

  const isEndingSoon =
    deck.isPlaying && deck.duration > 8 && deck.duration - deck.currentTime <= 15;

  const isReverse = deck.id === 'B';

  const PitchAndTransportStrip = (
    <div className="relative w-[48px] sm:w-[58px] lg:w-[68px] shrink-0 flex flex-col items-center justify-between py-1.5 lg:py-2 px-1 lg:px-1.5 bg-[#101218] border border-white/15 rounded-lg select-none">
      {/* Musical Note & Semitone readout */}
      <div className="flex flex-col items-center w-full">
        <button
          type="button"
          onClick={() => setShowKeyPicker((v) => !v)}
          className={`w-full py-0.5 lg:py-1 px-0.5 lg:px-1 rounded border text-center transition-colors cursor-pointer mb-1 lg:mb-1.5 ${
            deck.pitchSemitones === 0
              ? 'bg-[#0A0B0F] border-[#22D3EE]/55 text-[#22D3EE] hover:bg-[#22D3EE]/15'
              : deck.pitchSemitones > 0
              ? 'bg-[#0A0B0F] border-[#FACC15]/70 text-[#FACC15] hover:bg-[#FACC15]/15'
              : 'bg-[#0A0B0F] border-[#EC287B]/70 text-[#EC287B] hover:bg-[#EC287B]/15'
          }`}
          title="Elegir nota musical del cantante o tono original de la pista"
        >
          <span className="block text-[10px] lg:text-[11px] font-display font-extrabold leading-none truncate">
            {deck.pitchSemitones === 0 && !deck.track?.musicalKey ? '0' : transposed.latin}
          </span>
          {(deck.pitchSemitones !== 0 || deck.track?.musicalKey) && (
            <span className="hidden lg:block text-[9px] font-mono-tabular opacity-80 leading-none mt-0.5">
              {deck.pitchSemitones > 0
                ? `+${deck.pitchSemitones}`
                : deck.pitchSemitones === 0
                ? '0 st'
                : `${deck.pitchSemitones}`}
            </span>
          )}
        </button>

        {/* Vertical TONO slider */}
        <div
          className="relative h-14 lg:h-24 w-6 flex items-center justify-center cursor-ns-resize touch-none"
          onDoubleClick={() => onChangePitch(0)}
          title="Doble clic para volver al tono original (0)"
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const updateFromY = (clientY: number) => {
              const rel =
                1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
              const semi = Math.round(rel * 24 - 12);
              onChangePitch(semi);
            };
            updateFromY(e.clientY);
            const onMove = (ev: PointerEvent) => updateFromY(ev.clientY);
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
        >
          <div className="w-1 h-full bg-[#090A0E] rounded-full relative border border-white/10">
            <div className="absolute top-1/2 -left-1.5 -right-1.5 h-[1px] bg-[#FACC15]/50" />
            <div
              className="absolute left-1/2 -translate-x-1/2 w-5 h-2 rounded-sm bg-[#FACC15] border border-[#090A0E] shadow-[0_0_6px_rgba(250,204,21,0.5)]"
              style={{
                top: `${((12 - deck.pitchSemitones) / 24) * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          </div>
        </div>

        <span className="text-[8px] lg:text-[9px] font-extrabold tracking-wider text-[#FACC15] mt-0.5 lg:mt-1">
          TONO
        </span>

        {/* - / + Pitch Step Buttons */}
        <div className="flex items-center justify-center gap-0.5 lg:gap-1 mt-0.5 lg:mt-1">
          <button
            type="button"
            onClick={() => onChangePitch(Math.max(-12, deck.pitchSemitones - 1))}
            className="w-[18px] h-[18px] lg:w-5 lg:h-5 rounded bg-[#0A0B0F] hover:bg-[#1C202C] border border-white/20 text-slate-100 text-[11px] lg:text-xs font-bold flex items-center justify-center cursor-pointer"
            title="Bajar 1 semitono"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => onChangePitch(Math.min(12, deck.pitchSemitones + 1))}
            className="w-[18px] h-[18px] lg:w-5 lg:h-5 rounded bg-[#0A0B0F] hover:bg-[#1C202C] border border-white/20 text-slate-100 text-[11px] lg:text-xs font-bold flex items-center justify-center cursor-pointer"
            title="Subir 1 semitono"
          >
            +
          </button>
        </div>
      </div>

      {/* CUE & PLAY circular buttons */}
      <div className="flex flex-col items-center gap-1 lg:gap-1.5 mt-1 lg:mt-1.5">
        <button
          type="button"
          onClick={onCue}
          className="w-8 h-8 lg:w-9 lg:h-9 rounded-full border-2 border-[#FACC15] bg-[#0A0B0F] hover:bg-[#FACC15]/20 text-[#FACC15] text-[8px] lg:text-[9px] font-extrabold tracking-wide flex items-center justify-center transition-colors cursor-pointer active:scale-95 shadow-[0_0_10px_rgba(250,204,21,0.25)]"
          title="CUE: Fijar o volver al punto Cue"
        >
          CUE
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className={`w-8 h-8 lg:w-9 lg:h-9 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            deck.isPlaying
              ? deck.id === 'A'
                ? 'border-[#22D3EE] bg-[#22D3EE] text-[#090A0E] shadow-[0_0_16px_rgba(34,211,238,0.6)]'
                : 'border-[#EC287B] bg-[#EC287B] text-white shadow-[0_0_16px_rgba(236,40,123,0.6)]'
              : deck.id === 'A'
              ? 'border-[#22D3EE] bg-[#0A0B0F] hover:bg-[#22D3EE]/15 text-[#22D3EE]'
              : 'border-[#EC287B] bg-[#0A0B0F] hover:bg-[#EC287B]/15 text-[#EC287B]'
          }`}
          title={deck.isPlaying ? 'Pausar Deck' : 'Reproducir Deck'}
        >
          {deck.isPlaying ? (
            <Pause className="w-3.5 h-3.5 lg:w-4 lg:h-4 fill-current" />
          ) : (
            <Play className="w-3.5 h-3.5 lg:w-4 lg:h-4 fill-current ml-0.5" />
          )}
        </button>
      </div>

      {/* Popover: Musical Key / Singer Note Selector */}
      {showKeyPicker && (
        <div
          className={`fixed inset-x-4 top-16 z-50 lg:inset-auto lg:top-0 lg:z-40 lg:w-64 rounded-xl bg-[#0D1018] border border-white/15 shadow-2xl p-3 space-y-2.5 ${
            isReverse ? 'lg:left-full lg:ml-2' : 'lg:right-full lg:mr-2'
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
            <span className="text-[11px] font-bold text-white">
              Nota Musical del Cantante
            </span>
            <button
              type="button"
              onClick={() => setShowKeyPicker(false)}
              className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
            >
              Cerrar
            </button>
          </div>

          {/* Base key selector */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Tono original de la pista:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onChangeTrackBaseKey?.(
                      formatKeyIntl(transposed.base.rootIndex, false)
                    )
                  }
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                    !transposed.base.isMinor
                      ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40'
                      : 'bg-white/5 text-slate-400'
                  }`}
                >
                  Mayor
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeTrackBaseKey?.(
                      formatKeyIntl(transposed.base.rootIndex, true)
                    )
                  }
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                    transposed.base.isMinor
                      ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40'
                      : 'bg-white/5 text-slate-400'
                  }`}
                >
                  Menor
                </button>
              </div>
            </div>

            <select
              value={transposed.base.rootIndex}
              onChange={(e) => {
                const idx = Number(e.target.value);
                onChangeTrackBaseKey?.(
                  formatKeyIntl(idx, transposed.base.isMinor)
                );
              }}
              className="w-full px-2 py-1 rounded bg-[#141824] border border-white/10 text-[11px] text-white focus:outline-none"
            >
              {CHROMATIC_NOTES.map((n) => (
                <option key={n.index} value={n.index}>
                  {n.latin}
                  {transposed.base.isMinor ? 'm' : ''} ({n.intl}
                  {transposed.base.isMinor ? 'm' : ''})
                </option>
              ))}
            </select>
          </div>

          {/* Target singer note buttons */}
          <div>
            <p className="text-[10px] text-slate-400 mb-1.5">
              Cantar en nota:
            </p>
            <div className="grid grid-cols-4 gap-1">
              {CHROMATIC_NOTES.map((n) => {
                const isSelected = transposed.targetIndex === n.index;
                return (
                  <button
                    key={n.index}
                    type="button"
                    onClick={() => {
                      const delta = shortestSemitoneDelta(
                        transposed.base.rootIndex,
                        n.index
                      );
                      onChangePitch(delta);
                    }}
                    className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#F4256A] border-[#F4256A] text-white'
                        : 'bg-[#141824] hover:bg-[#1D2333] border-white/10 text-slate-200'
                    }`}
                  >
                    {n.latin}
                    {transposed.base.isMinor ? 'm' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onChangePitch(0);
              setShowKeyPicker(false);
            }}
            className="w-full py-1 rounded bg-[#181D2B] hover:bg-[#22293C] border border-white/10 text-[10px] font-semibold text-cyan-300 cursor-pointer"
          >
            Restablecer Tono Original (0)
          </button>
        </div>
      )}
    </div>
  );

  const DeckMonitorSection = (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Main Monitor Frame */}
      <div
        className={`${
          deck.isExpanded
            ? 'fixed inset-3 lg:inset-4 z-50 bg-[#0A0B0F] border-2 border-[#FACC15] rounded-2xl shadow-2xl p-3 lg:p-4 flex flex-col'
            : `relative flex-1 min-h-[120px] lg:min-h-[210px] bg-[#0B0D12] border ${
                isEndingSoon
                  ? 'border-red-500/90'
                  : deck.id === 'A'
                  ? 'border-[#22D3EE]/35'
                  : 'border-[#EC287B]/35'
              } rounded-lg overflow-hidden flex flex-col`
        }`}
      >
        {/* Desktop Deck Header Strip */}
        <div className="hidden lg:flex items-center justify-between gap-2 px-3 py-2 bg-[#101218] border-b border-white/10 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`px-2 py-0.5 rounded border text-[11px] font-extrabold tracking-wide whitespace-nowrap shrink-0 ${
                deck.id === 'A'
                  ? 'bg-[#22D3EE] border-[#22D3EE] text-[#090A0E]'
                  : 'bg-[#EC287B] border-[#EC287B] text-white'
              }`}
            >
              DECK {deck.id}
            </span>
            {deck.track && deck.source === 'local' && (
              <span className="text-xs font-semibold text-slate-100 truncate">
                {deck.track.name}
              </span>
            )}
            {deck.source === 'youtube' && deck.youtubeTitle && (
              <span className="text-xs font-semibold text-[#FACC15] truncate">
                {deck.youtubeTitle}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Stem mode badge if active */}
            {deck.source === 'local' && deck.track && deck.stemMode !== 'full' && (
              <button
                type="button"
                onClick={() => onChangeStemMode('full')}
                className="px-2 py-0.5 rounded bg-[#FACC15]/15 border border-[#FACC15]/60 text-[10px] font-bold text-[#FACC15] hover:bg-[#FACC15]/30 cursor-pointer whitespace-nowrap"
                title="Clic para restaurar pista completa"
              >
                {deck.stemMode === 'instrumental'
                  ? 'Sin Voz (IA)'
                  : deck.stemMode === 'vocals'
                  ? 'Solo Voz'
                  : 'Ritmo & Bajo'}
              </button>
            )}

            {/* Toggle Local / YouTube */}
            <button
              type="button"
              onClick={() =>
                onChangeSource(deck.source === 'local' ? 'youtube' : 'local')
              }
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                deck.source === 'local'
                  ? 'bg-[#0A0B0F] hover:bg-[#191D29] text-[#22D3EE] border-[#22D3EE]/60'
                  : 'bg-[#EC287B] hover:bg-[#F43F8E] text-white border-[#EC287B]'
              }`}
              title="Cambiar entre Audio Local y YouTube Karaoke"
            >
              {deck.source === 'local' ? 'Local' : 'YouTube'}
            </button>

            {/* Expand / Projector toggle */}
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded bg-[#0A0B0F] hover:bg-[#1C202C] border border-white/15 hover:border-[#FACC15]/60 text-slate-200 cursor-pointer"
              title={deck.isExpanded ? 'Minimizar pantalla' : 'Proyectar en grande'}
            >
              {deck.isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5 text-[#FACC15]" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-[#FACC15]" />
              )}
            </button>
          </div>
        </div>

        {/* Viewport Body */}
        <div className="relative flex-1 flex items-center justify-center overflow-hidden studio-wave-grid">
          {/* Ending-Soon Red Warning Banner matching mobile reference */}
          {isEndingSoon && (
            <div className="absolute top-2 inset-x-1.5 z-30 flex items-center justify-center pointer-events-none">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/95 text-white shadow-[0_0_16px_rgba(239,68,68,0.65)] border border-red-300/40">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="text-[9px] lg:text-[10px] font-extrabold tracking-wider uppercase text-center leading-tight">
                  PISTA POR TERMINAR
                </span>
                <AlertTriangle className="w-3 h-3 shrink-0 hidden sm:inline" />
              </div>
            </div>
          )}

          {/* Hidden/Active HTML5 Media Element for Local Audio/Video */}
          {resolvedUrl && (
            <video
              ref={mediaRef}
              src={resolvedUrl}
              playsInline
              className={
                deck.source === 'local' && deck.track?.isVideo
                  ? 'w-full h-full object-contain bg-black'
                  : 'hidden'
              }
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                onTimeUpdate(el.currentTime, el.duration || deck.track?.durationSec || 0);
              }}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                onTimeUpdate(el.currentTime, el.duration || deck.track?.durationSec || 0);
              }}
              onEnded={onEnded}
            />
          )}

          {/* YOUTUBE MODE */}
          {deck.source === 'youtube' ? (
            deck.youtubeId ? (
              <div className="relative w-full h-full">
                <iframe
                  key={deck.youtubeId}
                  ref={ytIframeRef}
                  className="w-full h-full border-0"
                  src={`https://www.youtube.com/embed/${deck.youtubeId}?enablejsapi=1&autoplay=0&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(
                    typeof window !== 'undefined' ? window.location.origin : ''
                  )}`}
                  title={`Deck ${deck.id} YouTube Karaoke`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  onLoad={() => {
                    const win = ytIframeRef.current?.contentWindow;
                    if (!win) return;
                    const volPct = Math.round(
                      Math.max(0, Math.min(1, channelVolumeRef.current)) * 100
                    );
                    win.postMessage(
                      JSON.stringify({ event: 'command', func: 'setVolume', args: [volPct] }),
                      '*'
                    );
                    win.postMessage(
                      JSON.stringify({
                        event: 'command',
                        func: isPlayingRef.current ? 'playVideo' : 'pauseVideo',
                        args: [],
                      }),
                      '*'
                    );
                  }}
                />
                <a
                  href={`https://www.youtube.com/watch?v=${deck.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded bg-black/75 hover:bg-red-600 text-[9px] font-semibold text-slate-200 hover:text-white border border-white/15 transition-colors"
                  title="Abrir en YouTube si el video restringe reproducción incrustada"
                >
                  YT ↗
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-2 lg:p-4 gap-2 lg:gap-3">
                <div className="w-9 h-9 lg:w-12 lg:h-12 rounded-full bg-red-600/15 border border-red-500/30 flex items-center justify-center">
                  <Youtube className="w-4 h-4 lg:w-6 lg:h-6 text-red-400" />
                </div>
                <div className="hidden lg:block">
                  <p className="text-xs font-semibold text-slate-200">
                    Modo YouTube Karaoke — Deck {deck.id}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Busca un karaoke en la pestaña YouTube Karaoke y cárgalo aquí.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onSelectYoutubeTab}
                  className="px-2.5 py-1 lg:px-3 lg:py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-[10px] lg:text-xs font-semibold cursor-pointer"
                >
                  Buscar YouTube
                </button>
              </div>
            )
          ) : !deck.track ? (
            /* IDLE WATERMARK STATE */
            <div className="flex flex-col items-center justify-center select-none pointer-events-none">
              <div
                className={`w-9 h-9 lg:w-14 lg:h-14 rounded-full bg-[#101218] border-2 ${
                  deck.id === 'A'
                    ? 'border-[#22D3EE]/60 shadow-[0_0_16px_rgba(34,211,238,0.2)]'
                    : 'border-[#EC287B]/60 shadow-[0_0_16px_rgba(236,40,123,0.2)]'
                } flex items-center justify-center mb-1.5 lg:mb-3`}
              >
                <Mic
                  className={`w-4 h-4 lg:w-6 lg:h-6 ${
                    deck.id === 'A' ? 'text-[#22D3EE]' : 'text-[#EC287B]'
                  }`}
                />
              </div>
              <span className="font-display text-[9px] lg:text-xs tracking-[0.3em] lg:tracking-[0.35em] font-bold text-[#FACC15]/75 uppercase">
                ShowLive
              </span>
            </div>
          ) : (
            /* LOCAL TRACK LOADED STATE (Canvas Visualizer + Karaoke Lyrics) */
            <div className="relative w-full h-full flex flex-col justify-between">
              {!deck.track.isVideo && (
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={220}
                  className="absolute inset-0 w-full h-full opacity-90 pointer-events-none"
                />
              )}

              {/* Top Info Overlay */}
              <div className="relative z-10 hidden lg:flex items-center justify-between px-3 py-2 pointer-events-auto">
                <div className="flex items-center gap-2 text-[11px] font-mono-tabular text-slate-300 bg-black/50 px-2 py-1 rounded">
                  <Disc3
                    className={`w-3.5 h-3.5 ${
                      deck.id === 'A' ? 'text-cyan-400' : 'text-[#F4256A]'
                    } ${deck.isPlaying ? 'animate-spin' : ''}`}
                    style={{ animationDuration: '3s' }}
                  />
                  <span>{deck.track.bpm ? `${deck.track.bpm} BPM` : 'AUDIO'}</span>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => setShowKeyPicker((v) => !v)}
                    className="text-cyan-300 hover:text-white cursor-pointer"
                    title="Cambiar tono original o nota musical del cantante"
                  >
                    Tono: {transposed.latin} ({transposed.intl})
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {deck.track.hasAiLyrics ? (
                    <button
                      type="button"
                      onClick={onToggleLyricsOverlay}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border cursor-pointer ${
                        deck.showLyricsOverlay
                          ? 'bg-[#F4256A]/25 border-[#F4256A] text-white'
                          : 'bg-black/50 border-white/15 text-slate-300'
                      }`}
                    >
                      <Music className="w-3 h-3" />
                      <span>Letra {deck.showLyricsOverlay ? 'ON' : 'OFF'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onRequestAiLyrics}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/40 text-[10px] font-semibold text-purple-100 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Generar Letra IA</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Karaoke Lyrics Overlay */}
              {deck.showLyricsOverlay && lyrics.length > 0 && (
                <div className="relative z-10 px-2 lg:px-4 py-2 lg:py-3 text-center bg-gradient-to-t from-black/85 via-black/55 to-transparent mt-auto">
                  {activeLyricIdx > 0 && (
                    <p className="text-[10px] lg:text-[11px] text-slate-400 truncate">
                      {lyrics[activeLyricIdx - 1]?.text}
                    </p>
                  )}
                  <p
                    className={`font-display font-bold leading-snug my-0.5 lg:my-1 ${
                      deck.isExpanded
                        ? 'text-2xl sm:text-3xl'
                        : 'text-xs lg:text-base'
                    } text-white drop-shadow`}
                  >
                    {lyrics[Math.max(0, activeLyricIdx)]?.text}
                  </p>
                  {lyrics[Math.max(0, activeLyricIdx) + 1] && (
                    <p className="text-[10px] lg:text-[11px] text-slate-400 truncate">
                      {lyrics[Math.max(0, activeLyricIdx) + 1]?.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress Scrub Bar & Timestamps */}
      <div className="mt-1 lg:mt-1.5 flex flex-col lg:flex-row lg:items-center gap-0.5 lg:gap-2.5 px-0.5 lg:px-1">
        <div className="flex items-center justify-between lg:contents">
          <span className="text-[10px] lg:text-[11px] font-mono-tabular text-slate-400 lg:w-9 text-left shrink-0">
            {formatTime(deck.currentTime)}
          </span>
          <span className="text-[10px] lg:text-[11px] font-mono-tabular text-slate-400 lg:hidden shrink-0">
            {formatTime(deck.duration)}
          </span>
        </div>

        <div
          className="relative flex-1 h-1.5 lg:h-2 bg-[#101218] border border-white/10 rounded-full cursor-pointer group overflow-hidden"
          onClick={(e) => {
            if (deck.source !== 'local' || !deck.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSeek(ratio * deck.duration);
          }}
        >
          <div
            className={`h-full rounded-full transition-all duration-75 ${
              isEndingSoon
                ? 'bg-gradient-to-r from-[#EC287B] to-[#FACC15]'
                : deck.id === 'A'
                ? 'bg-gradient-to-r from-[#22D3EE] to-[#FACC15]'
                : 'bg-gradient-to-r from-[#EC287B] to-[#FACC15]'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <span className="hidden lg:inline text-[11px] font-mono-tabular text-slate-300 w-9 text-right shrink-0">
          {formatTime(deck.duration)}
        </span>
      </div>
    </div>
  );

  return (
    <div
      className={`flex-1 min-w-0 flex flex-col gap-1 lg:gap-0 lg:flex-row lg:items-stretch lg:gap-2 p-1 lg:p-0 rounded-lg lg:rounded-none border lg:border-0 ${
        isEndingSoon ? 'border-red-500/80 bg-red-950/10 lg:bg-transparent' : 'border-white/10 bg-[#101218] lg:bg-transparent'
      }`}
    >
      {/* Mobile-only Deck Header */}
      <div className="flex lg:hidden flex-col gap-1 px-0.5 pt-0.5">
        <div className="flex items-center justify-between gap-1">
          <span
            className={`px-1.5 py-0.5 rounded border text-[10px] font-extrabold tracking-wide whitespace-nowrap ${
              deck.id === 'A'
                ? 'bg-[#22D3EE] border-[#22D3EE] text-[#090A0E]'
                : 'bg-[#EC287B] border-[#EC287B] text-white'
            }`}
          >
            DECK {deck.id}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                onChangeSource(deck.source === 'local' ? 'youtube' : 'local')
              }
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                deck.source === 'local'
                  ? 'bg-[#0A0B0F] text-[#22D3EE] border-[#22D3EE]/60'
                  : 'bg-[#EC287B] text-white border-[#EC287B]'
              }`}
            >
              {deck.source === 'local' ? 'Local' : 'YT'}
            </button>
            <button
              type="button"
              onClick={() => onUnloadTrack?.()}
              className="p-1 rounded bg-[#141824] border border-white/10 text-slate-400 hover:text-red-400 cursor-pointer"
              title={`Limpiar Deck ${deck.id}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded bg-[#141824] border border-white/10 text-slate-300 cursor-pointer"
              title="Expandir pantalla"
            >
              {deck.isExpanded ? (
                <Minimize2 className="w-3 h-3" />
              ) : (
                <Maximize2 className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (deck.track) {
              if (deck.track.hasAiLyrics) onToggleLyricsOverlay();
              else onRequestAiLyrics();
            } else {
              onSelectYoutubeTab();
            }
          }}
          className={`w-fit inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold cursor-pointer ${
            deck.showLyricsOverlay && deck.track?.hasAiLyrics
              ? 'bg-purple-600/35 border-purple-400 text-purple-100'
              : 'bg-[#171126] border-purple-500/45 text-purple-300'
          }`}
        >
          <Mic className="w-2.5 h-2.5" />
          <span>Karaoke IA</span>
        </button>
      </div>

      {/* Monitor + Pitch/Transport Strip */}
      <div className="flex-1 min-w-0 flex items-stretch gap-1 lg:gap-2">
        {isReverse ? (
          <>
            {PitchAndTransportStrip}
            {DeckMonitorSection}
          </>
        ) : (
          <>
            {DeckMonitorSection}
            {PitchAndTransportStrip}
          </>
        )}
      </div>
    </div>
  );
};
