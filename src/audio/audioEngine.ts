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
    {
      introStartSec: number;
      outroStartSec: number;
      beatOffsetSec: number;
      barOffsetSec: number;
      coroStartSec: number;
      coroMixOutSec: number;
      coroDropInSec: number;
      detectedBpm: number;
      autoBeats: 4 | 8;
    }
  >();
  private activePadSources = new Map<number, AudioBufferSourceNode[]>();
  private activeLoopPadIds = new Set<number>();
  private deckLoops: Record<
    DeckId,
    {
      source: AudioBufferSourceNode;
      startSec: number;
      loopDurSec: number;
      startedCtxTime: number;
      bpm: number;
      totalDuration: number;
    } | null
  > = { A: null, B: null };
  private activeDuckingSources = new Set<AudioBufferSourceNode>();
  private autoControlledDecks = new Set<DeckId>();
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

  public setDeckAutoControlled(deckId: DeckId, active: boolean) {
    if (active) {
      this.autoControlledDecks.add(deckId);
    } else {
      this.autoControlledDecks.delete(deckId);
    }
  }

  public isDeckAutoControlled(deckId: DeckId): boolean {
    return this.autoControlledDecks.has(deckId);
  }

  public setDeckPlaybackRate(deckId: DeckId, rate: number, preservePitch = true) {
    const graph = this.decks[deckId];
    const el = graph?.mediaEl;
    if (!el) return;
    const clamped = Math.max(0.75, Math.min(1.35, Number.isFinite(rate) ? rate : 1));
    try {
      (el as any).preservesPitch = preservePitch;
      (el as any).mozPreservesPitch = preservePitch;
      (el as any).webkitPreservesPitch = preservePitch;
      if (Math.abs(el.playbackRate - clamped) > 0.0004) {
        el.playbackRate = clamped;
      }
    } catch {
      // Ignore media elements not yet ready
    }
  }

  public getDeckMediaElement(deckId: DeckId): HTMLMediaElement | null {
    return this.decks[deckId]?.mediaEl || null;
  }

  public async waitForDeckReadyAndSeek(
    deckId: DeckId,
    targetSec: number,
    playbackRate: number,
    preservePitch = true,
    expectedSrc?: string | null
  ): Promise<HTMLMediaElement | null> {
    this.ensureContext();
    const waitStart = performance.now();
    let el = this.decks[deckId]?.mediaEl || null;

    // Wait up to 2500ms for React to mount/attach the updated <video> element
    while (
      performance.now() - waitStart < 2500 &&
      (!el || (expectedSrc && el.getAttribute('src') !== expectedSrc && el.currentSrc !== expectedSrc))
    ) {
      await new Promise((r) => window.setTimeout(r, 25));
      el = this.decks[deckId]?.mediaEl || null;
    }
    if (!el) return null;

    // Wait up to 4000ms for metadata so seeking works reliably
    if (el.readyState < 1) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el?.removeEventListener('loadedmetadata', finish);
          el?.removeEventListener('canplay', finish);
          el?.removeEventListener('error', finish);
          resolve();
        };
        el!.addEventListener('loadedmetadata', finish);
        el!.addEventListener('canplay', finish);
        el!.addEventListener('error', finish);
        window.setTimeout(finish, 4000);
      });
    }

    const clampedRate = Math.max(
      0.75,
      Math.min(1.35, Number.isFinite(playbackRate) ? playbackRate : 1)
    );
    try {
      (el as any).preservesPitch = preservePitch;
      (el as any).mozPreservesPitch = preservePitch;
      (el as any).webkitPreservesPitch = preservePitch;
      el.playbackRate = clampedRate;
    } catch {
      // Ignore
    }

    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 9999;
    const safeSeek = Math.max(0, Math.min(Math.max(0, dur - 0.5), targetSec));

    if (el.readyState >= 1 && Math.abs(el.currentTime - safeSeek) > 0.04) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el?.removeEventListener('seeked', finish);
          resolve();
        };
        el!.addEventListener('seeked', finish);
        try {
          el!.currentTime = safeSeek;
        } catch {
          finish();
          return;
        }
        window.setTimeout(finish, 650);
      });
    }

    // Wait briefly until HAVE_CURRENT_DATA (readyState >= 2) so playback starts without silence
    if (el.readyState < 2) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el?.removeEventListener('canplay', finish);
          el?.removeEventListener('loadeddata', finish);
          el?.removeEventListener('error', finish);
          resolve();
        };
        el!.addEventListener('canplay', finish);
        el!.addEventListener('loadeddata', finish);
        el!.addEventListener('error', finish);
        window.setTimeout(finish, 2000);
      });
    }

    return el;
  }

  public async playDeckMediaSynced(
    deckId: DeckId,
    playbackRate: number,
    preservePitch = true
  ): Promise<boolean> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const el = this.decks[deckId]?.mediaEl;
    if (!el) return false;
    this.setDeckPlaybackRate(deckId, playbackRate, preservePitch);
    try {
      await el.play();
      return !el.paused;
    } catch {
      return false;
    }
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

  public async startDeckIntroLoop(
    deckId: DeckId,
    url: string,
    overrideBpm?: number,
    beats: 4 | 8 = 4
  ): Promise<{
    startSec: number;
    endSec: number;
    bpm: number;
    totalDuration: number;
  } | null> {
    if (!url) return null;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const graph = this.ensureDeckGraph(deckId);
    this.stopDeckIntroLoop(deckId);

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
    const startSec = analysis.introStartSec;
    const bpm =
      overrideBpm && overrideBpm >= 50 && overrideBpm <= 200
        ? Math.round(overrideBpm)
        : analysis.detectedBpm;

    const loopBuf = this.createBeatLoopBuffer(
      ctx,
      buffer,
      beats,
      bpm,
      startSec
    );

    const src = ctx.createBufferSource();
    src.buffer = loopBuf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = loopBuf.duration;
    src.connect(graph.pitchShifter.input);

    const startedCtxTime = ctx.currentTime;
    src.start(startedCtxTime);

    this.deckLoops[deckId] = {
      source: src,
      startSec,
      loopDurSec: loopBuf.duration,
      startedCtxTime,
      bpm,
      totalDuration: buffer.duration,
    };

    return {
      startSec,
      endSec: startSec + loopBuf.duration,
      bpm,
      totalDuration: buffer.duration,
    };
  }

  public getDeckIntroLoopPosition(deckId: DeckId): number | null {
    const loop = this.deckLoops[deckId];
    if (!loop || !this.ctx) return null;
    const elapsed = Math.max(0, this.ctx.currentTime - loop.startedCtxTime);
    return loop.startSec + (elapsed % Math.max(0.05, loop.loopDurSec));
  }

  public stopDeckIntroLoop(deckId: DeckId): number | null {
    const loop = this.deckLoops[deckId];
    if (!loop) return null;
    const resumeSec = this.getDeckIntroLoopPosition(deckId) ?? loop.startSec;
    this.deckLoops[deckId] = null;
    try {
      loop.source.stop();
    } catch {
      // Already stopped
    }
    try {
      loop.source.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    return resumeSec;
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

    // Scan steady body (skipping slow ambient intro when track is > 40s) up to 38s
    const hopSamples = Math.max(64, Math.round(sr * 0.01)); // ~100 Hz hop
    const totalDur = buffer.length / sr;
    const scanStart =
      totalDur > 42
        ? Math.max(startSample, Math.round(buffer.length * 0.18))
        : startSample;
    const maxWindow = Math.round(sr * 38);
    let effectiveStart = scanStart;
    if (buffer.length - effectiveStart < Math.round(sr * 10)) {
      effectiveStart = Math.max(0, Math.min(startSample, buffer.length - Math.round(sr * 12)));
    }
    const analyzeSamples = Math.min(buffer.length - effectiveStart, maxWindow);
    const numFrames = Math.floor(analyzeSamples / hopSamples);
    if (numFrames < 150) return 100;

    // Combine sub/kick lowpass envelope (~160 Hz) + wideband transient envelope
    const lpAlpha = Math.min(0.95, Math.max(0.01, (2 * Math.PI * 160) / sr));
    let lpState = 0;
    const lowEnv = new Float32Array(numFrames);
    const fullEnv = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const base = effectiveStart + f * hopSamples;
      let sumLow = 0;
      let sumFull = 0;
      for (let i = 0; i < hopSamples; i++) {
        const s = 0.5 * (ch0[base + i] + ch1[base + i]);
        lpState += lpAlpha * (s - lpState);
        sumLow += lpState * lpState;
        sumFull += s * s;
      }
      lowEnv[f] = Math.sqrt(sumLow / hopSamples);
      fullEnv[f] = Math.sqrt(sumFull / hopSamples);
    }

    // Positive onset flux weighted heavily toward kick/bass drum hits
    const flux = new Float32Array(numFrames);
    for (let f = 1; f < numFrames; f++) {
      const dLow = Math.max(0, lowEnv[f] - lowEnv[f - 1]);
      const dFull = Math.max(0, fullEnv[f] - fullEnv[f - 1]);
      flux[f] = dLow * 0.72 + dFull * 0.28;
    }

    const hopRate = sr / hopSamples; // ~100 Hz
    const minBpm = 70;
    const maxBpm = 162;
    const minLag = Math.max(20, Math.floor((60 / maxBpm) * hopRate));
    const maxLag = Math.min(numFrames - 10, Math.ceil((60 / minBpm) * hopRate));
    if (maxLag <= minLag) return 100;

    const scores = new Float32Array(maxLag + 2);
    let bestLag = minLag;
    let bestScore = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0;
      const limit = numFrames - lag;
      for (let i = 0; i < limit; i++) {
        ac += flux[i] * flux[i + lag];
      }
      const lag2 = lag * 2;
      if (lag2 < numFrames) {
        let ac2 = 0;
        const lim2 = numFrames - lag2;
        for (let i = 0; i < lim2; i++) {
          ac2 += flux[i] * flux[i + lag2];
        }
        ac += ac2 * 0.6;
      }
      const lag4 = lag * 4;
      if (lag4 < numFrames) {
        let ac4 = 0;
        const lim4 = numFrames - lag4;
        for (let i = 0; i < lim4; i++) {
          ac4 += flux[i] * flux[i + lag4];
        }
        ac += ac4 * 0.45;
      }

      const bpm = (60 * hopRate) / lag;
      const prior = bpm >= 82 && bpm <= 138 ? 1.15 : 0.95;
      const score = (ac / Math.max(1, limit)) * prior;
      scores[lag] = score;

      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    // Parabolic sub-sample peak refinement for 0.1 BPM accuracy
    let refinedLag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const y1 = scores[bestLag - 1];
      const y2 = scores[bestLag];
      const y3 = scores[bestLag + 1];
      const denom = 2 * (y1 - 2 * y2 + y3);
      if (Math.abs(denom) > 1e-12) {
        const delta = Math.max(-0.5, Math.min(0.5, (y1 - y3) / denom));
        refinedLag = bestLag + delta;
      }
    }

    const rawBpm = (60 * hopRate) / Math.max(1, refinedLag);
    const snapped = Math.round(rawBpm * 10) / 10;
    const nearestInt = Math.round(snapped);
    const finalBpm = Math.abs(snapped - nearestInt) < 0.22 ? nearestInt : snapped;
    return Math.max(68, Math.min(168, finalBpm));
  }

  /**
   * Comb-filter phase histogram + 4-beat compás downbeat classifier:
   * locates both the sub-beat grid (`beatOffsetSec`) AND Beat-1 of the 4-beat bar (`barOffsetSec`)
   * even when a track starts with vocals, pads, or silence.
   */
  private detectBeatGridOffset(
    buffer: AudioBuffer,
    introSample: number,
    bpm: number
  ): { beatOffsetSec: number; barOffsetSec: number; snappedIntroSec: number } {
    const sr = buffer.sampleRate;
    const beatPeriod = 60 / Math.max(55, Math.min(180, bpm || 100));
    const barPeriod = beatPeriod * 4;
    const introSec = Math.max(0, introSample / sr);
    const duration = buffer.length / sr;

    if (duration < beatPeriod * 2) {
      const beatOff = Number((introSec % beatPeriod).toFixed(4));
      const barOff = Number((introSec % barPeriod).toFixed(4));
      return {
        beatOffsetSec: beatOff,
        barOffsetSec: barOff,
        snappedIntroSec: Number(introSec.toFixed(3)),
      };
    }

    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

    const hopSamples = Math.max(32, Math.round(sr * 0.005)); // 5ms phase resolution
    const hopSec = hopSamples / sr;
    const scanStartSec = duration > 24 ? Math.max(0, Math.min(introSec, duration * 0.12)) : 0;
    const scanEndSec = duration > 50 ? Math.min(duration - 0.5, scanStartSec + 42) : duration;

    const startFrame = Math.floor((scanStartSec * sr) / hopSamples);
    const endFrame = Math.min(
      Math.floor(buffer.length / hopSamples),
      Math.floor((scanEndSec * sr) / hopSamples)
    );
    if (endFrame - startFrame < 40) {
      const beatOff = Number((introSec % beatPeriod).toFixed(4));
      const barOff = Number((introSec % barPeriod).toFixed(4));
      return {
        beatOffsetSec: beatOff,
        barOffsetSec: barOff,
        snappedIntroSec: Number(introSec.toFixed(3)),
      };
    }

    const lpAlpha = Math.min(0.95, Math.max(0.01, (2 * Math.PI * 145) / sr));
    let lpState = 0;
    let prevLow = 0;
    let prevFull = 0;

    const numBins = 64;
    const phaseHistogram = new Float32Array(numBins);
    const frameCount = endFrame - startFrame;
    const onsetCurve = new Float32Array(frameCount);
    const lowRmsCurve = new Float32Array(frameCount);

    for (let f = startFrame; f < endFrame; f++) {
      const base = f * hopSamples;
      let sumLow = 0;
      let sumFull = 0;
      for (let i = 0; i < hopSamples && base + i < buffer.length; i++) {
        const s = 0.5 * (ch0[base + i] + ch1[base + i]);
        lpState += lpAlpha * (s - lpState);
        sumLow += lpState * lpState;
        sumFull += s * s;
      }
      const lowRms = Math.sqrt(sumLow / hopSamples);
      const fullRms = Math.sqrt(sumFull / hopSamples);
      const onset = Math.max(0, lowRms - prevLow) * 0.8 + Math.max(0, fullRms - prevFull) * 0.2;
      prevLow = lowRms;
      prevFull = fullRms;

      const idx = f - startFrame;
      onsetCurve[idx] = onset;
      lowRmsCurve[idx] = lowRms;

      const t = f * hopSec;
      const phase = ((t % beatPeriod) + beatPeriod) % beatPeriod;
      const bin = Math.min(numBins - 1, Math.floor((phase / beatPeriod) * numBins));
      phaseHistogram[bin] += onset;
    }

    // Step 1: Circularly smoothed sub-beat grid offset
    let bestBin = 0;
    let bestEnergy = -1;
    for (let b = 0; b < numBins; b++) {
      const prevB = (b - 1 + numBins) % numBins;
      const nextB = (b + 1) % numBins;
      const smoothed =
        phaseHistogram[prevB] * 0.25 + phaseHistogram[b] * 0.5 + phaseHistogram[nextB] * 0.25;
      if (smoothed > bestEnergy) {
        bestEnergy = smoothed;
        bestBin = b;
      }
    }

    const beatOffsetSec = Number((((bestBin + 0.5) / numBins) * beatPeriod).toFixed(4));

    // Step 2: Classify Beat 1 of the 4-beat compás (k mod 4 in {0, 1, 2, 3})
    // Downbeat Beat 1 exhibits stronger low kick onset + bar-boundary energy transitions + alignment with song entry
    const beatKickScores = new Float64Array(4);
    const beatContrastScores = new Float64Array(4);
    const halfBeatWinFrames = Math.max(2, Math.round((beatPeriod * 0.16) / hopSec));

    let k = Math.max(0, Math.ceil((scanStartSec - beatOffsetSec) / beatPeriod));
    let prevBeatAvg = 0;
    while (true) {
      const tBeat = beatOffsetSec + k * beatPeriod;
      if (tBeat >= scanEndSec - beatPeriod * 0.3) break;
      const centerFrame = Math.round(tBeat / hopSec) - startFrame;
      if (centerFrame >= 0 && centerFrame < frameCount) {
        const f0 = Math.max(0, centerFrame - halfBeatWinFrames);
        const f1 = Math.min(frameCount - 1, centerFrame + halfBeatWinFrames);
        let maxOnset = 0;
        let sumLow = 0;
        for (let i = f0; i <= f1; i++) {
          if (onsetCurve[i] > maxOnset) maxOnset = onsetCurve[i];
          sumLow += lowRmsCurve[i];
        }
        const avgLow = sumLow / Math.max(1, f1 - f0 + 1);
        const slot = ((k % 4) + 4) % 4;
        beatKickScores[slot] += maxOnset;
        beatContrastScores[slot] += Math.abs(avgLow - prevBeatAvg);
        prevBeatAvg = avgLow;
      }
      k++;
    }

    // Score which slot (0..3) matches the initial musical entry (introSec)
    const entryBeatK = Math.round((introSec - beatOffsetSec) / beatPeriod);
    const entrySlot = ((entryBeatK % 4) + 4) % 4;

    let bestSlot = entrySlot;
    let bestCompasScore = -1;
    const maxKick = Math.max(1e-6, ...beatKickScores);
    const maxContrast = Math.max(1e-6, ...beatContrastScores);
    for (let slot = 0; slot < 4; slot++) {
      const kickNorm = beatKickScores[slot] / maxKick;
      const contrastNorm = beatContrastScores[slot] / maxContrast;
      const entryBonus = slot === entrySlot ? 0.14 : 0;
      const totalScore = kickNorm * 0.56 + contrastNorm * 0.3 + entryBonus;
      if (totalScore > bestCompasScore) {
        bestCompasScore = totalScore;
        bestSlot = slot;
      }
    }

    const barOffsetSec = Number(
      (((beatOffsetSec + bestSlot * beatPeriod) % barPeriod + barPeriod) % barPeriod).toFixed(4)
    );

    // Snap introSec onto the nearest Beat-1 of a compás (or nearest beat if >1.2s away from the entry transient)
    const barK = Math.ceil((introSec - 0.06 - barOffsetSec) / barPeriod);
    let snappedIntroSec = barOffsetSec + barK * barPeriod;
    if (snappedIntroSec < 0) snappedIntroSec += barPeriod;
    if (snappedIntroSec - introSec > beatPeriod * 1.6) {
      const beatK = Math.ceil((introSec - 0.04 - beatOffsetSec) / beatPeriod);
      snappedIntroSec = Math.max(0, beatOffsetSec + beatK * beatPeriod);
    }
    if (snappedIntroSec > duration - 1) snappedIntroSec = introSec;

    return {
      beatOffsetSec,
      barOffsetSec,
      snappedIntroSec: Number(snappedIntroSec.toFixed(3)),
    };
  }

  /**
   * Finds high-energy Chorus ("Coro") plateaus & phrase-quantized 4-bar DJ mix points
   * strictly aligned to Beat-1 of the 4-beat compás (`barOffsetSec`).
   */
  private detectChorusAndMixPoints(
    buffer: AudioBuffer,
    introBeatSec: number,
    barOffsetSec: number,
    bpm: number
  ): {
    coroStartSec: number;
    coroMixOutSec: number;
    coroDropInSec: number;
  } {
    const sr = buffer.sampleRate;
    const duration = buffer.length / sr;
    const beatPeriod = 60 / Math.max(55, Math.min(180, bpm || 100));
    const barSec = beatPeriod * 4;

    const snapToBar = (sec: number, minSec: number, maxSec: number) => {
      const clamped = Math.max(minSec, Math.min(maxSec, sec));
      const k = Math.round((clamped - barOffsetSec) / barSec);
      const barTime = barOffsetSec + k * barSec;
      return Number(Math.max(minSec, Math.min(maxSec, barTime)).toFixed(3));
    };

    if (duration < 14) {
      const coroStartSec = snapToBar(duration * 0.42, introBeatSec + 0.5, Math.max(introBeatSec + 1, duration - 4));
      const coroMixOutSec = snapToBar(duration * 0.62, introBeatSec + 1, Math.max(introBeatSec + 1.5, duration - 4.5));
      return {
        coroStartSec,
        coroMixOutSec,
        coroDropInSec: introBeatSec,
      };
    }

    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

    // 0.5s RMS energy curve across the full song
    const blockSec = 0.5;
    const blockSamples = Math.max(256, Math.round(sr * blockSec));
    const numBlocks = Math.floor(buffer.length / blockSamples);
    if (numBlocks < 8) {
      const coroMixOutSec = snapToBar(duration * 0.68, introBeatSec + 2, duration - 5);
      return {
        coroStartSec: coroMixOutSec,
        coroMixOutSec,
        coroDropInSec: introBeatSec,
      };
    }

    const rmsCurve = new Float32Array(numBlocks);
    let maxRms = 0;
    for (let b = 0; b < numBlocks; b++) {
      const base = b * blockSamples;
      const stride = Math.max(1, Math.floor(blockSamples / 128));
      let sq = 0;
      let cnt = 0;
      for (let i = 0; i < blockSamples; i += stride) {
        const s = 0.5 * (ch0[base + i] + ch1[base + i]);
        sq += s * s;
        cnt++;
      }
      const r = Math.sqrt(sq / Math.max(1, cnt));
      rmsCurve[b] = r;
      if (r > maxRms) maxRms = r;
    }

    if (maxRms < 0.005) {
      const coroMixOutSec = snapToBar(duration * 0.68, introBeatSec + 2, duration - 6);
      return {
        coroStartSec: coroMixOutSec,
        coroMixOutSec,
        coroDropInSec: introBeatSec,
      };
    }

    // 4-second smoothed energy curve (8 blocks) to detect chorus plateaus
    const smoothWin = Math.min(8, Math.max(3, Math.floor(numBlocks / 6)));
    const smoothCurve = new Float32Array(numBlocks);
    for (let b = 0; b < numBlocks; b++) {
      let sum = 0;
      let cnt = 0;
      const half = Math.floor(smoothWin / 2);
      for (let k = Math.max(0, b - half); k <= Math.min(numBlocks - 1, b + half); k++) {
        sum += rmsCurve[k];
        cnt++;
      }
      smoothCurve[b] = sum / Math.max(1, cnt);
    }

    // Early Drop / Chorus-In in first half (10% .. 52%)
    const earlyStartB = Math.max(0, Math.floor(numBlocks * 0.1));
    const earlyEndB = Math.max(earlyStartB + 1, Math.floor(numBlocks * 0.52));
    let bestEarlyB = earlyStartB;
    let bestEarlyVal = -1;
    for (let b = earlyStartB; b < earlyEndB; b++) {
      if (smoothCurve[b] > bestEarlyVal) {
        bestEarlyVal = smoothCurve[b];
        bestEarlyB = b;
      }
    }
    const coroDropInSec = snapToBar(
      bestEarlyB * blockSec,
      introBeatSec,
      Math.max(introBeatSec + 1, duration * 0.55)
    );

    // Late Chorus ("Coro final") in second half (44% .. 86%)
    const minOutTailSec = duration < 45 ? Math.max(5.5, duration * 0.24) : Math.max(12, barSec * 4);
    const maxMixOutSec = Math.max(introBeatSec + 4, duration - minOutTailSec);
    const minMixOutSec = Math.max(introBeatSec + 2, duration * 0.44);

    const lateStartB = Math.max(0, Math.floor((minMixOutSec / duration) * numBlocks));
    const lateEndB = Math.min(
      numBlocks - 1,
      Math.floor((Math.max(minMixOutSec + 2, duration - 6) / duration) * numBlocks)
    );

    let peakLateB = lateStartB;
    let peakLateVal = -1;
    for (let b = lateStartB; b <= lateEndB; b++) {
      if (smoothCurve[b] >= peakLateVal) {
        peakLateVal = smoothCurve[b];
        peakLateB = b;
      }
    }

    // Step backward from peak to find start of this chorus plateau (>= 78% of chorus peak)
    const plateauThresh = peakLateVal * 0.78;
    let coroStartB = peakLateB;
    while (coroStartB > lateStartB && smoothCurve[coroStartB - 1] >= plateauThresh) {
      coroStartB--;
    }
    const rawCoroStartSec = coroStartB * blockSec;

    // Step forward from chorus start across the hook (~8-16s) to pick the ideal DJ mix-out phrase:
    // Blend starts right in the tail/exit of the last chorus while rhythm energy is still driving!
    const chorusHoldSec = duration < 45 ? Math.min(5, duration * 0.16) : Math.min(16, barSec * 4);
    let coroEndB = Math.min(numBlocks - 1, coroStartB + Math.round(chorusHoldSec / blockSec));
    while (
      coroEndB < lateEndB &&
      smoothCurve[coroEndB] >= peakLateVal * 0.74 &&
      (coroEndB - coroStartB) * blockSec < (duration < 45 ? 8 : 22)
    ) {
      coroEndB++;
    }

    const rawMixOutSec = Math.min(maxMixOutSec, Math.max(minMixOutSec, coroEndB * blockSec));
    const coroStartSec = snapToBar(rawCoroStartSec, introBeatSec + 1, maxMixOutSec);
    const coroMixOutSec = snapToBar(rawMixOutSec, minMixOutSec, maxMixOutSec);

    return {
      coroStartSec,
      coroMixOutSec,
      coroDropInSec,
    };
  }

  private detectBestLoopBeats(
    buffer: AudioBuffer,
    startSample: number,
    bpm: number
  ): 4 | 8 {
    const sr = buffer.sampleRate;
    const fourBeatSamples = Math.round(((4 * 60) / Math.max(60, bpm)) * sr);
    const eightBeatSamples = fourBeatSamples * 2;
    if (startSample + eightBeatSamples > buffer.length) return 4;

    const ch0 = buffer.getChannelData(0);
    const chunk = Math.max(128, Math.round(sr * 0.04)); // 40ms energy bins
    const binsPerBar = Math.floor(fourBeatSamples / chunk);
    if (binsPerBar < 8) return 4;

    let rmsBar1 = 0;
    let rmsBar2 = 0;
    let dot = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let b = 0; b < binsPerBar; b++) {
      let e1 = 0;
      let e2 = 0;
      const off1 = startSample + b * chunk;
      const off2 = startSample + fourBeatSamples + b * chunk;
      for (let i = 0; i < chunk; i++) {
        const s1 = ch0[off1 + i];
        const s2 = ch0[off2 + i];
        e1 += s1 * s1;
        e2 += s2 * s2;
      }
      const v1 = Math.sqrt(e1 / chunk);
      const v2 = Math.sqrt(e2 / chunk);
      rmsBar1 += v1;
      rmsBar2 += v2;
      dot += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    }

    const avg1 = rmsBar1 / binsPerBar;
    const avg2 = rmsBar2 / binsPerBar;
    const energyRatio = avg1 > 0.001 ? avg2 / avg1 : 1;
    const similarity =
      norm1 > 0 && norm2 > 0 ? dot / Math.sqrt(norm1 * norm2) : 0;

    // If vocals/drop dramatically changes bar 2, lock strictly onto the 4-beat intro groove
    if (energyRatio > 1.42 || energyRatio < 0.62) return 4;
    // Fast tempos or cohesive 2-bar rhythmic pattern lock cleanly to 8 beats
    if (bpm >= 112 || similarity >= 0.72) return 8;
    return 4;
  }

  private detectOutroStartSample(
    buffer: AudioBuffer,
    introSample: number,
    barOffsetSec: number,
    bpm: number
  ): number {
    const sr = buffer.sampleRate;
    const durationSamples = buffer.length;
    const beatPeriod = 60 / Math.max(55, Math.min(180, bpm || 100));
    const barSec = beatPeriod * 4;

    if (durationSamples < sr * 8) {
      return Math.max(introSample + 1, Math.round(durationSamples * 0.7));
    }

    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

    // Sample the body RMS (between 25% and 70% of track) as reference energy
    const bodyStart = Math.round(durationSamples * 0.25);
    const bodyEnd = Math.round(durationSamples * 0.7);
    const step = Math.max(1, Math.floor((bodyEnd - bodyStart) / 6000));
    let bodySq = 0;
    let bodyCount = 0;
    for (let i = bodyStart; i < bodyEnd; i += step) {
      const s = 0.5 * (ch0[i] + ch1[i]);
      bodySq += s * s;
      bodyCount++;
    }
    const bodyRms = Math.sqrt(bodySq / Math.max(1, bodyCount));
    if (bodyRms < 0.005) {
      return Math.max(0, durationSamples - Math.round(sr * 12));
    }

    // Scan backwards from the end across the last 36 seconds in 50ms windows
    const winSamples = Math.max(256, Math.round(sr * 0.05));
    const minScanSample = Math.max(
      Math.round(durationSamples * 0.5),
      durationSamples - Math.round(sr * 36)
    );
    const activeThresh = Math.max(0.015, bodyRms * 0.22);

    let lastLoudEndSample = durationSamples;
    for (let pos = durationSamples - winSamples; pos >= minScanSample; pos -= winSamples) {
      let sq = 0;
      const stride = Math.max(1, Math.floor(winSamples / 64));
      let count = 0;
      for (let i = 0; i < winSamples; i += stride) {
        const s = 0.5 * (ch0[pos + i] + ch1[pos + i]);
        sq += s * s;
        count++;
      }
      const rms = Math.sqrt(sq / Math.max(1, count));
      if (rms >= activeThresh) {
        lastLoudEndSample = pos + winSamples;
        break;
      }
    }

    // Ideal DJ outro point sits ~14s (or 7s on short clips) before trailing silence, snapped to 4-beat compás
    const leadSec = durationSamples / sr < 45 ? 7 : 14;
    const rawOutroSec = Math.max(
      (introSample / sr) + 4,
      Math.min((durationSamples / sr) - 4, lastLoudEndSample / sr - leadSec)
    );
    const k = Math.round((rawOutroSec - barOffsetSec) / barSec);
    const snappedSec = barOffsetSec + k * barSec;
    const idealSample = Math.round(snappedSec * sr);

    const minValid = Math.max(introSample + Math.round(sr * 4), Math.round(durationSamples * 0.52));
    const maxValid = Math.max(minValid, durationSamples - Math.round(sr * 3.5));
    return Math.max(minValid, Math.min(maxValid, idealSample));
  }

  public analyzeBufferIntro(buffer: AudioBuffer): {
    introStartSec: number;
    outroStartSec: number;
    beatOffsetSec: number;
    barOffsetSec: number;
    coroStartSec: number;
    coroMixOutSec: number;
    coroDropInSec: number;
    detectedBpm: number;
    autoBeats: 4 | 8;
  } {
    const cached = this.bufferAnalysisCache.get(buffer);
    if (cached) return cached;

    const rawIntroSample = this.detectIntroStartSample(buffer);
    const detectedBpm = this.estimateBpmFromBuffer(buffer, rawIntroSample);
    const { beatOffsetSec, barOffsetSec, snappedIntroSec } = this.detectBeatGridOffset(
      buffer,
      rawIntroSample,
      detectedBpm
    );
    const snappedIntroSample = Math.min(
      buffer.length - 1,
      Math.round(snappedIntroSec * buffer.sampleRate)
    );
    const autoBeats = this.detectBestLoopBeats(buffer, snappedIntroSample, detectedBpm);
    const outroSample = this.detectOutroStartSample(
      buffer,
      snappedIntroSample,
      barOffsetSec,
      detectedBpm
    );
    const { coroStartSec, coroMixOutSec, coroDropInSec } = this.detectChorusAndMixPoints(
      buffer,
      snappedIntroSec,
      barOffsetSec,
      detectedBpm
    );

    const result = {
      introStartSec: snappedIntroSec,
      outroStartSec: Number((outroSample / buffer.sampleRate).toFixed(3)),
      beatOffsetSec,
      barOffsetSec,
      coroStartSec,
      coroMixOutSec,
      coroDropInSec,
      detectedBpm,
      autoBeats,
    };
    this.bufferAnalysisCache.set(buffer, result);
    return result;
  }

  public async analyzeAudioUrl(url: string): Promise<{
    introStartSec: number;
    outroStartSec: number;
    beatOffsetSec: number;
    barOffsetSec: number;
    coroStartSec: number;
    coroMixOutSec: number;
    coroDropInSec: number;
    detectedBpm: number;
    autoBeats: 4 | 8;
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
    autoBeats: 4 | 8;
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
    const autoBeats = analysis.autoBeats;

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
    this.bufferAnalysisCache.set(clipBuf, {
      introStartSec,
      outroStartSec: Math.max(introStartSec + 2, clipEndSec - 2),
      beatOffsetSec: introStartSec,
      barOffsetSec: introStartSec,
      coroStartSec: Math.max(introStartSec + 1, clipEndSec * 0.5),
      coroMixOutSec: Math.max(introStartSec + 2, clipEndSec - 2),
      coroDropInSec: introStartSec,
      detectedBpm,
      autoBeats,
    });

    return {
      file,
      url: clipUrl,
      introStartSec,
      detectedBpm,
      autoBeats,
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
          const t = (i - (copyLen - tailFade)) / tailFade;
          sample *= 0.5 * (1 + Math.cos(Math.PI * t));
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

    const rawPadMode = pad.loopMode as string | undefined;
    const effectiveMode: TriggerMode =
      rawPadMode === 'loop' || rawPadMode === 'loop-4' || rawPadMode === 'loop-8'
        ? 'loop'
        : rawPadMode === 'oneshot'
        ? 'one-shot'
        : mode;

    const isLoop = effectiveMode === 'loop';

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
        const analysis = this.analyzeBufferIntro(buffer);
        const loopBpm = pad.loopBpm || analysis.detectedBpm || fallbackBpm || 100;
        const startSec =
          typeof pad.loopStartSec === 'number'
            ? pad.loopStartSec
            : analysis.introStartSec;
        const beats: 4 | 8 = 4;
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
