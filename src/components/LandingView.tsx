import React from 'react';
import {
  ArrowRight,
  AudioWaveform,
  FolderOpen,
  Grid,
  Mic,
  Music,
  Play,
  Sliders,
  Youtube,
} from 'lucide-react';

interface LandingViewProps {
  onOpenStudio: (initialTab?: 'local' | 'youtube') => void;
}

export const LandingView: React.FC<LandingViewProps> = ({ onOpenStudio }) => {
  return (
    <div className="min-h-screen w-full bg-[#090A0F] text-slate-100 flex items-center justify-center relative overflow-hidden">
      {/* Subtle stage ambient glow */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full opacity-20 blur-[140px]"
        style={{ background: 'radial-gradient(circle, #F4256A 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 right-0 w-[520px] h-[520px] rounded-full opacity-15 blur-[140px]"
        style={{ background: 'radial-gradient(circle, #2563EB 0%, transparent 70%)' }}
      />

      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center relative z-10">
        {/* Left Visual Stage & Tablet Console Preview */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-white/10 bg-[#0D1018] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.7)] relative">
            {/* Stage Lighting Backdrop */}
            <div className="relative p-6 sm:p-8 bg-gradient-to-br from-[#1B1020] via-[#0F121D] to-[#090B11]">
              {/* Stage spotlight beams */}
              <div
                className="pointer-events-none absolute inset-0 opacity-45"
                style={{
                  background:
                    'radial-gradient(circle at 20% 20%, rgba(244,37,106,0.28), transparent 45%), radial-gradient(circle at 80% 15%, rgba(59,130,246,0.24), transparent 45%)',
                }}
              />

              {/* Promo Header inside Stage Frame */}
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F4256A] to-[#BE123C] flex items-center justify-center shadow-lg shadow-[#F4256A]/30">
                    <Mic className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-display text-2xl font-extrabold tracking-tight">
                    <span className="text-white">Show</span>
                    <span className="text-[#F4256A]">Live</span>
                  </span>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-display text-lg sm:text-xl font-extrabold uppercase tracking-tight leading-tight text-white">
                    Todo tu show desde una sola{' '}
                    <span className="text-[#F4256A]">App</span>
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">
                    La{' '}
                    <span className="text-[#F4256A] font-semibold">herramienta</span>{' '}
                    que todo{' '}
                    <span className="text-[#F4256A] font-semibold">artista en vivo</span>{' '}
                    necesita
                  </p>
                </div>
              </div>

              {/* Embedded Interactive Tablet Console Mockup */}
              <div
                onClick={() => onOpenStudio('local')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenStudio('local');
                }}
                className="relative z-10 rounded-xl border-4 border-[#1F2433] bg-[#080A0F] shadow-2xl overflow-hidden cursor-pointer group transition-transform duration-200 hover:scale-[1.01]"
              >
                {/* Mini Top Bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-[#0B0E15] border-b border-white/10">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-[#F4256A] flex items-center justify-center">
                      <Mic className="w-2.5 h-2.5 text-white" />
                    </div>
                    <span className="text-[11px] font-bold">
                      Show<span className="text-[#F4256A]">Live</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono-tabular text-slate-400">
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-white">MIXER</span>
                    <span>PADS</span>
                    <span className="text-emerald-400">60 FPS</span>
                  </div>
                </div>

                {/* Mini Dual Decks + Mixer */}
                <div className="p-3 grid grid-cols-12 gap-2.5">
                  {/* Mini Deck A */}
                  <div className="col-span-5 rounded-lg border border-white/10 bg-[#0D1018] p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-200">
                        DECK A
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 border border-blue-500/40">
                        Local
                      </span>
                    </div>
                    <div className="h-20 rounded bg-gradient-to-br from-slate-900 to-[#111827] border border-white/5 flex flex-col items-center justify-center gap-1.5 px-3">
                      <div className="w-full flex items-end justify-center gap-0.5 h-10">
                        {[38, 68, 52, 85, 92, 60, 74, 96, 65, 45, 82, 70, 50, 88, 62, 42].map(
                          (h, i) => (
                            <span
                              key={i}
                              className="w-1.5 rounded-t bg-gradient-to-t from-[#06B6D4] to-[#F4256A]"
                              style={{ height: `${h}%` }}
                            />
                          )
                        )}
                      </div>
                      <span className="text-[10px] text-slate-300 truncate max-w-full">
                        98. Ismael Rivera - El Nazareno.mp3
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[9px] font-mono-tabular text-slate-400">
                      <span>01:24</span>
                      <span className="text-cyan-400">TONO +2</span>
                      <span>04:05</span>
                    </div>
                  </div>

                  {/* Mini Mixer */}
                  <div className="col-span-2 rounded-lg border border-white/10 bg-[#0B0D14] p-2 flex flex-col items-center justify-between">
                    <span className="text-[9px] font-bold text-cyan-400">MIX</span>
                    <div className="grid grid-cols-2 gap-1.5 my-1">
                      {[1, 2, 3, 4, 5, 6].map((k) => (
                        <div
                          key={k}
                          className="w-3.5 h-3.5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center"
                        >
                          <div className="w-0.5 h-1.5 bg-cyan-400 rounded-full -translate-y-0.5" />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 items-end h-10">
                      <div className="w-1.5 h-full rounded bg-slate-800 relative overflow-hidden">
                        <div className="absolute bottom-0 inset-x-0 h-4/5 bg-cyan-400" />
                      </div>
                      <div className="w-1.5 h-full rounded bg-slate-800 relative overflow-hidden">
                        <div className="absolute bottom-0 inset-x-0 h-3/4 bg-[#F4256A]" />
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full relative mt-1">
                      <div className="w-2.5 h-2.5 bg-white rounded-sm absolute -top-0.5 left-1/2 -translate-x-1/2" />
                    </div>
                  </div>

                  {/* Mini Deck B */}
                  <div className="col-span-5 rounded-lg border border-white/10 bg-[#0D1018] p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-200">
                        DECK B
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/30 text-red-300 border border-red-500/40">
                        YouTube
                      </span>
                    </div>
                    <div className="h-20 rounded bg-gradient-to-br from-[#2B0C16] via-[#131724] to-[#0B0E17] border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
                      <div className="w-8 h-6 rounded-md bg-[#FF0000] flex items-center justify-center shadow-lg">
                        <Play className="w-3.5 h-3.5 text-white fill-white" />
                      </div>
                      <span className="text-[10px] font-bold text-white mt-1.5">
                        KARAOKE EN VIVO HD
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[9px] font-mono-tabular text-slate-400">
                      <span>00:48</span>
                      <span className="text-[#F4256A]">TONO 0</span>
                      <span>03:32</span>
                    </div>
                  </div>
                </div>

                {/* Mini Sampler + Library Bar */}
                <div className="px-3 pb-3 grid grid-cols-12 gap-2.5">
                  <div className="col-span-7 rounded-lg border border-white/10 bg-[#0B0E15] p-2 space-y-1">
                    <div className="flex items-center justify-between text-[9px] text-slate-400 pb-1 border-b border-white/5">
                      <span>Tracks in Library</span>
                      <span className="text-purple-400 font-semibold">Separar Pista (IA)</span>
                    </div>
                    <div className="text-[9px] text-slate-200 flex items-center justify-between">
                      <span className="truncate">99. Asi Se Goza.mp3</span>
                      <span className="text-blue-400 font-bold">A / B</span>
                    </div>
                    <div className="text-[9px] text-slate-400 flex items-center justify-between">
                      <span className="truncate">97. Tú Amor Fue Una Mentira.mp3</span>
                      <span className="text-[#F4256A] font-bold">A / B</span>
                    </div>
                  </div>
                  <div className="col-span-5 rounded-lg border border-white/10 bg-[#0B0E15] p-2">
                    <div className="text-[9px] text-slate-400 mb-1.5 flex items-center justify-between">
                      <span>SAMPLER</span>
                      <span className="text-cyan-400">32 PADS</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      <div className="h-5 rounded bg-rose-600 text-[8px] font-bold flex items-center justify-center">
                        FX 1
                      </div>
                      <div className="h-5 rounded bg-orange-600 text-[8px] font-bold flex items-center justify-center">
                        LOOP
                      </div>
                      <div className="h-5 rounded bg-purple-600 text-[8px] font-bold flex items-center justify-center">
                        FX 6
                      </div>
                      <div className="h-5 rounded bg-amber-400 text-slate-950 text-[8px] font-bold flex items-center justify-center">
                        DROP
                      </div>
                    </div>
                  </div>
                </div>

                {/* Hover Launch Indicator */}
                <div className="absolute inset-0 bg-[#F4256A]/0 group-hover:bg-[#F4256A]/5 transition-colors flex items-center justify-center pointer-events-none">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity px-4 py-2 rounded-lg bg-[#090B10]/90 border border-[#F4256A]/50 text-xs font-semibold text-white shadow-xl">
                    Clic para abrir consola en vivo
                  </span>
                </div>
              </div>

              {/* Bottom Feature Strip inside Stage Frame (mirrors Image 1) */}
              <div className="relative z-10 mt-6 pt-5 border-t border-white/10 grid grid-cols-2 sm:grid-cols-5 gap-4">
                <div className="flex items-start gap-2.5">
                  <FolderOpen className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-white">
                      Carpetas
                    </p>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Organiza tus shows y repertorios.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Music className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-white">
                      Audio Local
                    </p>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Reproduce tus pistas desde tu dispositivo.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Youtube className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-white">
                      YouTube Karaoke
                    </p>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Busca y reproduce karaokes fácilmente.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Mic className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-white">
                      Tonalidad de Voz
                    </p>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Encuentra la tonalidad perfecta para tu voz.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 col-span-2 sm:col-span-1">
                  <Grid className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-white">
                      Sampler Ilimitado
                    </p>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Botones personalizables, efectos y más.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Hero Copy, Feature Grid & Primary CTA */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#F4256A]/15 border border-[#F4256A]/35 flex items-center justify-center">
              <AudioWaveform className="w-5 h-5 text-[#F4256A]" />
            </div>
            <span className="px-3.5 py-1.5 rounded-full bg-[#19111C] border border-[#F4256A]/30 text-[11px] font-mono-tabular tracking-widest uppercase text-[#F973A2]">
              Live DJ &amp; Sampler Suite
            </span>
          </div>

          <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight leading-none mb-4">
            <span className="text-white">Show</span>
            <span className="text-[#F4256A]">Live</span>
          </h1>

          <p className="font-display text-lg sm:text-xl font-bold text-[#F4256A] leading-snug mb-4 text-balance">
            Todo tu show desde una sola App — La herramienta que todo artista en vivo necesita
          </p>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-7">
            Sistema interactivo para DJs, cantantes y animadores. Controla pistas locales sin
            necesidad de subirlas a la nube, busca y proyecta videos karaoke de YouTube, ajusta
            la tonalidad de voz en tiempo real y dispara samplers ilimitados con latencia cero.
          </p>

          {/* 5 Feature Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
            <button
              type="button"
              onClick={() => onOpenStudio('local')}
              className="text-left p-3.5 rounded-xl bg-[#11131C] border border-white/10 hover:border-[#F4256A]/50 transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-[#F4256A] mb-2" />
              <p className="text-sm font-semibold text-white">Carpetas</p>
              <p className="text-xs text-slate-400 mt-0.5">Organiza repertorios</p>
            </button>

            <button
              type="button"
              onClick={() => onOpenStudio('local')}
              className="text-left p-3.5 rounded-xl bg-[#11131C] border border-white/10 hover:border-[#F4256A]/50 transition-colors"
            >
              <Music className="w-4 h-4 text-[#F4256A] mb-2" />
              <p className="text-sm font-semibold text-white">Audio Local</p>
              <p className="text-xs text-slate-400 mt-0.5">Reproduce desde tu equipo</p>
            </button>

            <button
              type="button"
              onClick={() => onOpenStudio('youtube')}
              className="text-left p-3.5 rounded-xl bg-[#11131C] border border-white/10 hover:border-[#F4256A]/50 transition-colors"
            >
              <Youtube className="w-4 h-4 text-[#F4256A] mb-2" />
              <p className="text-sm font-semibold text-white">YouTube Karaoke</p>
              <p className="text-xs text-slate-400 mt-0.5">Busca y proyecta en vivo</p>
            </button>

            <button
              type="button"
              onClick={() => onOpenStudio('local')}
              className="text-left p-3.5 rounded-xl bg-[#11131C] border border-white/10 hover:border-[#F4256A]/50 transition-colors"
            >
              <Sliders className="w-4 h-4 text-[#F4256A] mb-2" />
              <p className="text-sm font-semibold text-white">Tonalidad de Voz</p>
              <p className="text-xs text-slate-400 mt-0.5">Key &amp; Pitch en directo</p>
            </button>

            <button
              type="button"
              onClick={() => onOpenStudio('local')}
              className="text-left p-3.5 rounded-xl bg-[#11131C] border border-white/10 hover:border-[#F4256A]/50 transition-colors col-span-2"
            >
              <Grid className="w-4 h-4 text-[#F4256A] mb-2" />
              <p className="text-sm font-semibold text-white">Sampler Ilimitado</p>
              <p className="text-xs text-slate-400 mt-0.5">32 pads y efectos instantáneos</p>
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={() => onOpenStudio('local')}
              className="inline-flex items-center gap-3 px-7 py-4 rounded-xl bg-gradient-to-r from-[#F4256A] to-[#E11D48] hover:from-[#FF3478] hover:to-[#F4256A] text-white font-display font-bold text-base shadow-[0_12px_32px_rgba(244,37,106,0.35)] transition-all cursor-pointer active:scale-[0.99]"
            >
              <AudioWaveform className="w-5 h-5" />
              <span>Abrir ShowLive</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
