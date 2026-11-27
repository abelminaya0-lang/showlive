import { PadFxPreset, Playlist, SamplerBank, SamplerPad, TrackItem } from '../types/showlive';

export function encodeWav(samplesLeft: Float32Array, samplesRight: Float32Array, sampleRate: number): Blob {
  const numFrames = samplesLeft.length;
  const buffer = new ArrayBuffer(44 + numFrames * 4);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // Stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numFrames * 4, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, samplesLeft[i]));
    const r = Math.max(-1, Math.min(1, samplesRight[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const demoUrlCache = new Map<string, string>();

export function getOrCreateDemoTrackUrl(track: TrackItem): string {
  if (track.audioUrl) return track.audioUrl;
  const cached = demoUrlCache.get(track.id);
  if (cached) return cached;

  const preset = track.demoPreset || { bpm: 105, rootMidi: 57, style: 'salsa' as const };
  const sampleRate = 22050;
  const duration = Math.min(track.durationSec || 24, 24);
  const totalSamples = Math.floor(sampleRate * duration);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const beatDur = 60 / preset.bpm;
  const stepDur = beatDur / 4; // 16th note
  const chordProgression =
    preset.style === 'balada'
      ? [0, -5, -3, -7]
      : preset.style === 'cumbia'
      ? [0, 5, 7, 5]
      : [0, 5, 7, 10]; // Salsa/Timba minor groove

  let noiseSeed = 1337;
  const nextNoise = () => {
    noiseSeed = (noiseSeed * 16807) % 2147483647;
    return (noiseSeed / 2147483647) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const stepIndex = Math.floor(t / stepDur);
    const stepLocalT = t - stepIndex * stepDur;
    const stepInBar = stepIndex % 16;
    const barIndex = Math.floor(stepIndex / 16) % chordProgression.length;
    const root = preset.rootMidi + chordProgression[barIndex];

    let sigL = 0;
    let sigR = 0;

    // 1. Tumbao / Cumbia Bass (Mono centered)
    const isBassHit =
      preset.style === 'cumbia'
        ? stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14
        : stepInBar === 0 || stepInBar === 6 || stepInBar === 11;
    if (isBassHit || stepLocalT < 0.28) {
      const bassNote = stepInBar >= 8 ? root + 7 : root;
      const f = midiToFreq(bassNote - 12);
      const env = Math.exp(-stepLocalT * 6.5);
      const bass = Math.sin(2 * Math.PI * f * t) * 0.34 * env;
      sigL += bass;
      sigR += bass;
    }

    // 2. Kick drum (Mono centered)
    if (stepInBar % 4 === 0 && stepLocalT < 0.14) {
      const kickFreq = 125 * Math.exp(-stepLocalT * 26) + 46;
      const kickEnv = Math.exp(-stepLocalT * 18);
      const kick = Math.sin(2 * Math.PI * kickFreq * stepLocalT) * 0.42 * kickEnv;
      sigL += kick;
      sigR += kick;
    }

    // 3. Percussion / Güiro / Cowbell (Stereo wide)
    if ((stepInBar % 2 === 1 || stepInBar === 2 || stepInBar === 10) && stepLocalT < 0.06) {
      const percEnv = Math.exp(-stepLocalT * 42);
      const perc = nextNoise() * 0.14 * percEnv;
      const pan = stepInBar % 4 === 1 ? 0.8 : 0.2;
      sigL += perc * (1 - pan * 0.5);
      sigR += perc * (0.5 + pan * 0.5);
    }

    // 4. Piano Montuno / Guitar Chords (Stereo L/R)
    const isChordHit =
      preset.style === 'balada'
        ? stepInBar % 4 === 0
        : stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 10 || stepInBar === 12;
    if (isChordHit || stepLocalT < 0.18) {
      const env = Math.exp(-stepLocalT * 8.5);
      const third = preset.style === 'cumbia' ? 4 : 3;
      const f1 = midiToFreq(root + 12);
      const f2 = midiToFreq(root + 12 + third);
      const f3 = midiToFreq(root + 19);
      const chord =
        (Math.sin(2 * Math.PI * f1 * t) * 0.5 +
          Math.sin(2 * Math.PI * f2 * t) * 0.4 +
          Math.sin(2 * Math.PI * f3 * t) * 0.35) *
        0.13 *
        env;
      sigL += chord * 1.1;
      sigR += chord * 0.9;
    }

    // 5. Center Lead Melody Synth (so Vocal/Mid-Side Remover clearly attenuates it!)
    const melodyPattern = [0, 3, 5, 7, 10, 7, 5, 3];
    const melStep = Math.floor(stepIndex / 2) % melodyPattern.length;
    const melNote = root + 24 + melodyPattern[melStep];
    const melFreq = midiToFreq(melNote);
    const melGate = (stepIndex % 2 === 0 || stepLocalT < stepDur * 0.8) ? 1 : 0.35;
    const lead =
      (Math.sin(2 * Math.PI * melFreq * t) + 0.35 * Math.sin(4 * Math.PI * melFreq * t)) *
      0.11 *
      melGate;
    sigL += lead;
    sigR += lead;

    left[i] = Math.tanh(sigL);
    right[i] = Math.tanh(sigR);
  }

  const blob = encodeWav(left, right, sampleRate);
  const url = URL.createObjectURL(blob);
  demoUrlCache.set(track.id, url);
  return url;
}

export function synthesizeFxBuffer(ctx: AudioContext, preset: PadFxPreset): AudioBuffer {
  const sr = ctx.sampleRate;
  const makeBuffer = (sec: number, fn: (t: number, i: number) => [number, number]) => {
    const len = Math.floor(sr * sec);
    const buf = ctx.createBuffer(2, len, sr);
    const chL = buf.getChannelData(0);
    const chR = buf.getChannelData(1);
    for (let i = 0; i < len; i++) {
      const [l, r] = fn(i / sr, i);
      chL[i] = Math.max(-1, Math.min(1, l));
      chR[i] = Math.max(-1, Math.min(1, r));
    }
    return buf;
  };

  switch (preset) {
    case 'airhorn':
      return makeBuffer(1.15, (t) => {
        const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 2.8);
        const f1 = 440 + Math.sin(t * 28) * 6;
        const f2 = 554.37;
        const f3 = 659.25;
        const saw = (f: number) => ((t * f) % 1) * 2 - 1;
        const v = (saw(f1) * 0.45 + saw(f2) * 0.35 + saw(f3) * 0.3) * 0.42 * env;
        return [v, v * 0.96];
      });
    case 'laser':
      return makeBuffer(0.65, (t) => {
        const freq = 1800 * Math.exp(-t * 6.5) + 90;
        const env = Math.exp(-t * 4.5);
        const v = Math.sin(2 * Math.PI * freq * t) * 0.55 * env;
        return [v, v];
      });
    case 'timbale':
      return makeBuffer(1.4, (t) => {
        const hits = [0, 0.16, 0.32, 0.48, 0.7, 0.9, 1.05];
        let vL = 0;
        let vR = 0;
        hits.forEach((h, idx) => {
          const dt = t - h;
          if (dt >= 0 && dt < 0.25) {
            const f = (idx % 2 === 0 ? 310 : 420) * (1 + 0.15 * Math.exp(-dt * 40));
            const env = Math.exp(-dt * 14);
            const sig = Math.sin(2 * Math.PI * f * dt) * 0.48 * env;
            vL += sig * (idx % 2 === 0 ? 0.9 : 0.4);
            vR += sig * (idx % 2 === 0 ? 0.4 : 0.9);
          }
        });
        return [vL, vR];
      });
    case 'subdrop':
      return makeBuffer(1.6, (t) => {
        const freq = 110 * Math.exp(-t * 2.2) + 32;
        const env = t < 0.01 ? t / 0.01 : Math.exp(-t * 1.9);
        const v = Math.tanh(Math.sin(2 * Math.PI * freq * t) * 1.5) * 0.65 * env;
        return [v, v];
      });
    case 'clap_crowd':
      return makeBuffer(0.95, (t) => {
        const burst =
          (t < 0.015 || (t > 0.025 && t < 0.04) || (t > 0.05 && t < 0.07)) ? 1 : 0.45;
        const env = Math.exp(-t * 4.2) * burst;
        const n1 = Math.sin(t * 98765.4) * 2 - 1;
        const n2 = Math.cos(t * 76543.2) * 2 - 1;
        return [((n1 % 1) * 0.45) * env, ((n2 % 1) * 0.45) * env];
      });
    case 'synth_stab':
      return makeBuffer(0.75, (t) => {
        const env = Math.exp(-t * 5.2);
        const chord = [261.63, 311.13, 392.0, 466.16];
        const sum = chord.reduce((acc, f) => acc + Math.sin(2 * Math.PI * f * t), 0) / chord.length;
        const v = Math.tanh(sum * 2.2) * 0.5 * env;
        return [v, v];
      });
    case 'siren':
      return makeBuffer(1.5, (t) => {
        const mod = 650 + 380 * Math.sin(2 * Math.PI * 3.5 * t);
        const env = Math.min(1, t / 0.05) * Math.exp(-Math.max(0, t - 1.1) * 4);
        const v = Math.sin(2 * Math.PI * mod * t) * 0.35 * env;
        return [v, v];
      });
    case 'cowbell':
      return makeBuffer(0.45, (t) => {
        const env = Math.exp(-t * 11);
        const v =
          (Math.sin(2 * Math.PI * 560 * t) * 0.5 + Math.sin(2 * Math.PI * 845 * t) * 0.5) *
          0.48 *
          env;
        return [v, v];
      });
    case 'scratch':
      return makeBuffer(0.55, (t) => {
        const freq = 280 + 220 * Math.sin(2 * Math.PI * 7 * t);
        const env = Math.exp(-t * 3.5);
        const v = (((t * freq) % 1) * 2 - 1) * 0.38 * env;
        return [v, v * 0.85];
      });
    case 'riser':
      return makeBuffer(2.0, (t) => {
        const freq = 180 + t * 900;
        const env = Math.min(1, t / 1.8) * (t > 1.85 ? (2.0 - t) / 0.15 : 1);
        const v = Math.sin(2 * Math.PI * freq * t) * 0.38 * env;
        return [v, v];
      });
    case 'crash':
      return makeBuffer(1.8, (t) => {
        const env = Math.exp(-t * 2.3);
        const n = Math.sin(t * 54321.123) * Math.cos(t * 19873.45);
        const shimmer = Math.sin(2 * Math.PI * 3400 * t) * 0.2 + Math.sin(2 * Math.PI * 5100 * t) * 0.15;
        const v = (n * 0.4 + shimmer) * 0.45 * env;
        return [v, v];
      });
    case 'kick_808':
    default:
      return makeBuffer(0.7, (t) => {
        const freq = 150 * Math.exp(-t * 32) + 48;
        const env = Math.exp(-t * 6.5);
        const v = Math.sin(2 * Math.PI * freq * t) * 0.65 * env;
        return [v, v];
      });
  }
}

export const FX_PRESET_LABELS: { id: PadFxPreset; label: string }[] = [
  { id: 'airhorn', label: 'Bocina / Airhorn Show' },
  { id: 'timbale', label: 'Redoble Timbal Latino' },
  { id: 'laser', label: 'Láser FX' },
  { id: 'subdrop', label: 'Sub Drop 808' },
  { id: 'clap_crowd', label: 'Aplauso / Palmas' },
  { id: 'synth_stab', label: 'Hey! Brass Synth' },
  { id: 'siren', label: 'Sirena DJ' },
  { id: 'cowbell', label: 'Campana Salsa' },
  { id: 'scratch', label: 'Scratch Vinilo' },
  { id: 'riser', label: 'Riser Subida' },
  { id: 'crash', label: 'Platillo Crash' },
  { id: 'kick_808', label: 'Bombo 808' },
];

export const INITIAL_PLAYLISTS: Playlist[] = [];

export const INITIAL_TRACKS: TrackItem[] = [];

const PAD_SHORTCUTS = [
  '1', '2', '3', '4',
  'Q', 'W', 'E', 'R',
  'A', 'S', 'D', 'F',
  'Z', 'X', 'C', 'V',
  '5', '6', '7', '8',
  'T', 'Y', 'U', 'I',
  'G', 'H', 'J', 'K',
  'B', 'N', 'M', ',',
];

export function createEmptyPads(): SamplerPad[] {
  return Array.from({ length: 32 }, (_, idx) => ({
    id: idx + 1,
    label: 'Empty',
    color: '#181C26',
    shortcut: PAD_SHORTCUTS[idx] || '',
    volume: 0.9,
  }));
}

export const INITIAL_SAMPLER_BANKS: SamplerBank[] = [
  {
    id: 'bank-principal',
    name: 'Mi Show',
    pads: createEmptyPads(),
  },
];
