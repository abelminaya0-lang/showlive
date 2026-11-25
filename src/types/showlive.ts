export type DeckId = 'A' | 'B';
export type DeckSource = 'local' | 'youtube';
export type StemMode = 'full' | 'instrumental' | 'vocals' | 'drums_bass';
export type TriggerMode = 'one-shot' | 'poly' | 'gate';
export type WorkspaceMode = 'mixer' | 'pads';
export type LibraryTab = 'local' | 'youtube';

export interface LyricLine {
  timeSec: number;
  section: string;
  text: string;
}

export interface TrackItem {
  id: string;
  name: string;
  artist?: string;
  bpm?: number;
  musicalKey?: string;
  durationSec: number;
  sourceType: 'demo' | 'file' | 'youtube';
  audioUrl?: string;
  videoUrl?: string;
  youtubeId?: string;
  isVideo?: boolean;
  playlistIds: string[];
  hasAiLyrics: boolean;
  lyrics?: LyricLine[];
  demoPreset?: {
    bpm: number;
    rootMidi: number;
    style: 'salsa' | 'cumbia' | 'timba' | 'balada';
  };
}

export interface Playlist {
  id: string;
  name: string;
}

export interface DeckState {
  id: DeckId;
  source: DeckSource;
  track: TrackItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  pitchSemitones: number; // -12 to +12
  cuePoint: number;
  stemMode: StemMode;
  youtubeId: string | null;
  youtubeTitle: string | null;
  isExpanded: boolean;
  showLyricsOverlay: boolean;
}

export interface ChannelEqState {
  high: number; // -24 to +12 dB
  mid: number; // -24 to +12 dB
  low: number; // -24 to +12 dB (bass)
  filter: number; // -1 (LPF) to +1 (HPF), 0 = bypass
  volume: number; // 0 to 1.2 (0dB at 1.0, +6dB at 1.2)
}

export interface MixerState {
  A: ChannelEqState;
  B: ChannelEqState;
  crossfader: number; // -1 (Deck A) to +1 (Deck B)
  autoMixEnabled: boolean;
}

export type PadFxPreset =
  | 'airhorn'
  | 'laser'
  | 'timbale'
  | 'subdrop'
  | 'clap_crowd'
  | 'synth_stab'
  | 'siren'
  | 'cowbell'
  | 'scratch'
  | 'riser'
  | 'crash'
  | 'kick_808';

export interface SamplerPad {
  id: number; // 1 to 32
  label: string;
  color: string; // hex or semantic preset
  shortcut: string;
  fxPreset?: PadFxPreset;
  customAudioUrl?: string;
  customAudioName?: string;
  volume: number; // 0 to 1
}

export interface SamplerBank {
  id: string;
  name: string;
  pads: SamplerPad[];
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
  views: string;
}

export interface IAModelConfig {
  model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  language: 'es' | 'en';
  autoSyncLyrics: boolean;
}

export type CurrencyCode = 'PEN' | 'USD';

export interface AuthorizedClient {
  email: string;
  clientName: string;
  active: boolean;
  planName: string;
  amountPaid: number;
  currency: CurrencyCode;
  notes: string;
  uid: string;
  displayName: string;
  photoURL: string;
  loginCount: number;
  lastLoginAt?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  createdBy: string;
}

export interface AccessRequest {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt?: number | null;
  updatedAt?: number | null;
}

export interface AccessLog {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  enteredAt?: number | null;
}

