import {
  ChannelEqState,
  DeckId,
  SamplerPad,
  StemMode,
  TriggerMode,
} from '../types/showlive';
import { synthesizeFxBuffer } from './demoTracks';

/**
 * Dual-delay-line Jungle pitch shifter using Web Audio API.
 * Shifts pitch in semitones (-12 to +12) without changing playback tempo.
 */
class JunglePitchShifter {
  public input: GainNode;
  public output: GainNode;
  private bypassGain: GainNode;
  private wetGain: GainNode;
  private delay1: DelayNode;
  private delay2: DelayNode;
  private mod1Gain: GainNode;
  private mod2Gain: GainNode;
  private fade1: GainNode;
  private fade2: GainNode;
  private bufferTime = 0.08; // 80ms grain window

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.bypassGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    this.bypassGain.gain.value = 1;
    this.wetGain.gain.value = 0;

    this.input.connect(this.bypassGain);
    this.bypassGain.connect(this.output);

    this.delay1 = ctx.createDelay(1.0);
    this.delay2 = ctx.createDelay(1.0);
    this.delay1.delayTime.value = this.bufferTime * 0.5;
    this.delay2.delayTime.value = this.bufferTime * 0.5;

    this.fade1 = ctx.createGain();
    this.fade2 = ctx.createGain();

    // Create sawtooth ramp buffer & Hann crossfade window buffer
    const sr = ctx.sampleRate;
    const len = 4096;
    const sawBuf = ctx.createBuffer(1, len, sr);
    const saw2Buf = ctx.createBuffer(1, len, sr);
    const win1Buf = ctx.createBuffer(1, len, sr);
    const win2Buf = ctx.createBuffer(1, len, sr);

    const s1 = sawBuf.getChannelData(0);
    const s2 = saw2Buf.getChannelData(0);
    const w1 = win1Buf.getChannelData(0);
    const w2 = win2Buf.getChannelData(0);

    for (let i = 0; i < len; i++) {
      const p1 = i / len;
      const p2 = (p1 + 0.5) % 1;
      s1[i] = p1;
      s2[i] = p2;
      w1[i] = 0.5 * (1 - Math.cos(2 * Math.PI * p1));
      w2[i] = 0.5 * (1 - Math.cos(2 * Math.PI * p2));
    }

    const mod1 = ctx.createBufferSource();
    mod1.buffer = sawBuf;
    mod1.loop = true;

    const mod2 = ctx.createBufferSource();
    mod2.buffer = saw2Buf;
    mod2.loop = true;

    const win1 = ctx.createBufferSource();
    win1.buffer = win1Buf;
    win1.loop = true;

    const win2 = ctx.createBufferSource();
    win2.buffer = win2Buf;
    win2.loop = true;

    this.mod1Gain = ctx.createGain();
    this.mod2Gain = ctx.createGain();
    this.mod1Gain.gain.value = 0;
    this.mod2Gain.gain.value = 0;

    mod1.connect(this.mod1Gain);
    mod2.connect(this.mod2Gain);
    this.mod1Gain.connect(this.delay1.delayTime);
    this.mod2Gain.connect(this.delay2.delayTime);

    win1.connect(this.fade1.gain);
    win2.connect(this.fade2.gain);

    this.input.connect(this.delay1);
    this.input.connect(this.delay2);
    this.delay1.connect(this.fade1);
    this.delay2.connect(this.fade2);
    this.fade1.connect(this.wetGain);
    this.fade2.connect(this.wetGain);
    this.wetGain.connect(this.output);

    const freq = 1 / this.bufferTime;
    const rate = freq * (len / sr);
    mod1.playbackRate.value = rate;
    mod2.playbackRate.value = rate;
    win1.playbackRate.value = rate;
    win2.playbackRate.value = rate;

    const now = ctx.currentTime;
    mod1.start(now);
    mod2.start(now);
    win1.start(now);
    win2.start(now);
    this.modSources = [mod1, mod2, win1, win2];
  }

  private modSources: AudioBufferSourceNode[];

  public setSemitones(semitones: number, ctx: AudioContext) {
    const now = ctx.currentTime;
    if (Math.abs(semitones) < 0.05) {
      this.bypassGain.gain.setTargetAtTime(1, now, 0.02);
      this.wetGain.gain.setTargetAtTime(0, now, 0.02);
      return;
    }

    this.bypassGain.gain.setTargetAtTime(0, now, 0.02);
    this.wetGain.gain.setTargetAtTime(1, now, 0.02);

    const pitchRatio = Math.pow(2, semitones / 12);
    // Delay slope = 1 - pitchRatio; mod amplitude = bufferTime * (1 - pitchRatio)
    const modDepth = this.bufferTime * (1 - pitchRatio);
    this.mod1Gain.gain.setTargetAtTime(modDepth, now, 0.02);
    this.mod2Gain.gain.setTargetAtTime(modDepth, now, 0.02);
  }
}

interface DeckGraph {
  mediaEl: HTMLMediaElement | null;
  sourceNode: MediaElementAudioSourceNode | null;
  pitchShifter: JunglePitchShifter;
  stemInput: GainNode;
  stemOutput: GainNode;
  // Stem processors
  stemDry: GainNode;
  stemInstGroup: GainNode;
  stemVocalGroup: GainNode;
  stemDrumsGroup: GainNode;
  // 3-band EQ + Combo Filter
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  comboFilter: BiquadFilterNode;
  // Gains & Analyser
  channelGain: GainNode;
  crossfadeGain: GainNode;
  analyser: AnalyserNode;
  freqData: Uint8Array<ArrayBuffer>;
}

class ShowLiveAudioEngine {
  private ctx: AudioContext | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private samplerGain: GainNode | null = null;
  private decks: Record<DeckId, DeckGraph | null> = { A: null, B: null };
  private fxBufferCache = new Map<string, AudioBuffer>();
  private urlBufferCache = new Map<string, AudioBuffer>();
  private activePadSources = new Map<number, AudioBufferSourceNode[]>();

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -2;
      this.masterLimiter.knee.value = 6;
      this.masterLimiter.ratio.value = 8;
      this.masterLimiter.attack.value = 0.003;
      this.masterLimiter.release.value = 0.15;
      this.masterLimiter.connect(this.ctx.destination);

      this.samplerGain = this.ctx.createGain();
      this.samplerGain.gain.value = 0.95;
      this.samplerGain.connect(this.masterLimiter);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public resume() {
    this.ensureContext();
  }

  private ensureDeckGraph(deckId: DeckId): DeckGraph {
    const ctx = this.ensureContext();
    const existing = this.decks[deckId];
    if (existing) return existing;

    const pitchShifter = new JunglePitchShifter(ctx);
    const stemInput = ctx.createGain();
    const stemOutput = ctx.createGain();

    // 1. Full dry path
    const stemDry = ctx.createGain();
    stemDry.gain.value = 1;
    stemInput.connect(stemDry);
    stemDry.connect(stemOutput);

    // 2. Instrumental (Mid-side vocal cancellation + low bass anchor)
    const stemInstGroup = ctx.createGain();
    stemInstGroup.gain.value = 0;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const invR = ctx.createGain();
    invR.gain.value = -0.88;
    const invL = ctx.createGain();
    invL.gain.value = -0.88;

    stemInput.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(invR, 1);
    invR.connect(merger, 0, 0);

    splitter.connect(merger, 1, 1);
    splitter.connect(invL, 0);
    invL.connect(merger, 0, 1);

    const bassAnchor = ctx.createBiquadFilter();
    bassAnchor.type = 'lowpass';
    bassAnchor.frequency.value = 190;
    const bassAnchorGain = ctx.createGain();
    bassAnchorGain.gain.value = 0.85;
    stemInput.connect(bassAnchor);
    bassAnchor.connect(bassAnchorGain);
    bassAnchorGain.connect(stemInstGroup);

    merger.connect(stemInstGroup);
    stemInstGroup.connect(stemOutput);

    // 3. Vocals (Center bandpass emphasis)
    const stemVocalGroup = ctx.createGain();
    stemVocalGroup.gain.value = 0;
    const vocalBp = ctx.createBiquadFilter();
    vocalBp.type = 'bandpass';
    vocalBp.frequency.value = 1350;
    vocalBp.Q.value = 0.75;
    const vocalGainBoost = ctx.createGain();
    vocalGainBoost.gain.value = 1.65;
    stemInput.connect(vocalBp);
    vocalBp.connect(vocalGainBoost);
    vocalGainBoost.connect(stemVocalGroup);
    stemVocalGroup.connect(stemOutput);

    // 4. Drums & Bass (Low punch + High crisp)
    const stemDrumsGroup = ctx.createGain();
    stemDrumsGroup.gain.value = 0;
    const drumsLow = ctx.createBiquadFilter();
    drumsLow.type = 'lowpass';
    drumsLow.frequency.value = 240;
    const drumsHigh = ctx.createBiquadFilter();
    drumsHigh.type = 'highpass';
    drumsHigh.frequency.value = 4800;
    stemInput.connect(drumsLow);
    stemInput.connect(drumsHigh);
    drumsLow.connect(stemDrumsGroup);
    drumsHigh.connect(stemDrumsGroup);
    stemDrumsGroup.connect(stemOutput);

    // 3-Band EQ
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 250;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.0;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 3200;

    const comboFilter = ctx.createBiquadFilter();
    comboFilter.type = 'allpass';
    comboFilter.frequency.value = 1000;
    comboFilter.Q.value = 1.2;

    const channelGain = ctx.createGain();
    channelGain.gain.value = 1.0;

    const crossfadeGain = ctx.createGain();
    crossfadeGain.gain.value = 1.0;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    const freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    pitchShifter.output.connect(stemInput);
    stemOutput.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(comboFilter);
    comboFilter.connect(channelGain);
    channelGain.connect(crossfadeGain);
    crossfadeGain.connect(analyser);
    analyser.connect(this.masterLimiter!);

    const graph: DeckGraph = {
      mediaEl: null,
      sourceNode: null,
      pitchShifter,
      stemInput,
      stemOutput,
      stemDry,
      stemInstGroup,
      stemVocalGroup,
      stemDrumsGroup,
      eqLow,
      eqMid,
      eqHigh,
      comboFilter,
      channelGain,
      crossfadeGain,
      analyser,
      freqData,
    };
    this.decks[deckId] = graph;
    return graph;
  }

  public attachMediaElement(deckId: DeckId, mediaEl: HTMLMediaElement) {
    const ctx = this.ensureContext();
    const graph = this.ensureDeckGraph(deckId);
    if (graph.mediaEl === mediaEl && graph.sourceNode) {
      return;
    }
    try {
      if (graph.sourceNode) {
        graph.sourceNode.disconnect();
      }
      const source = ctx.createMediaElementSource(mediaEl);
      source.connect(graph.pitchShifter.input);
      graph.mediaEl = mediaEl;
      graph.sourceNode = source;
    } catch {
      // Element already connected in StrictMode double-mount
    }
  }

  public setDeckPitch(deckId: DeckId, semitones: number) {
    const ctx = this.ensureContext();
    const graph = this.ensureDeckGraph(deckId);
    graph.pitchShifter.setSemitones(semitones, ctx);
  }

  public setDeckStemMode(deckId: DeckId, mode: StemMode) {
    const ctx = this.ensureContext();
    const graph = this.ensureDeckGraph(deckId);
    const now = ctx.currentTime;
    graph.stemDry.gain.setTargetAtTime(mode === 'full' ? 1 : 0, now, 0.03);
    graph.stemInstGroup.gain.setTargetAtTime(mode === 'instrumental' ? 1 : 0, now, 0.03);
    graph.stemVocalGroup.gain.setTargetAtTime(mode === 'vocals' ? 1 : 0, now, 0.03);
    graph.stemDrumsGroup.gain.setTargetAtTime(mode === 'drums_bass' ? 1 : 0, now, 0.03);
  }

  public updateChannelEq(deckId: DeckId, eq: ChannelEqState) {
    const ctx = this.ensureContext();
    const graph = this.ensureDeckGraph(deckId);
    const now = ctx.currentTime;
    graph.eqLow.gain.setTargetAtTime(eq.low, now, 0.02);
    graph.eqMid.gain.setTargetAtTime(eq.mid, now, 0.02);
    graph.eqHigh.gain.setTargetAtTime(eq.high, now, 0.02);
    graph.channelGain.gain.setTargetAtTime(eq.volume, now, 0.02);

    const f = eq.filter ?? 0;
    if (Math.abs(f) < 0.04) {
      graph.comboFilter.type = 'allpass';
      graph.comboFilter.Q.setTargetAtTime(0.7, now, 0.02);
    } else if (f < 0) {
      graph.comboFilter.type = 'lowpass';
      // -0.04 -> 18000 Hz, -1 -> 200 Hz (exponential sweep)
      const amt = Math.min(1, Math.abs(f));
      const freq = 18000 * Math.pow(200 / 18000, amt);
      graph.comboFilter.frequency.setTargetAtTime(freq, now, 0.02);
      graph.comboFilter.Q.setTargetAtTime(2.2, now, 0.02);
    } else {
      graph.comboFilter.type = 'highpass';
      // +0.04 -> 30 Hz, +1 -> 4800 Hz
      const amt = Math.min(1, f);
      const freq = 30 * Math.pow(4800 / 30, amt);
      graph.comboFilter.frequency.setTargetAtTime(freq, now, 0.02);
      graph.comboFilter.Q.setTargetAtTime(2.2, now, 0.02);
    }
  }

  public updateCrossfader(crossfader: number) {
    const ctx = this.ensureContext();
    const graphA = this.ensureDeckGraph('A');
    const graphB = this.ensureDeckGraph('B');
    const now = ctx.currentTime;
    // Equal power crossfader: crossfader in [-1, 1] -> norm in [0, 1]
    const norm = (Math.max(-1, Math.min(1, crossfader)) + 1) * 0.5;
    const gainA = Math.cos(norm * 0.5 * Math.PI);
    const gainB = Math.cos((1 - norm) * 0.5 * Math.PI);
    graphA.crossfadeGain.gain.setTargetAtTime(gainA, now, 0.02);
    graphB.crossfadeGain.gain.setTargetAtTime(gainB, now, 0.02);
  }

  public getDeckFrequencyData(deckId: DeckId): { bins: Uint8Array; level: number } {
    const graph = this.decks[deckId];
    if (!graph) {
      return { bins: new Uint8Array(64), level: 0 };
    }
    graph.analyser.getByteFrequencyData(graph.freqData);
    let sum = 0;
    const len = graph.freqData.length;
    for (let i = 0; i < len; i++) {
      sum += graph.freqData[i];
    }
    const level = Math.min(1, sum / (len * 180));
    return { bins: graph.freqData, level };
  }

  // --- ZERO-LATENCY SAMPLER ENGINE ---
  public async preloadPad(pad: SamplerPad) {
    const ctx = this.ensureContext();
    if (pad.customAudioUrl && !this.urlBufferCache.has(pad.customAudioUrl)) {
      try {
        const res = await fetch(pad.customAudioUrl);
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        this.urlBufferCache.set(pad.customAudioUrl, decoded);
      } catch {
        // Ignore invalid audio decode
      }
    } else if (pad.fxPreset && !this.fxBufferCache.has(pad.fxPreset)) {
      this.fxBufferCache.set(pad.fxPreset, synthesizeFxBuffer(ctx, pad.fxPreset));
    }
  }

  public async triggerPad(pad: SamplerPad, mode: TriggerMode): Promise<void> {
    if (!pad.customAudioUrl && !pad.fxPreset) return;
    const ctx = this.ensureContext();

    let buffer: AudioBuffer | undefined;
    if (pad.customAudioUrl) {
      buffer = this.urlBufferCache.get(pad.customAudioUrl);
      if (!buffer) {
        await this.preloadPad(pad);
        buffer = this.urlBufferCache.get(pad.customAudioUrl);
      }
    } else if (pad.fxPreset) {
      buffer = this.fxBufferCache.get(pad.fxPreset);
      if (!buffer) {
        buffer = synthesizeFxBuffer(ctx, pad.fxPreset);
        this.fxBufferCache.set(pad.fxPreset, buffer);
      }
    }

    if (!buffer || !this.samplerGain) return;

    if (mode === 'one-shot' || mode === 'gate') {
      this.releasePad(pad.id);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const padGain = ctx.createGain();
    padGain.gain.value = pad.volume ?? 0.9;

    src.connect(padGain);
    padGain.connect(this.samplerGain);

    const list = this.activePadSources.get(pad.id) || [];
    list.push(src);
    this.activePadSources.set(pad.id, list);

    src.onended = () => {
      const current = this.activePadSources.get(pad.id) || [];
      this.activePadSources.set(
        pad.id,
        current.filter((item) => item !== src)
      );
    };

    src.start(0);
  }

  public releasePad(padId: number) {
    const active = this.activePadSources.get(padId);
    if (!active || active.length === 0) return;
    active.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
    });
    this.activePadSources.set(padId, []);
  }

  public stopAllPads() {
    for (const padId of this.activePadSources.keys()) {
      this.releasePad(padId);
    }
  }
}

export const audioEngine = new ShowLiveAudioEngine();
