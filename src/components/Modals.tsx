import React, { useRef, useState } from 'react';
import {
  Loader2,
  Mic,
  Music,
  Play,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { audioEngine } from '../audio/audioEngine';
import { FX_PRESET_LABELS } from '../audio/demoTracks';
import {
  DeckId,
  DeckState,
  IAModelConfig,
  LyricLine,
  PadFxPreset,
  SamplerPad,
  StemMode,
  TrackItem,
} from '../types/showlive';

/* -------------------- 1. LETRA IA MODAL -------------------- */
interface AiLyricsModalProps {
  track: TrackItem;
  aiConfig: IAModelConfig;
  onClose: () => void;
  onSaveLyrics: (
    trackId: string,
    lyrics: LyricLine[],
    meta?: { bpm?: number; musicalKey?: string; artist?: string }
  ) => void;
  onProjectToDeck: (track: TrackItem, deck: DeckId) => void;
}

export const AiLyricsModal: React.FC<AiLyricsModalProps> = ({
  track,
  aiConfig,
  onClose,
  onSaveLyrics,
  onProjectToDeck,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LyricLine[]>(track.lyrics || []);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackName: track.name,
          artist: track.artist,
          durationSec: track.durationSec || 180,
          language: aiConfig.language,
          model: aiConfig.model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al generar Letra IA.');
      }
      const nextLines: LyricLine[] = Array.isArray(data.lines) ? data.lines : [];
      setLines(nextLines);
      onSaveLyrics(track.id, nextLines, {
        bpm: data.bpm,
        musicalKey: data.musicalKey,
        artist: data.detectedArtist,
      });
    } catch (err: any) {
      setError(err?.message || 'Error conectando con Gemini.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-xl bg-[#0D1018] border border-white/15 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0A0C12]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-4 h-4 text-[#F4256A] shrink-0" />
            <div className="min-w-0">
              <h3 className="font-display text-sm font-bold text-white truncate">
                Letra IA Karaoke — {track.name}
              </h3>
              <p className="text-[11px] text-slate-400">
                Sincronización automática para proyección en vivo ({aiConfig.model})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/35 text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#F4256A] to-[#9333EA] hover:brightness-110 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {lines.length > 0 ? 'Regenerar Letra IA' : 'Generar Letra Sincronizada'}
              </span>
            </button>

            {lines.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onProjectToDeck({ ...track, lyrics: lines, hasAiLyrics: true }, 'A');
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-md bg-blue-600/25 hover:bg-blue-600 border border-blue-500/40 text-blue-300 hover:text-white text-xs font-bold cursor-pointer"
                >
                  Proyectar en Deck A
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onProjectToDeck({ ...track, lyrics: lines, hasAiLyrics: true }, 'B');
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-md bg-[#F4256A]/25 hover:bg-[#F4256A] border border-[#F4256A]/40 text-[#F973A2] hover:text-white text-xs font-bold cursor-pointer"
                >
                  Proyectar en Deck B
                </button>
              </div>
            )}
          </div>

          {lines.length === 0 && !loading ? (
            <div className="py-10 text-center border border-dashed border-white/10 rounded-xl">
              <Music className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-300 font-medium">
                Aún no hay letra cargada para esta pista
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Haz clic en &ldquo;Generar Letra Sincronizada&rdquo; para crear el guion karaoke con IA.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2.5 p-2 rounded-lg bg-[#121622] border border-white/5"
                >
                  <span className="w-12 text-center font-mono-tabular text-[11px] text-cyan-400 shrink-0">
                    {Math.floor(line.timeSec / 60)}:
                    {Math.floor(line.timeSec % 60)
                      .toString()
                      .padStart(2, '0')}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-semibold text-slate-400 shrink-0">
                    {line.section}
                  </span>
                  <input
                    type="text"
                    value={line.text}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...line, text: e.target.value };
                      setLines(next);
                      onSaveLyrics(track.id, next);
                    }}
                    className="flex-1 bg-transparent text-xs text-white focus:outline-none focus:border-b focus:border-[#F4256A]"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------- 2. SEPARAR PISTA (IA) MODAL -------------------- */
interface StemSeparatorModalProps {
  deckA: DeckState;
  deckB: DeckState;
  aiConfig: IAModelConfig;
  onApplyStem: (
    deck: DeckId,
    mode: StemMode,
    recommendedEq?: { high: number; mid: number; low: number }
  ) => void;
  onClose: () => void;
}

export const StemSeparatorModal: React.FC<StemSeparatorModalProps> = ({
  deckA,
  deckB,
  aiConfig,
  onApplyStem,
  onClose,
}) => {
  const [targetDeck, setTargetDeck] = useState<DeckId>(deckA.track ? 'A' : 'B');
  const activeDeck = targetDeck === 'A' ? deckA : deckB;
  const [selectedMode, setSelectedMode] = useState<StemMode>(activeDeck.stemMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<{
    genre: string;
    bpm: number;
    key: string;
    vocalTip: string;
    recommendedEq: { highDb: number; midDb: number; lowDb: number };
  } | null>(null);

  const handleAnalyzeAndApply = async () => {
    onApplyStem(targetDeck, selectedMode);
    if (!activeDeck.track) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/stems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackName: activeDeck.track.name,
          targetMode: selectedMode,
          model: aiConfig.model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo analizar la pista con IA.');
      }
      setAiAnalysis(data);
      if (data.recommendedEq) {
        onApplyStem(targetDeck, selectedMode, {
          high: Number(data.recommendedEq.highDb) || 0,
          mid: Number(data.recommendedEq.midDb) || 0,
          low: Number(data.recommendedEq.lowDb) || 0,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Error en análisis IA.');
    } finally {
      setLoading(false);
    }
  };

  const stemOptions: { id: StemMode; title: string; desc: string }[] = [
    {
      id: 'full',
      title: 'Pista Completa (Original)',
      desc: 'Audio estéreo original sin filtros de separación.',
    },
    {
      id: 'instrumental',
      title: 'Instrumental / Karaoke (Sin Voz)',
      desc: 'Cancelación Mid-Side en tiempo real manteniendo graves profundos.',
    },
    {
      id: 'vocals',
      title: 'Acapella / Solo Voz',
      desc: 'Aislamiento espectral de frecuencias vocales centrales.',
    },
    {
      id: 'drums_bass',
      title: 'Base Rítmica (Percusión & Bajo)',
      desc: 'Enfoque en bombo, bajo tumbao y brillo de percusión para mezcla.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-[#0D1018] border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0A0C12]">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <h3 className="font-display text-sm font-bold text-white">
              Separar Pista (IA) — Aislamiento DSP en Vivo
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Deck Switcher */}
          <div className="grid grid-cols-2 gap-2">
            {(['A', 'B'] as DeckId[]).map((d) => {
              const dk = d === 'A' ? deckA : deckB;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setTargetDeck(d);
                    setSelectedMode(dk.stemMode);
                  }}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                    targetDeck === d
                      ? 'bg-purple-600/20 border-purple-400 text-white'
                      : 'bg-[#121622] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  <p className="text-xs font-bold">DECK {d}</p>
                  <p className="text-[11px] truncate text-slate-300 mt-0.5">
                    {dk.track ? dk.track.name : 'Sin pista local cargada'}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Stem Mode Selector */}
          <div className="space-y-2">
            {stemOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSelectedMode(opt.id);
                  onApplyStem(targetDeck, opt.id);
                }}
                className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                  selectedMode === opt.id
                    ? 'bg-[#1D1530] border-purple-500 text-white'
                    : 'bg-[#121520] border-white/10 text-slate-300 hover:border-white/20'
                }`}
              >
                <p className="text-xs font-bold">{opt.title}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {error && (
            <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-200">
              {error}
            </div>
          )}

          {aiAnalysis && (
            <div className="p-3 rounded-lg bg-[#111927] border border-cyan-500/30 space-y-1.5 text-xs">
              <div className="flex items-center justify-between font-mono-tabular text-cyan-300 font-bold">
                <span>{aiAnalysis.genre}</span>
                <span>
                  {aiAnalysis.bpm} BPM · Key {aiAnalysis.key}
                </span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {aiAnalysis.vocalTip}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#161B26] hover:bg-[#1E2434] text-xs font-semibold text-slate-300 cursor-pointer"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleAnalyzeAndApply}
              disabled={loading || !activeDeck.track}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:brightness-110 disabled:opacity-50 text-xs font-bold text-white cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>Optimizar EQ con Gemini IA</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------- 3. IA MODEL SETTINGS MODAL -------------------- */
interface AiModelModalProps {
  config: IAModelConfig;
  onChange: (next: IAModelConfig) => void;
  onClose: () => void;
}

export const AiModelModal: React.FC<AiModelModalProps> = ({
  config,
  onChange,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[#0D1018] border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0A0C12]">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h3 className="font-display text-sm font-bold text-white">
              Configuración de Motor IA
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Modelo Gemini para Letra IA y Análisis Musical
            </label>
            <select
              value={config.model}
              onChange={(e) =>
                onChange({
                  ...config,
                  model: e.target.value as IAModelConfig['model'],
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[#141824] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-400"
            >
              <option value="gemini-4-hydrogen">
                Gemini 4 Hydrogen (Recomendado — Rápido y preciso)
              </option>
              <option value="gemini-3.1-flash-lite">
                Gemini 3.1 Flash Lite (Ultra baja latencia)
              </option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Idioma principal para Letra IA
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['es', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onChange({ ...config, language: lang })}
                  className={`py-2 rounded-lg border text-xs font-semibold cursor-pointer ${
                    config.language === lang
                      ? 'bg-[#F4256A]/20 border-[#F4256A] text-white'
                      : 'bg-[#141824] border-white/10 text-slate-400'
                  }`}
                >
                  {lang === 'es' ? 'Español' : 'English'}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between p-3 rounded-lg bg-[#121520] border border-white/10 cursor-pointer">
            <span className="text-xs font-medium text-slate-200">
              Mostrar Letra IA automáticamente al cargar pista
            </span>
            <input
              type="checkbox"
              checked={config.autoSyncLyrics}
              onChange={(e) =>
                onChange({ ...config, autoSyncLyrics: e.target.checked })
              }
              className="accent-[#F4256A] w-4 h-4"
            />
          </label>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#F4256A] hover:bg-[#FF3478] text-xs font-bold text-white cursor-pointer"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------- 4. SAMPLER PAD OPTIONS MODAL -------------------- */
interface PadEditorModalProps {
  pad: SamplerPad;
  onSave: (updated: SamplerPad, uploadedFile?: File) => void;
  onClose: () => void;
}

const PAD_COLORS = [
  '#E11D48',
  '#EA580C',
  '#9333EA',
  '#FACC15',
  '#EAB308',
  '#2DD4BF',
  '#2563EB',
  '#10B981',
  '#EC4899',
];

export const PadEditorModal: React.FC<PadEditorModalProps> = ({
  pad,
  onSave,
  onClose,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<SamplerPad>({ ...pad });
  const [uploadedFile, setUploadedFile] = useState<File | undefined>(undefined);

  const handleUploadAudio = (file: File) => {
    const url = URL.createObjectURL(file);
    const cleanName = file.name.replace(/\.[^.]+$/, '').slice(0, 12);
    const next: SamplerPad = {
      ...draft,
      label: draft.label === 'Empty' ? cleanName : draft.label,
      color: draft.color === '#181C26' ? '#E11D48' : draft.color,
      customAudioUrl: url,
      customAudioName: file.name,
      fxPreset: undefined,
    };
    setDraft(next);
    setUploadedFile(file);
    audioEngine.preloadPad(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[#0D1018] border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0A0C12]">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-[#F4256A]" />
            <h3 className="font-display text-sm font-bold text-white">
              Opciones del Pad #{pad.id} (Tecla: {pad.shortcut})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Nombre del Botón
            </label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[#141824] border border-white/10 text-xs text-white focus:outline-none focus:border-[#F4256A]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Color del Pad
            </label>
            <div className="flex flex-wrap gap-2">
              {PAD_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setDraft({ ...draft, color: hex })}
                  style={{ backgroundColor: hex }}
                  className={`w-7 h-7 rounded-md cursor-pointer transition-transform ${
                    draft.color === hex
                      ? 'ring-2 ring-white scale-110'
                      : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-300">
              Sonido / Efecto
            </label>
            <div className="grid grid-cols-1 gap-2">
              <select
                value={draft.fxPreset || ''}
                onChange={(e) => {
                  const preset = e.target.value as PadFxPreset;
                  if (!preset) return;
                  const meta = FX_PRESET_LABELS.find((f) => f.id === preset);
                  setDraft({
                    ...draft,
                    fxPreset: preset,
                    customAudioUrl: undefined,
                    customAudioName: undefined,
                    label:
                      draft.label === 'Empty' && meta
                        ? meta.label.slice(0, 10)
                        : draft.label,
                    color: draft.color === '#181C26' ? '#9333EA' : draft.color,
                  });
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#141824] border border-white/10 text-xs text-white focus:outline-none"
              >
                <option value="">-- Seleccionar Efecto Studio Integrado --</option>
                {FX_PRESET_LABELS.map((fx) => (
                  <option key={fx.id} value={fx.id}>
                    {fx.label}
                  </option>
                ))}
              </select>

              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadAudio(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#161B28] hover:bg-[#1F2638] border border-white/10 text-xs font-semibold text-cyan-300 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {draft.customAudioName
                    ? `Archivo: ${draft.customAudioName}`
                    : 'Cargar Audio Local (.mp3 / .wav)'}
                </span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-bold text-slate-300">Volumen del Pad</span>
              <span className="font-mono-tabular text-cyan-400">
                {Math.round(draft.volume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={draft.volume}
              onChange={(e) =>
                setDraft({ ...draft, volume: parseFloat(e.target.value) })
              }
              className="w-full accent-[#F4256A]"
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-white/10">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  audioEngine.resume();
                  audioEngine.triggerPad(draft, 'one-shot');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 text-xs font-bold cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Probar</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSave({
                    ...draft,
                    label: 'Empty',
                    color: '#181C26',
                    fxPreset: undefined,
                    customAudioUrl: undefined,
                    customAudioName: undefined,
                  });
                  onClose();
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/15 hover:bg-red-600/30 border border-red-500/30 text-red-300 text-xs font-semibold cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpiar</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onSave(draft, uploadedFile);
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-[#F4256A] hover:bg-[#FF3478] text-xs font-bold text-white cursor-pointer"
            >
              Guardar Pad
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
