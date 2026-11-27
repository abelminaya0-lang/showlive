import {
  ChannelEqState,
  DeckId,
  SamplerPad,
  StemMode,
  TriggerMode,
} from '../types/showlive';
import { encodeWav, synthesizeFxBuffer } from './demoTracks';

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
  private deckMasterDuckGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterFreqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));
  private silentMasterBins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));
  private samplerGain: GainNode | null = null;
  private decks: Record<DeckId, DeckGraph | null> = { A: null, B: null };
  private fxBufferCache = new Map<string, AudioBuffer>();
  private urlBufferCache = new Map<string, AudioBuffer>();
  private bufferAnalysisCache = new WeakMap<
    AudioBuffer,
    { introStartSec: number; detectedBpm: number }
  >();
  private activePadSources = new Map<number, AudioBufferSourceNode[]>();
  private activeLoopPadIds = new Set<number>();
  private activeDuckingSources = new Set<AudioBufferSourceNode>();
  private autoDuckEnabled = true;
  private isDuckingActive = false;
  private duckListeners = new Set<(ducking: boolean) => void>();
  private padListeners = new Set<(activeIds: number[], loopingIds: number[]) => void>();

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

      this.deckMasterDuckGain = this.ctx.createGain();
      this.deckMasterDuckGain.gain.value = 1.0;
      this.deckMasterDuckGain.connect(this.masterLimiter);

      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 512;
      this.masterAnalyser.smoothingTimeConstant = 0.74;
      this.masterFreqData = new Uint8Array(
        new ArrayBuffer(this.masterAnalyser.frequencyBinCount)
      );

      this.masterLimiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

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

    // 2. Instrumental / Pista Sin Voz (100% Mid-Side center vocal cancellation + mono bass anchor + notched body/air rescue)
    const stemInstGroup = ctx.createGain();
    stemInstGroup.gain.value = 0;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const invR = ctx.createGain();
    invR.gain.value = -1.0;
    const invL = ctx.createGain();
    invL.gain.value = -1.0;

    stemInput.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(invR, 1);
    invR.connect(merger, 0, 0);

    splitter.connect(merger, 1, 1);
    splitter.connect(invL, 0);
    invL.connect(merger, 0, 1);

    // Stereo sides (L - R / R - L) above 180 Hz at +1.7dB stage presence
    const sideHighpass = ctx.createBiquadFilter();
    sideHighpass.type = 'highpass';
    sideHighpass.frequency.value = 180;
    sideHighpass.Q.value = 0.707;
    const sideWidthGain = ctx.createGain();
    sideWidthGain.gain.value = 1.22;
    merger.connect(sideHighpass);
    sideHighpass.connect(sideWidthGain);
    sideWidthGain.connect(stemInstGroup);

    // Mono-summed Low Bass & Kick punch (< 180 Hz)
    const bassMonoL = ctx.createGain();
    bassMonoL.gain.value = 0.5;
    const bassMonoR = ctx.createGain();
    bassMonoR.gain.value = 0.5;
    const bassAnchor = ctx.createBiquadFilter();
    bassAnchor.type = 'lowpass';
    bassAnchor.frequency.value = 180;
    bassAnchor.Q.value = 0.707;
    const bassAnchorGain = ctx.createGain();
    bassAnchorGain.gain.value = 0.95;
    splitter.connect(bassMonoL, 0);
    splitter.connect(bassMonoR, 1);
    bassMonoL.connect(bassAnchor);
    bassMonoR.connect(bassAnchor);
    bassAnchor.connect(bassAnchorGain);
    bassAnchorGain.connect(stemInstGroup);

    // Vocal-notched harmonic rescue (keeps narrow-stereo/mono backing tracks musical without vocal core)
    const vocalNotchLow = ctx.createBiquadFilter();
    vocalNotchLow.type = 'peaking';
    vocalNotchLow.frequency.value = 950;
    vocalNotchLow.Q.value = 0.8;
    vocalNotchLow.gain.value = -15;
    const vocalNotchHi = ctx.createBiquadFilter();
    vocalNotchHi.type = 'peaking';
    vocalNotchHi.frequency.value = 2450;
    vocalNotchHi.Q.value = 0.9;
    vocalNotchHi.gain.value = -16;
    const bodyRescueGain = ctx.createGain();
    bodyRescueGain.gain.value = 0.18;
    stemInput.connect(vocalNotchLow);
    vocalNotchLow.connect(vocalNotchHi);
    vocalNotchHi.connect(bodyRescueGain);
    bodyRescueGain.connect(stemInstGroup);

    // High-frequency cymbal & hi-hat shimmer (> 9.2 kHz)
    const airHighpass = ctx.createBiquadFilter();
    airHighpass.type = 'highpass';
    airHighpass.frequency.value = 9200;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.3;
    stemInput.connect(airHighpass);
    airHighpass.connect(airGain);
    airGain.connect(stemInstGroup);
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
    analyser.connect(this.deckMasterDuckGain || this.masterLimiter!);

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

  public getMasterSpectrumData(): {
    bins: Uint8Array;
    bass: number;
    mid: number;
    treble: number;
    peak: number;
    sampleRate: number;
    isActive: boolean;
  } {
    if (!this.masterAnalyser || !this.ctx) {
      return {
        bins: this.silentMasterBins,
        bass: 0,
        mid: 0,
        treble: 0,
        peak: 0,
        sampleRate: 48000,
        isActive: false,
      };
    }

    this.masterAnalyser.getByteFrequencyData(this.masterFreqData);
    const data = this.masterFreqData;
    const binCount = data.length;
    const sampleRate = this.ctx.sampleRate || 48000;
    const binHz = sampleRate / this.masterAnalyser.fftSize;

    const bassStart = Math.max(0, Math.floor(20 / binHz));
    const bassEnd = Math.max(bassStart + 1, Math.min(binCount - 1, Math.ceil(250 / binHz)));
    const midEnd = Math.max(bassEnd + 1, Math.min(binCount - 1, Math.ceil(2500 / binHz)));
    const trebleEnd = Math.max(midEnd + 1, Math.min(binCount - 1, Math.ceil(16000 / binHz)));

    let bassSum = 0;
    let bassMax = 0;
    for (let i = bassStart; i <= bassEnd; i++) {
      const v = data[i];
      bassSum += v;
      if (v > bassMax) bassMax = v;
    }
    const bassAvg = bassSum / ((bassEnd - bassStart + 1) * 255);
    const bass = Math.min(1, bassAvg * 0.65 + (bassMax / 255) * 0.35);

    let midSum = 0;
    let midMax = 0;
    for (let i = bassEnd + 1; i <= midEnd; i++) {
      const v = data[i];
      midSum += v;
      if (v > midMax) midMax = v;
    }
    const midAvg = midSum / (Math.max(1, midEnd - bassEnd) * 255);
    const mid = Math.min(1, midAvg * 0.72 + (midMax / 255) * 0.38);

    let trebleSum = 0;
    let trebleMax = 0;
    for (let i = midEnd + 1; i <= trebleEnd; i++) {
      const v = data[i];
      trebleSum += v;
      if (v > trebleMax) trebleMax = v;
    }
    const trebleAvg = trebleSum / (Math.max(1, trebleEnd - midEnd) * 255);
    const treble = Math.min(1, trebleAvg * 0.9 + (trebleMax / 255) * 0.48);

    const peak = Math.max(bassMax, midMax, trebleMax) / 255;

    return {
      bins: data,
      bass,
      mid,
      treble,
      peak,
      sampleRate,
      isActive: true,
    };
  }

  // --- AUTO-DUCKING & LOOPING SAMPLER ENGINE ---
  public setAutoDuckEnabled(enabled: boolean) {
    this.autoDuckEnabled = enabled;
    this.updateDuckState();
  }

  public getAutoDuckEnabled(): boolean {
    return this.autoDuckEnabled;
  }

  public subscribeDuckState(cb: (ducking: boolean) => void): () => void {
    this.duckListeners.add(cb);
    cb(this.isDuckingActive);
    return () => {
      this.duckListeners.delete(cb);
    };
  }

  public subscribePadState(
    cb: (activeIds: number[], loopingIds: number[]) => void
  ): () => void {
    this.padListeners.add(cb);
    cb(this.getActivePadIds(), Array.from(this.activeLoopPadIds));
    return () => {
      this.padListeners.delete(cb);
    };
  }

  private getActivePadIds(): number[] {
    const ids: number[] = [];
    this.activePadSources.forEach((list, padId) => {
      if (list.length > 0) ids.push(padId);
    });
    return ids;
  }

  private emitPadState() {
    const activeIds = this.getActivePadIds();
    const loopingIds = Array.from(this.activeLoopPadIds);
    this.padListeners.forEach((cb) => cb(activeIds, loopingIds));
  }

  private updateDuckState() {
    const shouldDuck = this.autoDuckEnabled && this.activeDuckingSources.size > 0;
    if (this.ctx && this.deckMasterDuckGain) {
      const now = this.ctx.currentTime;
      if (shouldDuck) {
        this.deckMasterDuckGain.gain.setTargetAtTime(0.28, now, 0.035);
      } else {
        this.deckMasterDuckGain.gain.setTargetAtTime(1.0, now, 0.22);
      }
    }
    if (shouldDuck !== this.isDuckingActive) {
      this.isDuckingActive = shouldDuck;
      this.duckListeners.forEach((cb) => cb(shouldDuck));
    }
  }

  private findZeroCrossing(
    data: Float32Array,
    targetIdx: number,
    searchRadius: number
  ): number {
    const start = Math.max(1, targetIdx - searchRadius);
    const end = Math.min(data.length - 1, targetIdx);
    for (let i = end; i >= start; i--) {
      if ((data[i - 1] <= 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] <= 0)) {
        return i;
      }
    }
    return Math.max(0, Math.min(data.length - 1, targetIdx));
  }

  private detectIntroStartSample(buffer: AudioBuffer): number {
    const sr = buffer.sampleRate;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    const maxScan = Math.min(buffer.length, Math.round(sr * 25));
    if (maxScan < 256) return 0;

    // Step in 5ms frames to locate peak energy and skip leading silence / fade-in
    const frameSize = Math.max(64, Math.round(sr * 0.005));
    const frameCount = Math.floor(maxScan / frameSize);
    if (frameCount === 0) return 0;

    const frameRms = new Float32Array(frameCount);
    let maxRms = 0;
    for (let f = 0; f < frameCount; f++) {
      const base = f * frameSize;
      let sum = 0;
      for (let i = 0; i < frameSize; i++) {
        const s = 0.5 * (ch0[base + i] + ch1[base + i]);
        sum += s * s;
      }
      const rms = Math.sqrt(sum / frameSize);
      frameRms[f] = rms;
      if (rms > maxRms) maxRms = rms;
    }

    if (maxRms < 0.005) return 0;

    // Detect first real percussive / musical entry ("primera cola de inicio")
    const threshold = Math.max(0.025, maxRms * 0.14);
    let hitSample = 0;
    for (let f = 0; f < frameCount; f++) {
      if (frameRms[f] >= threshold) {
        hitSample = f * frameSize;
        break;
      }
    }

    // Refine inside the hit frame to exact attack sample, then snap to zero-crossing
    const refineEnd = Math.min(maxScan, hitSample + frameSize);
    const sampleThresh = Math.max(0.018, maxRms * 0.12);
    for (let i = Math.max(0, hitSample - Math.round(sr * 0.004)); i < refineEnd; i++) {
      const amp = Math.max(Math.abs(ch0[i]), Math.abs(ch1[i]));
      if (amp >= sampleThresh) {
        hitSample = i;
        break;
      }
    }

    return this.findZeroCrossing(ch0, hitSample, Math.round(sr * 0.006));
  }

  private estimateBpmFromBuffer(buffer: AudioBuffer, startSample: number): number {
    const sr = buffer.sampleRate;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

    // Analyze up to 28 seconds starting from intro downbeat at 100 Hz hop rate (10ms)
    const hopSamples = Math.max(64, Math.round(sr * 0.01));
    const analyzeSamples = Math.min(buffer.length - startSample, Math.round(sr * 28));
    const numFrames = Math.floor(analyzeSamples / hopSamples);
    if (numFrames < 150) return 100;

    const env = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      const base = startSample + f * hopSamples;
      let sum = 0;
      for (let i = 0; i < hopSamples; i++) {
        const s = 0.5 * (ch0[base + i] + ch1[base + i]);
        sum += s * s;
      }
      env[f] = Math.sqrt(sum / hopSamples);
    }

    // Positive onset flux highlights drum transients (clave, kick, conga, dembow)
    const flux = new Float32Array(numFrames);
    for (let f = 1; f < numFrames; f++) {
      const diff = env[f] - env[f - 1];
      flux[f] = diff > 0 ? diff : 0;
    }

    const hopRate = sr / hopSamples; // ~100 Hz
    const minBpm = 74;
    const maxBpm = 156;
    const minLag = Math.floor((60 / maxBpm) * hopRate);
    const maxLag = Math.ceil((60 / minBpm) * hopRate);

    let bestBpm = 100;
    let bestScore = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0;
      const limit = numFrames - lag;
      for (let i = 0; i < limit; i++) {
        ac += flux[i] * flux[i + lag];
      }
      // Also reinforce double-bar / half-tempo consistency
      const lag2 = lag * 2;
      if (lag2 < numFrames) {
        let ac2 = 0;
        const lim2 = numFrames - lag2;
        for (let i = 0; i < lim2; i++) {
          ac2 += flux[i] * flux[i + lag2];
        }
        ac += ac2 * 0.5;
      }

      const bpm = (60 * hopRate) / lag;
      // Gentle Latin/urban groove prior (84-136 BPM: Reggaeton 88-98, Cumbia 90-106, Salsa 85-108/130)
      const prior = bpm >= 84 && bpm <= 136 ? 1.15 : 0.95;
      const score = (ac / Math.max(1, limit)) * prior;

      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }

    return Math.max(70, Math.min(165, Math.round(bestBpm)));
  }

  public analyzeBufferIntro(buffer: AudioBuffer): {
    introStartSec: number;
    detectedBpm: number;
  } {
    const cached = this.bufferAnalysisCache.get(buffer);
    if (cached) return cached;

    const startSample = this.detectIntroStartSample(buffer);
    const detectedBpm = this.estimateBpmFromBuffer(buffer, startSample);
    const result = {
      introStartSec: Number((startSample / buffer.sampleRate).toFixed(3)),
      detectedBpm,
    };
    this.bufferAnalysisCache.set(buffer, result);
    return result;
  }

  public async analyzeAudioUrl(
    url: string
  ): Promise<{ introStartSec: number; detectedBpm: number } | null> {
    if (!url) return null;
    const ctx = this.ensureContext();
    let buffer = this.urlBufferCache.get(url);
    if (!buffer) {
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        buffer = await ctx.decodeAudioData(arr);
        this.urlBufferCache.set(url, buffer);
      } catch {
        return null;
      }
    }
    return this.analyzeBufferIntro(buffer);
  }

  public async extractIntroClipFromUrl(
    url: string,
    trackName: string,
    overrideBpm?: number,
    overrideStartSec?: number
  ): Promise<{
    file: File;
    url: string;
    introStartSec: number;
    detectedBpm: number;
  } | null> {
    if (!url) return null;
    const ctx = this.ensureContext();
    let buffer = this.urlBufferCache.get(url);
    if (!buffer) {
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        buffer = await ctx.decodeAudioData(arr);
        this.urlBufferCache.set(url, buffer);
      } catch {
        return null;
      }
    }

    const analysis = this.analyzeBufferIntro(buffer);
    const introStartSec =
      typeof overrideStartSec === 'number' && overrideStartSec >= 0
        ? Math.min(Math.max(0, buffer.duration - 1), overrideStartSec)
        : analysis.introStartSec;
    const detectedBpm =
      overrideBpm && overrideBpm >= 60 && overrideBpm <= 200
        ? Math.round(overrideBpm)
        : analysis.detectedBpm;

    const sr = buffer.sampleRate;
    const clipEndSec = Math.min(buffer.duration, Math.max(16, introStartSec + 14));
    const clipSamples = Math.max(1024, Math.round(clipEndSec * sr));

    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    const sliceL = ch0.slice(0, clipSamples);
    const sliceR = ch1.slice(0, clipSamples);

    const wavBlob = encodeWav(sliceL, sliceR, sr);
    const safeSlug = trackName
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28) || 'cola_base';
    const file = new File([wavBlob], `${safeSlug}_cola.wav`, {
      type: 'audio/wav',
    });
    const clipUrl = URL.createObjectURL(file);

    // Pre-populate decoded buffer cache for instant zero-latency pad playback
    const clipBuf = ctx.createBuffer(2, clipSamples, sr);
    clipBuf.copyToChannel(sliceL, 0);
    clipBuf.copyToChannel(sliceR, 1);
    this.urlBufferCache.set(clipUrl, clipBuf);
    this.bufferAnalysisCache.set(clipBuf, { introStartSec, detectedBpm });

    return {
      file,
      url: clipUrl,
      introStartSec,
      detectedBpm,
    };
  }

  private createBeatLoopBuffer(
    ctx: AudioContext,
    srcBuffer: AudioBuffer,
    beats: 4 | 8,
    bpm: number,
    startSec?: number
  ): AudioBuffer {
    const safeBpm = Math.max(40, Math.min(220, bpm || 100));
    const targetSec = (beats * 60) / safeBpm;
    const targetSamples = Math.max(256, Math.round(targetSec * ctx.sampleRate));

    const ch0 = srcBuffer.getChannelData(0);
    let startSample =
      typeof startSec === 'number' && Number.isFinite(startSec) && startSec >= 0
        ? this.findZeroCrossing(
            ch0,
            Math.min(
              Math.max(0, srcBuffer.length - 256),
              Math.round(startSec * srcBuffer.sampleRate)
            ),
            Math.round(srcBuffer.sampleRate * 0.004)
          )
        : this.detectIntroStartSample(srcBuffer);

    if (startSample >= srcBuffer.length - 128) {
      startSample = 0;
    }

    const out = ctx.createBuffer(
      srcBuffer.numberOfChannels,
      targetSamples,
      ctx.sampleRate
    );
    const headFade = Math.min(
      Math.round(0.003 * ctx.sampleRate),
      Math.floor(targetSamples / 32)
    );
    const tailFade = Math.min(
      Math.round(0.01 * ctx.sampleRate),
      Math.floor(targetSamples / 10)
    );

    const available = Math.max(1, srcBuffer.length - startSample);
    for (let ch = 0; ch < srcBuffer.numberOfChannels; ch++) {
      const srcData = srcBuffer.getChannelData(ch);
      const outData = out.getChannelData(ch);
      const copyLen = Math.min(available, targetSamples);
      for (let i = 0; i < copyLen; i++) {
        let sample = srcData[startSample + i];
        if (i < headFade && startSample > 0) {
          sample *= i / headFade;
        }
        if (i >= copyLen - tailFade) {
          sample *= (copyLen - i) / tailFade;
        }
        outData[i] = sample;
      }
    }
    return out;
  }

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

  public async triggerPad(
    pad: SamplerPad,
    mode: TriggerMode,
    fallbackBpm = 100
  ): Promise<boolean> {
    if (!pad.customAudioUrl && !pad.fxPreset) return false;
    const ctx = this.ensureContext();

    const effectiveMode: TriggerMode =
      pad.loopMode === 'loop-4'
        ? 'loop-4'
        : pad.loopMode === 'loop-8'
        ? 'loop-8'
        : pad.loopMode === 'oneshot'
        ? 'one-shot'
        : mode;

    const isLoop = effectiveMode === 'loop-4' || effectiveMode === 'loop-8';

    // Pressing an already-looping pad toggles it OFF cleanly
    if (isLoop && (this.activePadSources.get(pad.id)?.length || 0) > 0) {
      this.releasePad(pad.id);
      return false;
    }

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

    if (!buffer || !this.samplerGain) return false;

    if (effectiveMode === 'one-shot' || effectiveMode === 'gate' || isLoop) {
      this.releasePad(pad.id);
    }

    const src = ctx.createBufferSource();
    if (isLoop) {
      if (pad.loopFullFile) {
        src.buffer = buffer;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = buffer.duration;
      } else {
        const beats: 4 | 8 = effectiveMode === 'loop-4' ? 4 : 8;
        const analysis = this.analyzeBufferIntro(buffer);
        const loopBpm = pad.loopBpm || analysis.detectedBpm || fallbackBpm || 100;
        const startSec =
          typeof pad.loopStartSec === 'number'
            ? pad.loopStartSec
            : analysis.introStartSec;
        const loopBuf = this.createBeatLoopBuffer(
          ctx,
          buffer,
          beats,
          loopBpm,
          startSec
        );
        src.buffer = loopBuf;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = loopBuf.duration;
      }
      this.activeLoopPadIds.add(pad.id);
    } else {
      src.buffer = buffer;
      this.activeDuckingSources.add(src);
      this.updateDuckState();
    }

    const padGain = ctx.createGain();
    padGain.gain.value = pad.volume ?? 0.9;

    src.connect(padGain);
    padGain.connect(this.samplerGain);

    const list = this.activePadSources.get(pad.id) || [];
    list.push(src);
    this.activePadSources.set(pad.id, list);
    this.emitPadState();

    src.onended = () => {
      const current = this.activePadSources.get(pad.id) || [];
      const remaining = current.filter((item) => item !== src);
      this.activePadSources.set(pad.id, remaining);
      if (remaining.length === 0) {
        this.activeLoopPadIds.delete(pad.id);
      }
      if (this.activeDuckingSources.delete(src)) {
        this.updateDuckState();
      }
      this.emitPadState();
    };

    src.start(0);
    return true;
  }

  public releasePad(padId: number) {
    const active = this.activePadSources.get(padId);
    if (!active || active.length === 0) {
      this.activeLoopPadIds.delete(padId);
      return;
    }
    active.forEach((src) => {
      this.activeDuckingSources.delete(src);
      try {
        src.stop();
      } catch {
        // Already stopped
      }
    });
    this.activePadSources.set(padId, []);
    this.activeLoopPadIds.delete(padId);
    this.updateDuckState();
    this.emitPadState();
  }

  public stopAllPads() {
    for (const padId of this.activePadSources.keys()) {
      this.releasePad(padId);
    }
    this.activeDuckingSources.clear();
    this.activeLoopPadIds.clear();
    this.updateDuckState();
    this.emitPadState();
  }
}

export const audioEngine = new ShowLiveAudioEngine();
