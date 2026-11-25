import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Disc, LayoutGrid, Library, Maximize, Settings } from 'lucide-react';
import { audioEngine } from './audio/audioEngine';
import {
  INITIAL_PLAYLISTS,
  INITIAL_SAMPLER_BANKS,
  INITIAL_TRACKS,
} from './audio/demoTracks';
import { DeckPanel } from './components/DeckPanel';
import { LandingView } from './components/LandingView';
import { LibraryPanel } from './components/LibraryPanel';
import { MixerPanel } from './components/MixerPanel';
import {
  AiLyricsModal,
  AiModelModal,
  PadEditorModal,
  StemSeparatorModal,
} from './components/Modals';
import { SamplerPanel } from './components/SamplerPanel';
import { TopBar } from './components/TopBar';
import {
  clearPersistedState,
  deleteMediaBlob,
  loadPersistedState,
  saveMediaBlob,
  savePersistedState,
} from './utils/localMediaStore';
import {
  ChannelEqState,
  DeckId,
  DeckSource,
  DeckState,
  IAModelConfig,
  LibraryTab,
  LyricLine,
  MixerState,
  Playlist,
  SamplerBank,
  SamplerPad,
  StemMode,
  TrackItem,
  TriggerMode,
  WorkspaceMode,
  YouTubeSearchResult,
} from './types/showlive';

function createInitialDeck(id: DeckId): DeckState {
  return {
    id,
    source: 'local',
    track: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    pitchSemitones: 0,
    cuePoint: 0,
    stemMode: 'full',
    youtubeId: null,
    youtubeTitle: null,
    isExpanded: false,
    showLyricsOverlay: true,
  };
}

export default function App() {
  const [inStudio, setInStudio] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('mixer');
  const [mobileTab, setMobileTab] = useState<'decks' | 'library' | 'sampler'>('decks');
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('local');
  const [playlists, setPlaylists] = useState<Playlist[]>(INITIAL_PLAYLISTS);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>(INITIAL_TRACKS);

  const [deckA, setDeckA] = useState<DeckState>(() => createInitialDeck('A'));
  const [deckB, setDeckB] = useState<DeckState>(() => createInitialDeck('B'));
  const [mixer, setMixer] = useState<MixerState>({
    A: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
    B: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
    crossfader: 0,
    autoMixEnabled: false,
  });

  // Sampler State
  const [samplerBanks, setSamplerBanks] = useState<SamplerBank[]>(
    INITIAL_SAMPLER_BANKS
  );
  const [activeBankId, setActiveBankId] = useState<string>(
    INITIAL_SAMPLER_BANKS[0].id
  );
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('one-shot');
  const [samplerCollapsed, setSamplerCollapsed] = useState(false);

  // YouTube Search State
  const [ytResults, setYtResults] = useState<YouTubeSearchResult[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

  // AI & Modals State
  const [aiConfig, setAiConfig] = useState<IAModelConfig>({
    model: 'gemini-4-hydrogen',
    language: 'es',
    autoSyncLyrics: true,
  });
  const [lyricsModalTrackId, setLyricsModalTrackId] = useState<string | null>(null);
  const [showStemModal, setShowStemModal] = useState(false);
  const [showAiConfigModal, setShowAiConfigModal] = useState(false);
  const [editingPad, setEditingPad] = useState<SamplerPad | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const libraryRef = useRef<HTMLDivElement | null>(null);
  const autoMixTimerRef = useRef<number | null>(null);
  const autoTransitionDeckRef = useRef<DeckId | null>(null);
  const deckConsumedRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const hydratedRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Rehydrate saved local tracks, playlists & sampler pads from IndexedDB
  useEffect(() => {
    let active = true;
    loadPersistedState().then((saved) => {
      if (!active) return;
      if (saved) {
        setPlaylists(saved.playlists);
        setTracks(saved.tracks);
        if (saved.samplerBanks.length > 0) {
          setSamplerBanks(saved.samplerBanks);
          setActiveBankId(saved.activeBankId || saved.samplerBanks[0].id);
        }
      }
      hydratedRef.current = true;
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist local state whenever library or sampler changes
  useEffect(() => {
    if (!hydratedRef.current) return;
    savePersistedState({
      playlists,
      tracks,
      samplerBanks,
      activeBankId,
    });
  }, [playlists, tracks, samplerBanks, activeBankId]);

  // Sync Mixer EQ & Crossfader to Web Audio Engine
  useEffect(() => {
    if (!inStudio) return;
    audioEngine.updateChannelEq('A', mixer.A);
    audioEngine.updateChannelEq('B', mixer.B);
    audioEngine.updateCrossfader(mixer.crossfader);
  }, [mixer, inStudio]);

  const setDeck = (id: DeckId, updater: (prev: DeckState) => DeckState) => {
    if (id === 'A') setDeckA(updater);
    else setDeckB(updater);
  };

  const handleOpenStudio = (initialTab: LibraryTab = 'local') => {
    audioEngine.resume();
    setLibraryTab(initialTab);
    setInStudio(true);
    if (initialTab === 'youtube' && ytResults.length === 0) {
      handleSearchYoutube('Salsa Karaoke');
    }
  };

  // Load Local Track to Deck
  const handleLoadToDeck = (track: TrackItem, deckId: DeckId) => {
    audioEngine.resume();
    deckConsumedRef.current[deckId] = false;
    setDeck(deckId, (prev) => ({
      ...prev,
      source: 'local',
      track,
      isPlaying: false,
      currentTime: 0,
      duration: track.durationSec,
      cuePoint: 0,
      showLyricsOverlay: aiConfig.autoSyncLyrics && track.hasAiLyrics,
    }));
    showToast(`Cargado en Deck ${deckId}: ${track.name}`);
  };

  // Transport Controls
  const handleTogglePlay = (deckId: DeckId) => {
    audioEngine.resume();
    setDeck(deckId, (prev) => {
      if (prev.source === 'local' && !prev.track) {
        showToast(`Carga una pista primero en Deck ${deckId}`);
        return prev;
      }
      if (prev.source === 'youtube' && !prev.youtubeId) {
        showToast(`Carga un video YouTube en Deck ${deckId}`);
        return prev;
      }
      return { ...prev, isPlaying: !prev.isPlaying };
    });
  };

  const handleCue = (deckId: DeckId) => {
    audioEngine.resume();
    setDeck(deckId, (prev) => {
      if (!prev.track) return prev;
      if (!prev.isPlaying) {
        // Set new cue point at current position
        showToast(`Cue fijado en ${Math.floor(prev.currentTime)}s (Deck ${deckId})`);
        return { ...prev, cuePoint: prev.currentTime };
      }
      // Jump back to cue point & pause
      return { ...prev, isPlaying: false, currentTime: prev.cuePoint };
    });
  };

  const handleSeek = (deckId: DeckId, timeSec: number) => {
    setDeck(deckId, (prev) => ({ ...prev, currentTime: timeSec }));
  };

  const triggerAutoMixTransition = useCallback(
    (fromDeckId: DeckId) => {
      if (autoTransitionDeckRef.current === fromDeckId) return;
      const toDeckId: DeckId = fromDeckId === 'A' ? 'B' : 'A';
      const fromDeck = fromDeckId === 'A' ? deckA : deckB;
      const toDeck = toDeckId === 'A' ? deckA : deckB;

      // Determine target track if toDeck has none loaded or already finished previously
      const pool = selectedPlaylistId
        ? tracks.filter((t) => t.playlistIds.includes(selectedPlaylistId))
        : tracks;
      let nextTrackToLoad: TrackItem | null = null;
      const shouldLoadFromPool =
        (!toDeck.track && !toDeck.youtubeId) ||
        (toDeck.source === 'local' && deckConsumedRef.current[toDeckId] && pool.length > 0);
      if (shouldLoadFromPool && pool.length > 0) {
        const currentIdx = fromDeck.track
          ? pool.findIndex((t) => t.id === fromDeck.track?.id)
          : -1;
        nextTrackToLoad = pool[(currentIdx + 1) % pool.length];
      }

      if (!toDeck.track && !toDeck.youtubeId && !nextTrackToLoad) {
        return; // Nothing to transition to
      }

      autoTransitionDeckRef.current = fromDeckId;
      deckConsumedRef.current[fromDeckId] = true;
      deckConsumedRef.current[toDeckId] = false;
      audioEngine.resume();

      if (nextTrackToLoad) {
        setDeck(toDeckId, (prev) => ({
          ...prev,
          source: 'local',
          track: nextTrackToLoad,
          isPlaying: true,
          currentTime: 0,
          duration: nextTrackToLoad.durationSec,
          cuePoint: 0,
          showLyricsOverlay: aiConfig.autoSyncLyrics && nextTrackToLoad.hasAiLyrics,
        }));
      } else {
        setDeck(toDeckId, (prev) => ({ ...prev, isPlaying: true }));
      }

      showToast(`AutoMix: pasando a Deck ${toDeckId}`);

      if (autoMixTimerRef.current) {
        window.clearInterval(autoMixTimerRef.current);
      }

      const targetSide = toDeckId === 'B' ? 1 : -1;
      const startVal = mixer.crossfader;
      const steps = 45;
      let step = 0;

      autoMixTimerRef.current = window.setInterval(() => {
        step++;
        const t = step / steps;
        const val = startVal + (targetSide - startVal) * t;
        setMixer((prev) => ({
          ...prev,
          crossfader: Number(val.toFixed(2)),
        }));
        if (step >= steps) {
          if (autoMixTimerRef.current) {
            window.clearInterval(autoMixTimerRef.current);
            autoMixTimerRef.current = null;
          }
          setDeck(fromDeckId, (prev) => ({ ...prev, isPlaying: false }));
          autoTransitionDeckRef.current = null;
        }
      }, 75);
    },
    [
      aiConfig.autoSyncLyrics,
      deckA,
      deckB,
      mixer.crossfader,
      selectedPlaylistId,
      showToast,
      tracks,
    ]
  );

  const handleTimeUpdate = (deckId: DeckId, currentTime: number, duration: number) => {
    setDeck(deckId, (prev) => ({
      ...prev,
      currentTime,
      duration: duration > 0 ? duration : prev.duration,
    }));

    const activeDeck = deckId === 'A' ? deckA : deckB;
    if (
      mixer.autoMixEnabled &&
      activeDeck.isPlaying &&
      duration > 8 &&
      duration - currentTime <= 5 &&
      autoTransitionDeckRef.current !== deckId
    ) {
      triggerAutoMixTransition(deckId);
    }
  };

  const handleEnded = (deckId: DeckId) => {
    setDeck(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    if (mixer.autoMixEnabled && autoTransitionDeckRef.current !== deckId) {
      triggerAutoMixTransition(deckId);
    }
  };

  const handleChangePitch = (deckId: DeckId, pitchSemitones: number) => {
    audioEngine.resume();
    setDeck(deckId, (prev) => ({ ...prev, pitchSemitones }));
  };

  const handleChangeSource = (deckId: DeckId, source: DeckSource) => {
    setDeck(deckId, (prev) => ({ ...prev, source, isPlaying: false }));
  };

  const handleUnloadDeck = (deckId: DeckId) => {
    deckConsumedRef.current[deckId] = false;
    setDeck(deckId, () => createInitialDeck(deckId));
    showToast(`Deck ${deckId} limpiado`);
  };

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen denied in sandboxed iframe
    }
  };

  const handleChangeStemMode = (
    deckId: DeckId,
    stemMode: StemMode,
    recommendedEq?: { high: number; mid: number; low: number }
  ) => {
    audioEngine.resume();
    setDeck(deckId, (prev) => ({ ...prev, stemMode }));
    if (recommendedEq) {
      setMixer((prev) => ({
        ...prev,
        [deckId]: {
          ...prev[deckId],
          high: recommendedEq.high,
          mid: recommendedEq.mid,
          low: recommendedEq.low,
        },
      }));
    }
    showToast(`Separación IA aplicada en Deck ${deckId}: ${stemMode}`);
  };

  // Mixer & Auto-Mix
  const handleChangeChannel = (deckId: DeckId, patch: Partial<ChannelEqState>) => {
    audioEngine.resume();
    setMixer((prev) => ({
      ...prev,
      [deckId]: { ...prev[deckId], ...patch },
    }));
  };

  const handleToggleAutoMix = () => {
    audioEngine.resume();
    setMixer((prev) => {
      const nextEnabled = !prev.autoMixEnabled;
      if (!nextEnabled && autoMixTimerRef.current) {
        window.clearInterval(autoMixTimerRef.current);
        autoMixTimerRef.current = null;
        autoTransitionDeckRef.current = null;
      }
      showToast(
        nextEnabled
          ? 'AutoMix activado: al terminar una canción pasará al otro Deck'
          : 'AutoMix desactivado'
      );
      return { ...prev, autoMixEnabled: nextEnabled };
    });
  };

  const handleManualCrossfadeNow = () => {
    const fromDeckId: DeckId =
      mixer.crossfader <= 0 && (deckA.isPlaying || deckA.track) ? 'A' : 'B';
    triggerAutoMixTransition(fromDeckId);
  };

  // File, Folder & .djlurivera Import
  const handleImportFiles = async (fileList: FileList) => {
    const files = Array.from(fileList);
    const addedTracks: TrackItem[] = [];
    const createdPlaylists: Playlist[] = [];
    const playlistMap = new Map(playlists.map((p) => [p.name.toLowerCase(), p.id]));

    for (const file of files) {
      if (file.name.endsWith('.djlurivera') || file.name.endsWith('.json')) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed.tracks)) {
            setTracks((prev) => [...parsed.tracks, ...prev]);
          }
          if (Array.isArray(parsed.banks)) {
            setSamplerBanks((prev) => [...prev, ...parsed.banks]);
          }
          showToast(`Show importado: ${file.name}`);
        } catch {
          showToast(`Archivo ${file.name} no es un paquete ShowLive válido`);
        }
        continue;
      }

      const isAudioExt = /\.(mp3|wav|ogg|m4a|aac|flac|opus|wma)$/i.test(file.name);
      const isVideoExt = /\.(mp4|webm|mkv|mov)$/i.test(file.name);
      if (
        !file.type.startsWith('audio/') &&
        !file.type.startsWith('video/') &&
        !isAudioExt &&
        !isVideoExt
      ) {
        continue;
      }

      // Detect folder name when uploading a folder via Cargar Carpeta
      const relPath = (file as any).webkitRelativePath as string | undefined;
      let targetPlaylistIds: string[] = selectedPlaylistId ? [selectedPlaylistId] : [];
      if (relPath && relPath.includes('/')) {
        const folderName = relPath.split('/')[0].trim();
        if (folderName) {
          const key = folderName.toLowerCase();
          let plId = playlistMap.get(key);
          if (!plId) {
            plId = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            playlistMap.set(key, plId);
            createdPlaylists.push({ id: plId, name: folderName });
          }
          targetPlaylistIds = [plId];
        }
      }

      const trackId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveMediaBlob(`track:${trackId}`, file);

      const objectUrl = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/') || isVideoExt;

      const durationSec = await new Promise<number>((resolve) => {
        const el = document.createElement(isVideo ? 'video' : 'audio');
        el.preload = 'metadata';
        el.src = objectUrl;
        el.onloadedmetadata = () => resolve(el.duration || 180);
        el.onerror = () => resolve(180);
      });

      const newTrack: TrackItem = {
        id: trackId,
        name: file.name,
        durationSec,
        sourceType: 'file',
        audioUrl: isVideo ? undefined : objectUrl,
        videoUrl: isVideo ? objectUrl : undefined,
        isVideo,
        playlistIds: targetPlaylistIds,
        hasAiLyrics: false,
      };
      addedTracks.push(newTrack);
    }

    if (createdPlaylists.length > 0) {
      setPlaylists((prev) => [...prev, ...createdPlaylists]);
      setSelectedPlaylistId(createdPlaylists[0].id);
    }

    if (addedTracks.length > 0) {
      setTracks((prev) => [...addedTracks, ...prev]);
      showToast(`${addedTracks.length} pista(s) guardada(s) localmente`);
    }
  };

  const handleExportTrackOrShow = (track: TrackItem) => {
    const payload =
      track.hasAiLyrics && track.lyrics?.length
        ? {
            fileName: `${track.name}.lrc`,
            content: track.lyrics
              .map((l) => {
                const m = Math.floor(l.timeSec / 60)
                  .toString()
                  .padStart(2, '0');
                const s = (l.timeSec % 60).toFixed(2).padStart(5, '0');
                return `[${m}:${s}] ${l.text}`;
              })
              .join('\n'),
            mime: 'text/plain',
          }
        : {
            fileName: `${track.name.replace(/\.[^.]+$/, '')}.djlurivera`,
            content: JSON.stringify(
              {
                app: 'ShowLive',
                exportedAt: new Date().toISOString(),
                tracks: [track],
              },
              null,
              2
            ),
            mime: 'application/json',
          };

    const blob = new Blob([payload.content], { type: payload.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exportado: ${payload.fileName}`);
  };

  // YouTube Karaoke Search
  const handleSearchYoutube = async (query: string) => {
    setYtLoading(true);
    setYtError(null);
    try {
      const res = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error buscando en YouTube.');
      }
      setYtResults(data.items || []);
    } catch (err: any) {
      setYtError(err?.message || 'No se pudo buscar en YouTube.');
    } finally {
      setYtLoading(false);
    }
  };

  const handleLoadYoutubeToDeck = (video: YouTubeSearchResult, deckId: DeckId) => {
    deckConsumedRef.current[deckId] = false;
    setDeck(deckId, (prev) => ({
      ...prev,
      source: 'youtube',
      youtubeId: video.videoId,
      youtubeTitle: video.title,
      isPlaying: true,
    }));
    showToast(`YouTube Karaoke en Deck ${deckId}: ${video.title}`);
  };

  // AI Lyrics save
  const handleSaveLyrics = (
    trackId: string,
    lyrics: LyricLine[],
    meta?: { bpm?: number; musicalKey?: string; artist?: string }
  ) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? {
              ...t,
              lyrics,
              hasAiLyrics: lyrics.length > 0,
              bpm: meta?.bpm || t.bpm,
              musicalKey: meta?.musicalKey || t.musicalKey,
              artist: meta?.artist || t.artist,
            }
          : t
      )
    );
    // Update deck references if loaded
    if (deckA.track?.id === trackId) {
      setDeckA((prev) =>
        prev.track
          ? {
              ...prev,
              track: { ...prev.track, lyrics, hasAiLyrics: lyrics.length > 0 },
              showLyricsOverlay: true,
            }
          : prev
      );
    }
    if (deckB.track?.id === trackId) {
      setDeckB((prev) =>
        prev.track
          ? {
              ...prev,
              track: { ...prev.track, lyrics, hasAiLyrics: lyrics.length > 0 },
              showLyricsOverlay: true,
            }
          : prev
      );
    }
  };

  // Sampler Bank & Pad management
  const handleCreateSamplerBank = () => {
    const name = `Show Bank ${samplerBanks.length + 1}`;
    const newBank: SamplerBank = {
      id: `bank-${Date.now()}`,
      name,
      pads: INITIAL_SAMPLER_BANKS[0].pads.map((p) => ({
        ...p,
        label: 'Empty',
        color: '#181C26',
        fxPreset: undefined,
        customAudioUrl: undefined,
        customAudioName: undefined,
      })),
    };
    setSamplerBanks((prev) => [...prev, newBank]);
    setActiveBankId(newBank.id);
    showToast(`Banco creado: ${name}`);
  };

  const handleRenameSamplerBank = () => {
    const active = samplerBanks.find((b) => b.id === activeBankId);
    if (!active) return;
    const nextName = window.prompt('Nuevo nombre del banco de samplers:', active.name);
    if (!nextName || !nextName.trim()) return;
    setSamplerBanks((prev) =>
      prev.map((b) => (b.id === activeBankId ? { ...b, name: nextName.trim() } : b))
    );
  };

  const handleDeleteSamplerBank = () => {
    if (samplerBanks.length <= 1) {
      showToast('Debe existir al menos un banco de samplers.');
      return;
    }
    const remaining = samplerBanks.filter((b) => b.id !== activeBankId);
    setSamplerBanks(remaining);
    setActiveBankId(remaining[0].id);
  };

  const handleSavePad = async (updatedPad: SamplerPad, uploadedFile?: File) => {
    if (uploadedFile) {
      await saveMediaBlob(`pad:${activeBankId}:${updatedPad.id}`, uploadedFile);
    } else if (!updatedPad.customAudioName) {
      await deleteMediaBlob(`pad:${activeBankId}:${updatedPad.id}`);
    }
    setSamplerBanks((prev) =>
      prev.map((b) =>
        b.id === activeBankId
          ? {
              ...b,
              pads: b.pads.map((p) => (p.id === updatedPad.id ? updatedPad : p)),
            }
          : b
      )
    );
    audioEngine.preloadPad(updatedPad);
  };

  const handleDropAudioOnPad = (padId: number, file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a)$/i.test(file.name)) {
      return;
    }
    const url = URL.createObjectURL(file);
    const label = file.name.replace(/\.[^.]+$/, '').slice(0, 11);
    const activeBank = samplerBanks.find((b) => b.id === activeBankId);
    const existing = activeBank?.pads.find((p) => p.id === padId);
    if (!existing) return;
    handleSavePad(
      {
        ...existing,
        label,
        color: existing.color === '#181C26' ? '#E11D48' : existing.color,
        customAudioUrl: url,
        customAudioName: file.name,
        fxPreset: undefined,
      },
      file
    );
    showToast(`Sample cargado en Pad ${padId}: ${label}`);
  };

  if (!inStudio) {
    return <LandingView onOpenStudio={handleOpenStudio} />;
  }

  // Compute effective channel gain for YouTube volume sync
  const normXf = (mixer.crossfader + 1) * 0.5;
  const effVolA = mixer.A.volume * Math.cos(normXf * 0.5 * Math.PI);
  const effVolB = mixer.B.volume * Math.cos((1 - normXf) * 0.5 * Math.PI);

  const lyricsModalTrack = tracks.find((t) => t.id === lyricsModalTrackId) || null;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#080A0F] text-slate-100 flex flex-col">
      <TopBar
        workspaceMode={workspaceMode}
        onChangeMode={setWorkspaceMode}
        onOpenAiConfig={() => setShowAiConfigModal(true)}
        onLogout={() => {
          setDeckA((p) => ({ ...p, isPlaying: false }));
          setDeckB((p) => ({ ...p, isPlaying: false }));
          audioEngine.stopAllPads();
          setInStudio(false);
        }}
        aiConfig={aiConfig}
      />

      {/* Main Studio Body */}
      <main className="flex-1 min-h-0 p-1.5 sm:p-2.5 flex flex-col gap-1.5 lg:gap-2.5 overflow-hidden">
        {workspaceMode === 'pads' ? (
          <div className="flex-1 min-h-0 flex">
            <SamplerPanel
              banks={samplerBanks}
              activeBankId={activeBankId}
              onSelectBank={setActiveBankId}
              onCreateBank={handleCreateSamplerBank}
              onRenameBank={handleRenameSamplerBank}
              onDeleteBank={handleDeleteSamplerBank}
              triggerMode={triggerMode}
              onChangeTriggerMode={setTriggerMode}
              isCollapsed={false}
              onToggleCollapse={() => setSamplerCollapsed(false)}
              isFullPadsView={true}
              onToggleFullPadsView={() => setWorkspaceMode('mixer')}
              onEditPad={setEditingPad}
              onDropAudioOnPad={handleDropAudioOnPad}
            />
          </div>
        ) : (
          <>
            {/* UPPER SECTION: DECK A + MIXER + DECK B (Desktop 3-col | Mobile 2-col Decks + Full-width Mixer) */}
            <section
              className={`${
                mobileTab === 'decks' ? 'grid' : 'hidden lg:flex'
              } grid-cols-2 grid-rows-[auto_1fr] flex-1 min-h-0 gap-1.5 lg:flex lg:flex-none lg:flex-row lg:items-stretch lg:gap-2.5 lg:h-[50%] shrink-0`}
            >
              <div className="order-1 col-span-1 lg:flex-1 min-w-0 flex">
                <DeckPanel
                  deck={deckA}
                  channelVolume={effVolA}
                  onTogglePlay={() => handleTogglePlay('A')}
                  onCue={() => handleCue('A')}
                  onSeek={(t) => handleSeek('A', t)}
                  onTimeUpdate={(t, d) => handleTimeUpdate('A', t, d)}
                  onEnded={() => handleEnded('A')}
                  onChangePitch={(s) => handleChangePitch('A', s)}
                  onChangeTrackBaseKey={(k) => {
                    if (!deckA.track) return;
                    const id = deckA.track.id;
                    setDeckA((p) =>
                      p.track ? { ...p, track: { ...p.track, musicalKey: k } } : p
                    );
                    setTracks((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, musicalKey: k } : t))
                    );
                  }}
                  onChangeSource={(src) => handleChangeSource('A', src)}
                  onToggleExpand={() =>
                    setDeckA((p) => ({ ...p, isExpanded: !p.isExpanded }))
                  }
                  onToggleLyricsOverlay={() =>
                    setDeckA((p) => ({ ...p, showLyricsOverlay: !p.showLyricsOverlay }))
                  }
                  onRequestAiLyrics={() => {
                    if (deckA.track) setLyricsModalTrackId(deckA.track.id);
                  }}
                  onChangeStemMode={(mode) => handleChangeStemMode('A', mode)}
                  onSelectYoutubeTab={() => {
                    setLibraryTab('youtube');
                    setMobileTab('library');
                  }}
                  onUnloadTrack={() => handleUnloadDeck('A')}
                />
              </div>

              <div className="order-3 col-span-2 lg:order-2 lg:col-span-1 flex min-h-0">
                <MixerPanel
                  mixer={mixer}
                  onChangeChannel={handleChangeChannel}
                  onChangeCrossfader={(val) =>
                    setMixer((prev) => ({ ...prev, crossfader: val }))
                  }
                  onToggleAutoMix={handleToggleAutoMix}
                  onManualCrossfadeNow={handleManualCrossfadeNow}
                  onFocusFiles={() => {
                    setLibraryTab('local');
                    setMobileTab('library');
                    libraryRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                />
              </div>

              <div className="order-2 col-span-1 lg:order-3 lg:flex-1 min-w-0 flex">
                <DeckPanel
                  deck={deckB}
                  channelVolume={effVolB}
                  onTogglePlay={() => handleTogglePlay('B')}
                  onCue={() => handleCue('B')}
                  onSeek={(t) => handleSeek('B', t)}
                  onTimeUpdate={(t, d) => handleTimeUpdate('B', t, d)}
                  onEnded={() => handleEnded('B')}
                  onChangePitch={(s) => handleChangePitch('B', s)}
                  onChangeTrackBaseKey={(k) => {
                    if (!deckB.track) return;
                    const id = deckB.track.id;
                    setDeckB((p) =>
                      p.track ? { ...p, track: { ...p.track, musicalKey: k } } : p
                    );
                    setTracks((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, musicalKey: k } : t))
                    );
                  }}
                  onChangeSource={(src) => handleChangeSource('B', src)}
                  onToggleExpand={() =>
                    setDeckB((p) => ({ ...p, isExpanded: !p.isExpanded }))
                  }
                  onToggleLyricsOverlay={() =>
                    setDeckB((p) => ({ ...p, showLyricsOverlay: !p.showLyricsOverlay }))
                  }
                  onRequestAiLyrics={() => {
                    if (deckB.track) setLyricsModalTrackId(deckB.track.id);
                  }}
                  onChangeStemMode={(mode) => handleChangeStemMode('B', mode)}
                  onSelectYoutubeTab={() => {
                    setLibraryTab('youtube');
                    setMobileTab('library');
                  }}
                  onUnloadTrack={() => handleUnloadDeck('B')}
                />
              </div>
            </section>

            {/* LOWER SECTION: LIBRARY + SAMPLER */}
            <section
              ref={libraryRef}
              className={`${
                mobileTab === 'library' || mobileTab === 'sampler'
                  ? 'flex'
                  : 'hidden lg:flex'
              } flex-1 min-h-0 flex-col lg:flex-row gap-2.5 overflow-hidden`}
            >
              <div
                className={`${
                  mobileTab === 'library'
                    ? 'flex flex-1 min-h-0'
                    : 'hidden lg:flex lg:flex-1 lg:min-h-0'
                }`}
              >
                <LibraryPanel
                  activeTab={libraryTab}
                  onSelectTab={(tab) => {
                    setLibraryTab(tab);
                    if (tab === 'youtube' && ytResults.length === 0) {
                      handleSearchYoutube('Salsa Karaoke');
                    }
                  }}
                  playlists={playlists}
                  selectedPlaylistId={selectedPlaylistId}
                  onSelectPlaylist={setSelectedPlaylistId}
                  onCreatePlaylist={(name) => {
                    const id = `pl-${Date.now()}`;
                    setPlaylists((prev) => [...prev, { id, name }]);
                    setSelectedPlaylistId(id);
                    setLibraryTab('local');
                    showToast(`Carpeta creada: ${name}`);
                  }}
                  onDeletePlaylist={(plId) => {
                    setPlaylists((prev) => prev.filter((p) => p.id !== plId));
                    setTracks((prev) =>
                      prev.map((t) => ({
                        ...t,
                        playlistIds: t.playlistIds.filter((id) => id !== plId),
                      }))
                    );
                    if (selectedPlaylistId === plId) {
                      setSelectedPlaylistId(null);
                    }
                    showToast('Carpeta eliminada');
                  }}
                  tracks={tracks}
                  onImportFiles={handleImportFiles}
                  onLoadToDeck={handleLoadToDeck}
                  onDeleteTrack={(id) => {
                    const target = tracks.find((t) => t.id === id);
                    if (target?.audioUrl?.startsWith('blob:')) {
                      URL.revokeObjectURL(target.audioUrl);
                    }
                    if (target?.videoUrl?.startsWith('blob:')) {
                      URL.revokeObjectURL(target.videoUrl);
                    }
                    deleteMediaBlob(`track:${id}`);
                    setTracks((prev) => prev.filter((t) => t.id !== id));
                  }}
                  onClearLibrary={async () => {
                    tracks.forEach((t) => {
                      if (t.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(t.audioUrl);
                      if (t.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(t.videoUrl);
                    });
                    await clearPersistedState();
                    setTracks([]);
                    setPlaylists([]);
                    setSelectedPlaylistId(null);
                    setDeckA(createInitialDeck('A'));
                    setDeckB(createInitialDeck('B'));
                    showToast('Biblioteca limpiada desde cero');
                  }}
                  onOpenAiLyrics={(track) => setLyricsModalTrackId(track.id)}
                  onOpenStemModal={() => setShowStemModal(true)}
                  onExportTrackOrShow={handleExportTrackOrShow}
                  ytResults={ytResults}
                  ytLoading={ytLoading}
                  ytError={ytError}
                  onSearchYoutube={handleSearchYoutube}
                  onLoadYoutubeToDeck={handleLoadYoutubeToDeck}
                />
              </div>

              <div
                className={`${
                  mobileTab === 'sampler'
                    ? 'flex flex-1 min-h-0'
                    : 'hidden lg:flex lg:min-h-0'
                }`}
              >
                <SamplerPanel
                  banks={samplerBanks}
                  activeBankId={activeBankId}
                  onSelectBank={setActiveBankId}
                  onCreateBank={handleCreateSamplerBank}
                  onRenameBank={handleRenameSamplerBank}
                  onDeleteBank={handleDeleteSamplerBank}
                  triggerMode={triggerMode}
                  onChangeTriggerMode={setTriggerMode}
                  isCollapsed={mobileTab === 'sampler' ? false : samplerCollapsed}
                  onToggleCollapse={() => setSamplerCollapsed((v) => !v)}
                  isFullPadsView={false}
                  onToggleFullPadsView={() => setWorkspaceMode('pads')}
                  onEditPad={setEditingPad}
                  onDropAudioOnPad={handleDropAudioOnPad}
                />
              </div>
            </section>
          </>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (< lg) matching cellular reference */}
      <nav
        aria-label="Navegación móvil"
        className="lg:hidden h-[58px] shrink-0 bg-[#0A0C12] border-t border-white/10 grid grid-cols-5 items-center px-1 select-none"
      >
        <button
          type="button"
          onClick={() => setMobileTab('decks')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            mobileTab === 'decks' ? 'text-[#F4256A]' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-3 py-1 rounded-xl ${
              mobileTab === 'decks' ? 'bg-[#F4256A]/15' : ''
            }`}
          >
            <Disc className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Decks</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('library')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            mobileTab === 'library' ? 'text-[#F4256A]' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-3 py-1 rounded-xl ${
              mobileTab === 'library' ? 'bg-[#F4256A]/15' : ''
            }`}
          >
            <Library className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Library</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('sampler')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            mobileTab === 'sampler' ? 'text-[#F4256A]' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-3 py-1 rounded-xl ${
              mobileTab === 'sampler' ? 'bg-[#F4256A]/15' : ''
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Sampler</span>
        </button>

        <button
          type="button"
          onClick={() => setShowAiConfigModal(true)}
          className="flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          <span className="px-3 py-1">
            <Settings className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Ajustes</span>
        </button>

        <button
          type="button"
          onClick={handleToggleFullscreen}
          className="flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          <span className="px-3 py-1">
            <Maximize className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Full</span>
        </button>
      </nav>

      {/* Modals */}
      {lyricsModalTrack && (
        <AiLyricsModal
          track={lyricsModalTrack}
          aiConfig={aiConfig}
          onClose={() => setLyricsModalTrackId(null)}
          onSaveLyrics={handleSaveLyrics}
          onProjectToDeck={(trk, deck) => {
            handleLoadToDeck(trk, deck);
            setDeck(deck, (prev) => ({
              ...prev,
              showLyricsOverlay: true,
              isPlaying: true,
            }));
          }}
        />
      )}

      {showStemModal && (
        <StemSeparatorModal
          deckA={deckA}
          deckB={deckB}
          aiConfig={aiConfig}
          onApplyStem={handleChangeStemMode}
          onClose={() => setShowStemModal(false)}
        />
      )}

      {showAiConfigModal && (
        <AiModelModal
          config={aiConfig}
          onChange={setAiConfig}
          onClose={() => setShowAiConfigModal(false)}
          onLogout={() => {
            setDeckA((p) => ({ ...p, isPlaying: false }));
            setDeckB((p) => ({ ...p, isPlaying: false }));
            audioEngine.stopAllPads();
            setInStudio(false);
          }}
        />
      )}

      {editingPad && (
        <PadEditorModal
          pad={editingPad}
          onSave={handleSavePad}
          onClose={() => setEditingPad(null)}
        />
      )}

      {/* Subtle Bottom Toast */}
      {toastMsg && (
        <div className="fixed bottom-16 lg:bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#141824]/95 border border-[#F4256A]/50 text-xs font-semibold text-white shadow-xl pointer-events-none">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
