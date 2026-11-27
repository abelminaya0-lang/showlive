import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Folder,
  FolderPlus,
  HardDrive,
  Library,
  Loader2,
  Music,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  DeckId,
  DriveFolder,
  DriveMusicFile,
  LibraryTab,
  Playlist,
  TrackItem,
  YouTubeSearchResult,
} from '../types/showlive';
import { formatDriveFileSize } from '../services/googleDriveService';

interface LibraryPanelProps {
  activeTab: LibraryTab;
  onSelectTab: (tab: LibraryTab) => void;
  playlists: Playlist[];
  selectedPlaylistId: string | null;
  onSelectPlaylist: (id: string | null) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  tracks: TrackItem[];
  onImportFiles: (files: FileList) => void;
  onLoadToDeck: (track: TrackItem, deck: DeckId) => void;
  onDeleteTrack: (trackId: string) => void;
  onClearLibrary: () => void;
  onOpenAiLyrics: (track: TrackItem) => void;
  onOpenStemModal: () => void;
  onExportTrackOrShow: (track: TrackItem) => void;
  // YouTube Search
  ytResults: YouTubeSearchResult[];
  ytLoading: boolean;
  ytError: string | null;
  onSearchYoutube: (query: string) => void;
  onLoadYoutubeToDeck: (video: YouTubeSearchResult, deck: DeckId) => void;
  // Google Drive Music
  driveFiles: DriveMusicFile[];
  driveFolders: DriveFolder[];
  driveSelectedFolderId: string | null;
  driveLoading: boolean;
  driveLoadingMore: boolean;
  driveNextPageToken: string | null;
  driveLoadingFileId: string | null;
  driveError: string | null;
  needsDriveAuth: boolean;
  driveConnecting: boolean;
  driveAccountEmail: string | null;
  onConnectDrive: () => void;
  onSearchDrive: (query: string, folderId?: string | null) => void;
  onLoadMoreDrive: () => void;
  onSelectDriveFolder: (folderId: string | null) => void;
  onLoadDriveFileToDeck: (file: DriveMusicFile, deck: DeckId) => void;
}

const QUICK_KARAOKE_QUERIES = [
  'Salsa',
  'Cumbia Peruana',
  'Baladas Románticas',
  'Reggaeton',
  'Rock en Español',
];

export const LibraryPanel: React.FC<LibraryPanelProps> = ({
  activeTab,
  onSelectTab,
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  tracks,
  onImportFiles,
  onLoadToDeck,
  onDeleteTrack,
  onClearLibrary,
  onOpenAiLyrics,
  onOpenStemModal,
  onExportTrackOrShow,
  ytResults,
  ytLoading,
  ytError,
  onSearchYoutube,
  onLoadYoutubeToDeck,
  driveFiles,
  driveFolders,
  driveSelectedFolderId,
  driveLoading,
  driveLoadingMore,
  driveNextPageToken,
  driveLoadingFileId,
  driveError,
  needsDriveAuth,
  driveConnecting,
  driveAccountEmail,
  onConnectDrive,
  onSearchDrive,
  onLoadMoreDrive,
  onSelectDriveFolder,
  onLoadDriveFileToDeck,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [ytQuery, setYtQuery] = useState('');
  const [driveQuery, setDriveQuery] = useState('');
  const [karaokeOnly, setKaraokeOnly] = useState(true);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const driveSearchTimerRef = useRef<number | null>(null);
  const lastDriveSearchedQueryRef = useRef('');

  useEffect(() => {
    if (activeTab !== 'drive' || needsDriveAuth) return;
    if (driveQuery === lastDriveSearchedQueryRef.current) return;

    if (driveSearchTimerRef.current) {
      window.clearTimeout(driveSearchTimerRef.current);
    }

    driveSearchTimerRef.current = window.setTimeout(() => {
      lastDriveSearchedQueryRef.current = driveQuery;
      onSearchDrive(driveQuery, driveSelectedFolderId);
    }, 350);

    return () => {
      if (driveSearchTimerRef.current) {
        window.clearTimeout(driveSearchTimerRef.current);
      }
    };
  }, [activeTab, needsDriveAuth, driveQuery, driveSelectedFolderId, onSearchDrive]);

  const visibleTracks = tracks.filter((t) => {
    const matchesPlaylist =
      !selectedPlaylistId || t.playlistIds.includes(selectedPlaylistId);
    const matchesSearch =
      !searchFilter.trim() ||
      t.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (t.artist || '').toLowerCase().includes(searchFilter.toLowerCase());
    return matchesPlaylist && matchesSearch;
  });

  const handleCreatePlaylistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    onCreatePlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
    setCreatingPlaylist(false);
  };

  const runYoutubeSearch = (raw: string, useKaraoke: boolean) => {
    const base = raw.trim();
    if (!base) return;
    const isDirectYt =
      /(?:youtube\.com|youtu\.be)\//i.test(base) ||
      /^[A-Za-z0-9_-]{11}$/.test(base);
    if (isDirectYt) {
      onSearchYoutube(base);
      return;
    }
    const finalQuery = useKaraoke
      ? /\bkaraoke\b/i.test(base)
        ? base
        : `${base} karaoke`
      : base.replace(/\bkaraoke\b/gi, '').replace(/\s{2,}/g, ' ').trim() || base;
    onSearchYoutube(finalQuery);
  };

  const handleYoutubeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runYoutubeSearch(ytQuery, karaokeOnly);
  };

  const displayedYtResults = useMemo(() => {
    if (ytResults.length <= 1) return ytResults;
    const karaokeRegex = /\b(karaoke|pista|instrumental|version karaoke)\b/i;
    if (karaokeOnly) {
      const onlyKaraoke = ytResults.filter(
        (v) => karaokeRegex.test(v.title) || karaokeRegex.test(v.channel)
      );
      return onlyKaraoke.length >= 3 ? onlyKaraoke : ytResults;
    }
    const nonKaraoke = ytResults.filter(
      (v) => !/\bkaraoke\b/i.test(v.title) && !/\bkaraoke\b/i.test(v.channel)
    );
    return nonKaraoke.length >= 3 ? nonKaraoke : ytResults;
  }, [ytResults, karaokeOnly]);

  return (
    <div className="flex-1 min-w-0 bg-[#101218] border border-white/15 rounded-lg flex flex-col md:flex-row overflow-hidden">
      {/* Left Sidebar (Desktop) / Top Compact Bar (Mobile): LIBRARY & PLAYLISTS */}
      <aside className="w-full md:w-[195px] shrink-0 bg-[#0A0B0F] border-b md:border-b-0 md:border-r border-white/10 p-2.5 flex flex-col gap-2 md:gap-4 select-none overflow-y-auto max-h-[155px] md:max-h-none">
        <div className="flex md:flex-col items-center md:items-stretch justify-between gap-2">
          <p className="hidden md:block text-[10px] font-extrabold tracking-wider uppercase text-[#FACC15] px-2 mb-1">
            Library
          </p>
          <div className="flex md:flex-col gap-1.5 md:gap-1 flex-1 md:flex-none">
            <button
              type="button"
              onClick={() => {
                onSelectTab('local');
                onSelectPlaylist(null);
              }}
              className={`flex-1 md:flex-none min-h-[38px] md:min-h-0 flex items-center justify-center md:justify-start gap-1.5 md:gap-2 px-2.5 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'local' && !selectedPlaylistId
                  ? 'bg-[#141720] border-2 border-[#22D3EE] text-[#22D3EE] shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <Library className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Local Tracks</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('youtube')}
              className={`flex-1 md:flex-none min-h-[38px] md:min-h-0 flex items-center justify-center md:justify-start gap-1.5 md:gap-2 px-2.5 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'youtube'
                  ? 'bg-[#141720] border-2 border-[#EC287B] text-[#EC287B] shadow-[0_0_12px_rgba(236,40,123,0.25)]'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">YouTube</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('drive')}
              className={`flex-1 md:flex-none min-h-[38px] md:min-h-0 flex items-center justify-center md:justify-start gap-1.5 md:gap-2 px-2.5 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'drive'
                  ? 'bg-[#141720] border-2 border-[#34D399] text-[#34D399] shadow-[0_0_12px_rgba(52,211,153,0.25)]'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Google Drive</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="md:hidden min-h-[38px] flex items-center gap-1 px-3 py-2 rounded-md bg-[#141720] border border-[#FACC15]/55 text-xs font-bold text-[#FACC15] cursor-pointer shrink-0"
            title="Cargar Carpeta"
          >
            <FolderPlus className="w-4 h-4 text-[#FACC15]" />
            <span>Carpeta</span>
          </button>
        </div>

        {/* PLAYLISTS */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-1 md:px-2 mb-1 md:mb-2">
            <p className="text-[10px] font-bold tracking-wider uppercase text-slate-500">
              Playlists
            </p>
            <button
              type="button"
              onClick={() => setCreatingPlaylist((v) => !v)}
              className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              title="Nueva Carpeta / Playlist"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {creatingPlaylist && (
            <form onSubmit={handleCreatePlaylistSubmit} className="mb-2 px-1">
              <input
                type="text"
                autoFocus
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Nombre carpeta..."
                className="w-full px-2 py-1 text-xs rounded bg-[#141824] border border-[#F4256A]/50 text-white focus:outline-none"
              />
            </form>
          )}

          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto pb-1 md:pb-0 no-scrollbar">
            {playlists.length === 0 ? (
              <p className="px-2 py-0.5 text-[11px] text-slate-600 whitespace-nowrap">
                Sin carpetas aún
              </p>
            ) : (
              playlists.map((pl) => {
                const active = activeTab === 'local' && selectedPlaylistId === pl.id;
                return (
                  <div
                    key={pl.id}
                    className={`group flex items-center justify-between gap-1 px-2 py-1 md:py-1.5 rounded-md transition-colors shrink-0 ${
                      active
                        ? 'bg-[#141720] border border-[#FACC15] text-[#FACC15]'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5 md:border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTab('local');
                        onSelectPlaylist(pl.id);
                      }}
                      className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1 text-xs font-medium text-left cursor-pointer"
                    >
                      <Folder className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[#FACC15]' : 'text-slate-400'}`} />
                      <span className="truncate max-w-[110px] md:max-w-none">{pl.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePlaylist(pl.id)}
                      className="md:opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 cursor-pointer transition-opacity"
                      title="Eliminar carpeta"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Import Local Folder button (Desktop) */}
          <div className="hidden md:block mt-auto pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#141720] hover:bg-[#1B202C] border border-[#FACC15]/55 text-[11px] font-bold text-[#FACC15] cursor-pointer transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#FACC15]" />
              <span className="truncate">Cargar Carpeta</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Center Content */}
      <div
        className={`flex-1 min-w-0 flex flex-col relative overflow-hidden ${
          isDraggingFiles ? 'ring-2 ring-inset ring-[#F4256A] bg-[#F4256A]/5' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFiles(false);
          if (e.dataTransfer.files?.length) {
            onImportFiles(e.dataTransfer.files);
          }
        }}
      >
        {/* Hidden File & Folder Inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,video/*,.mp3,.wav,.flac,.m4a,.m4b,.aac,.ogg,.opus,.wma,.aiff,.aif,.alac,.amr,.ac3,.ape,.wv,.mp4,.mkv,.avi,.mov,.webm,.flv,.djlurivera,.json"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              onImportFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '' } as any)}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              onImportFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />

        {activeTab === 'local' ? (
          <>
            {/* Top Bar of Track Table */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-2.5 border-b border-white/10 bg-[#101218]">
              <div className="flex items-center gap-2 md:gap-3 flex-wrap w-full md:w-auto">
                <h2 className="font-display text-sm font-extrabold text-[#FACC15] whitespace-nowrap">
                  {selectedPlaylistId
                    ? playlists.find((p) => p.id === selectedPlaylistId)?.name ||
                      'Tracks in Library'
                    : 'Tracks in Library'}
                </h2>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 md:px-2.5 md:py-1 rounded bg-[#0A0B0F] hover:bg-[#181C26] border border-[#22D3EE]/55 text-xs font-bold text-[#22D3EE] cursor-pointer transition-colors whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir Música</span>
                </button>

                {tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearLibrary}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 md:px-2 md:py-1 rounded bg-[#0A0B0F] hover:bg-[#EC287B]/20 border border-white/15 hover:border-[#EC287B]/60 text-xs font-medium text-slate-400 hover:text-[#EC287B] cursor-pointer transition-colors whitespace-nowrap"
                    title="Limpiar todas las pistas y empezar desde cero"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Limpiar</span>
                  </button>
                )}

                {/* Inline compact search */}
                <div className="relative flex-1 md:flex-none min-w-[130px]">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filtrar pista..."
                    className="pl-7 pr-2.5 py-1.5 md:py-1 w-full md:w-44 rounded bg-[#0A0B0F] border border-white/15 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#22D3EE]"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenStemModal}
                className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 md:py-1.5 rounded-md bg-[#FACC15] hover:bg-[#FDE047] text-[#090A0E] text-xs font-extrabold shadow-[0_0_14px_rgba(250,204,21,0.35)] cursor-pointer transition-all whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Separar Pista (IA)</span>
              </button>
            </div>

            {/* Table Header (Desktop) */}
            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-bold tracking-wider uppercase text-slate-400 border-b border-white/10 bg-[#0A0B0F] shrink-0">
              <div className="col-span-8">Nombre</div>
              <div className="col-span-1 text-center">Letra IA</div>
              <div className="col-span-3 text-right">Acciones</div>
            </div>

            {/* Tracks List */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/5 bg-[#0C0D12]">
              {visibleTracks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-11 h-11 rounded-full bg-[#141720] border-2 border-[#FACC15]/70 flex items-center justify-center mb-3">
                    <Music className="w-5 h-5 text-[#EC287B]" />
                  </div>
                  <p className="text-sm font-bold text-white">
                    Tu biblioteca está vacía — lista para armar tu show
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Sube tus canciones locales (.mp3, .wav, .m4a, .mp4), carga una carpeta completa o arrastra tus archivos aquí. Se guardan localmente en tu navegador.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#EC287B] hover:bg-[#F43F8E] text-white text-xs font-extrabold cursor-pointer transition-colors shadow-[0_0_14px_rgba(236,40,123,0.4)]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Subir Música Local</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#141720] hover:bg-[#1C212E] border border-[#22D3EE]/60 text-[#22D3EE] text-xs font-bold cursor-pointer transition-colors"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-[#FACC15]" />
                      <span>Cargar Carpeta Completa</span>
                    </button>
                  </div>
                </div>
              ) : (
                visibleTracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex flex-col md:grid md:grid-cols-12 gap-2 px-3 md:px-4 py-3 md:py-2 md:items-center hover:bg-white/[0.03] transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2 md:contents">
                      <div className="md:col-span-8 min-w-0 flex items-center gap-2 flex-1">
                        <span className="text-xs sm:text-sm md:text-xs font-medium text-slate-100 truncate">
                          {track.name}
                        </span>
                      </div>

                      <div className="md:col-span-1 flex justify-center shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenAiLyrics(track)}
                          className={`px-2.5 py-1 md:px-2 md:py-0.5 rounded text-[11px] md:text-[10px] font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                            track.hasAiLyrics
                              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/30'
                              : 'bg-[#151823] border-white/10 text-slate-400 hover:text-white hover:border-purple-400/50'
                          }`}
                          title={
                            track.hasAiLyrics
                              ? 'Ver o editar Letra IA sincronizada'
                              : 'Generar Letra Karaoke con Gemini IA'
                          }
                        >
                          <span className="md:hidden mr-1">Letra:</span>
                          {track.hasAiLyrics ? 'SI' : 'NO'}
                        </button>
                      </div>
                    </div>

                    <div className="md:col-span-3 flex items-center justify-end gap-2 md:gap-1.5">
                      <button
                        type="button"
                        onClick={() => onExportTrackOrShow(track)}
                        className="w-10 h-9 md:w-7 md:h-7 rounded-lg md:rounded bg-[#141824] hover:bg-[#1E2436] border border-white/15 md:border-white/10 text-slate-300 flex items-center justify-center cursor-pointer"
                        title="Descargar letra / exportar preset .djlurivera"
                      >
                        <Download className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onLoadToDeck(track, 'A')}
                        className="flex-1 md:flex-none h-9 md:w-7 md:h-7 rounded-lg md:rounded bg-[#0A0B0F] hover:bg-[#22D3EE] border border-[#22D3EE]/70 text-[#22D3EE] hover:text-[#090A0E] text-xs font-extrabold flex items-center justify-center transition-colors cursor-pointer"
                        title="Cargar en Deck A"
                      >
                        <span className="md:hidden mr-1">Deck</span>A
                      </button>

                      <button
                        type="button"
                        onClick={() => onLoadToDeck(track, 'B')}
                        className="flex-1 md:flex-none h-9 md:w-7 md:h-7 rounded-lg md:rounded bg-[#0A0B0F] hover:bg-[#EC287B] border border-[#EC287B]/70 text-[#EC287B] hover:text-white text-xs font-extrabold flex items-center justify-center transition-colors cursor-pointer"
                        title="Cargar en Deck B"
                      >
                        <span className="md:hidden mr-1">Deck</span>B
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteTrack(track.id)}
                        className="w-10 h-9 md:w-7 md:h-7 rounded-lg md:rounded bg-[#141720] hover:bg-red-600/25 border border-white/15 md:border-white/10 hover:border-red-500/50 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors cursor-pointer"
                        title="Eliminar pista"
                      >
                        <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : activeTab === 'youtube' ? (
          /* YOUTUBE KARAOKE SEARCH VIEW */
          <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden bg-[#0C0D12]">
            <div className="p-3.5 border-b border-white/10 bg-[#101218] flex flex-col gap-2.5 min-w-0">
              <p className="font-display text-sm font-extrabold text-[#FACC15] leading-none">
                Buscador de Karaoke
              </p>

              <form onSubmit={handleYoutubeSubmit} className="flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-md bg-[#0A0B0F] border border-white/15 focus-within:border-[#22D3EE] transition-colors">
                  <Search className="w-4 h-4 text-[#22D3EE] shrink-0" />
                  <input
                    type="text"
                    value={ytQuery}
                    onChange={(e) => setYtQuery(e.target.value)}
                    placeholder="Buscar canción..."
                    className="flex-1 min-w-0 py-1 bg-transparent text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={karaokeOnly}
                    onClick={() => {
                      const next = !karaokeOnly;
                      setKaraokeOnly(next);
                      if (ytQuery.trim()) {
                        runYoutubeSearch(ytQuery, next);
                      }
                    }}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold transition-colors cursor-pointer select-none ${
                      karaokeOnly
                        ? 'bg-[#141720] border-[#FACC15]/70 text-[#FACC15]'
                        : 'bg-[#101218] border-white/10 text-slate-400 hover:text-slate-200'
                    }`}
                    title={
                      karaokeOnly
                        ? 'Solo Karaoke activado (clic para buscar sin karaoke)'
                        : 'Sin Karaoke activado (clic para buscar solo karaoke)'
                    }
                  >
                    <span
                      className={`w-4 h-4 rounded-[4px] flex items-center justify-center transition-colors ${
                        karaokeOnly
                          ? 'bg-[#EC287B] text-white'
                          : 'bg-[#0A0B0F] border border-slate-500/70 text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                    <span>Karaoke</span>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={ytLoading}
                  className="px-4 py-2 rounded-md bg-[#EC287B] hover:bg-[#F43F8E] disabled:opacity-60 text-white text-xs sm:text-sm font-extrabold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors shadow-[0_0_12px_rgba(236,40,123,0.35)]"
                >
                  {ytLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  <span>Buscar</span>
                </button>
              </form>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {QUICK_KARAOKE_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      setYtQuery(q);
                      runYoutubeSearch(q, karaokeOnly);
                    }}
                    className="px-2.5 py-1 rounded bg-[#0A0B0F] hover:bg-[#181B25] border border-white/15 hover:border-[#22D3EE]/60 text-[11px] font-semibold text-slate-200 hover:text-[#22D3EE] whitespace-nowrap cursor-pointer transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5">
              {ytError && (
                <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200">
                  {ytError}
                </div>
              )}

              {ytLoading ? (
                <div className="h-44 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-[#EC287B]" />
                  <span>
                    {karaokeOnly
                      ? 'Buscando solo karaokes en YouTube...'
                      : 'Buscando canciones en YouTube...'}
                  </span>
                </div>
              ) : displayedYtResults.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center p-6">
                  <Sparkles className="w-7 h-7 text-[#FACC15] mb-2" />
                  <p className="text-sm font-medium text-slate-200">
                    Busca cualquier canción en YouTube
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Escribe el título y artista, marca o desmarca Karaoke y cárgalo directo a
                    Deck A o Deck B para proyectar en vivo.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {displayedYtResults.map((vid) => (
                    <div
                      key={vid.videoId}
                      className="rounded-lg border border-white/15 bg-[#101218] overflow-hidden flex flex-col"
                    >
                      <div className="relative aspect-video bg-black">
                        <img
                          src={vid.thumbnail}
                          alt={vid.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/85 border border-[#FACC15]/40 text-[10px] font-mono-tabular text-[#FACC15]">
                          {vid.duration}
                        </span>
                      </div>
                      <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                            {vid.title}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-1 truncate">
                            {vid.channel} {vid.views ? `· ${vid.views}` : ''}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => onLoadYoutubeToDeck(vid, 'A')}
                            className="py-1 rounded bg-[#0A0B0F] hover:bg-[#22D3EE] border border-[#22D3EE]/70 text-[#22D3EE] hover:text-[#090A0E] text-[11px] font-extrabold cursor-pointer transition-colors"
                          >
                            Deck A
                          </button>
                          <button
                            type="button"
                            onClick={() => onLoadYoutubeToDeck(vid, 'B')}
                            className="py-1 rounded bg-[#0A0B0F] hover:bg-[#EC287B] border border-[#EC287B]/70 text-[#EC287B] hover:text-white text-[11px] font-extrabold cursor-pointer transition-colors"
                          >
                            Deck B
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* GOOGLE DRIVE MUSIC BROWSER VIEW */
          <div className="flex-1 min-w-0 w-full flex flex-col min-h-0 overflow-hidden bg-[#0C0D12]">
            <div className="p-3 border-b border-white/10 bg-[#101218] flex flex-col gap-2 min-w-0 w-full">
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <HardDrive className="w-4 h-4 text-[#34D399] shrink-0" />
                  <p className="font-display text-sm font-extrabold text-[#34D399] leading-none truncate">
                    Música en Google Drive
                  </p>
                  {driveAccountEmail && !needsDriveAuth && (
                    <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-[#0A0B0F] border border-[#34D399]/30 text-[10px] text-slate-300 truncate max-w-[180px]">
                      {driveAccountEmail}
                    </span>
                  )}
                </div>

                {!needsDriveAuth && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        lastDriveSearchedQueryRef.current = driveQuery;
                        onSearchDrive(driveQuery, driveSelectedFolderId);
                      }}
                      disabled={driveLoading}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0A0B0F] hover:bg-[#181C26] border border-white/15 text-[11px] font-bold text-slate-200 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      title="Actualizar lista de Google Drive"
                    >
                      <RefreshCw className={`w-3 h-3 ${driveLoading ? 'animate-spin' : ''}`} />
                      <span>Actualizar</span>
                    </button>
                    <button
                      type="button"
                      onClick={onConnectDrive}
                      disabled={driveConnecting}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0A0B0F] hover:bg-[#181C26] border border-[#34D399]/50 text-[11px] font-bold text-[#34D399] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <span>Cambiar cuenta</span>
                    </button>
                  </div>
                )}
              </div>

              {!needsDriveAuth && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (driveSearchTimerRef.current) {
                        window.clearTimeout(driveSearchTimerRef.current);
                      }
                      lastDriveSearchedQueryRef.current = driveQuery;
                      onSearchDrive(driveQuery, driveSelectedFolderId);
                    }}
                    className="flex items-center gap-2 min-w-0 w-full"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#0A0B0F] border border-white/15 focus-within:border-[#34D399] transition-colors">
                      <Search className="w-3.5 h-3.5 text-[#34D399] shrink-0" />
                      <input
                        type="text"
                        value={driveQuery}
                        onChange={(e) => setDriveQuery(e.target.value)}
                        placeholder="Buscar canción o artista en tu Google Drive..."
                        className="flex-1 min-w-0 py-0.5 bg-transparent text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none"
                      />
                      {driveQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            if (driveSearchTimerRef.current) {
                              window.clearTimeout(driveSearchTimerRef.current);
                            }
                            lastDriveSearchedQueryRef.current = '';
                            setDriveQuery('');
                            onSearchDrive('', driveSelectedFolderId);
                          }}
                          className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer shrink-0"
                          title="Limpiar búsqueda"
                          aria-label="Limpiar búsqueda"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={driveLoading}
                      className="shrink-0 px-3 sm:px-3.5 py-1.5 rounded-md bg-[#34D399] hover:bg-[#10B981] disabled:opacity-60 text-[#090A0E] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      {driveLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      <span>Buscar</span>
                    </button>
                  </form>

                  {driveFolders.length > 0 && (
                    <div className="flex items-center gap-1.5 min-w-0 w-full max-w-full overflow-x-auto pb-0.5 no-scrollbar">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectDriveFolder(null);
                          lastDriveSearchedQueryRef.current = driveQuery;
                          onSearchDrive(driveQuery, null);
                        }}
                        className={`shrink-0 px-2.5 py-1 rounded border text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                          !driveSelectedFolderId
                            ? 'bg-[#34D399]/15 border-[#34D399] text-[#34D399]'
                            : 'bg-[#0A0B0F] border-white/15 text-slate-300 hover:text-white'
                        }`}
                      >
                        Todas las carpetas
                      </button>
                      {driveFolders.map((folder) => {
                        const active = driveSelectedFolderId === folder.id;
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => {
                              onSelectDriveFolder(folder.id);
                              lastDriveSearchedQueryRef.current = driveQuery;
                              onSearchDrive(driveQuery, folder.id);
                            }}
                            title={folder.name}
                            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors max-w-[210px] ${
                              active
                                ? 'bg-[#34D399]/15 border-[#34D399] text-[#34D399]'
                                : 'bg-[#0A0B0F] border-white/15 text-slate-300 hover:text-white'
                            }`}
                          >
                            <Folder className="w-3 h-3 shrink-0" />
                            <span className="truncate">{folder.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
              {driveError && (
                <div className="m-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-200 space-y-2">
                  <p>{driveError}</p>
                  {(driveError.includes('bloqueó') ||
                    driveError.includes('popup') ||
                    driveError.includes('pestaña')) &&
                    typeof window !== 'undefined' && (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-400/40 text-white font-bold transition-colors"
                      >
                        Abrir en pestaña nueva
                      </a>
                    )}
                </div>
              )}

              {needsDriveAuth ? (
                <div className="h-full min-h-[220px] flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-[#141720] border-2 border-[#34D399]/70 flex items-center justify-center mb-3">
                    <HardDrive className="w-6 h-6 text-[#34D399]" />
                  </div>
                  <p className="text-sm font-bold text-white">
                    Conecta tu Google Drive para cargar tu música
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mb-4">
                    Inicia sesión con tu correo de Google para listar todas tus canciones y videos,
                    buscarlos por nombre y reproducirlos directo en Deck A o Deck B con Quitar Voz,
                    Tono y Auto Loop.
                  </p>
                  <button
                    type="button"
                    onClick={onConnectDrive}
                    disabled={driveConnecting}
                    className="gsi-material-button"
                  >
                    <div className="gsi-material-button-state" />
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          className="block w-full h-full"
                        >
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                          <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        {driveConnecting ? 'Conectando Google...' : 'Iniciar sesión con Google'}
                      </span>
                    </div>
                  </button>
                </div>
              ) : driveLoading ? (
                <div className="h-44 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-[#34D399]" />
                  <span>Cargando canciones de tu Google Drive...</span>
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center p-6">
                  <Music className="w-7 h-7 text-[#34D399] mb-2" />
                  <p className="text-sm font-medium text-slate-200">
                    No se encontraron canciones con ese filtro
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Prueba buscando otro nombre o seleccionando &quot;Todas las carpetas&quot;.
                  </p>
                  {driveSelectedFolderId && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectDriveFolder(null);
                        lastDriveSearchedQueryRef.current = driveQuery;
                        onSearchDrive(driveQuery, null);
                      }}
                      className="mt-3 px-3 py-1.5 rounded bg-[#34D399]/15 hover:bg-[#34D399]/25 border border-[#34D399]/60 text-xs font-bold text-[#34D399] cursor-pointer transition-colors"
                    >
                      Buscar en todo Google Drive
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-white/5 min-w-0">
                  {driveFiles.map((file) => {
                    const isDownloading = driveLoadingFileId === file.id;
                    const ext =
                      file.fileExtension?.toUpperCase() ||
                      file.name.split('.').pop()?.toUpperCase() ||
                      (file.mimeType.startsWith('video/') ? 'VIDEO' : 'AUDIO');
                    const sizeLabel = formatDriveFileSize(file.size);

                    return (
                      <div
                        key={file.id}
                        className="flex items-center justify-between gap-2.5 px-3 md:px-4 py-2 hover:bg-white/[0.03] transition-colors min-w-0"
                      >
                        <div className="min-w-0 flex items-center gap-2.5 flex-1">
                          <Music className="w-4 h-4 text-[#34D399] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-100 truncate">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                              <span className="px-1.5 py-0.2 rounded bg-white/5 border border-white/10 font-mono-tabular">
                                {ext}
                              </span>
                              {sizeLabel && <span>{sizeLabel}</span>}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={isDownloading}
                            onClick={() => onLoadDriveFileToDeck(file, 'A')}
                            className="h-7 min-w-[34px] px-2.5 rounded bg-[#0A0B0F] hover:bg-[#22D3EE] disabled:opacity-50 border border-[#22D3EE]/70 text-[#22D3EE] hover:text-[#090A0E] text-xs font-extrabold flex items-center justify-center transition-colors cursor-pointer"
                            title="Cargar en Deck A"
                          >
                            {isDownloading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              'A'
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={isDownloading}
                            onClick={() => onLoadDriveFileToDeck(file, 'B')}
                            className="h-7 min-w-[34px] px-2.5 rounded bg-[#0A0B0F] hover:bg-[#EC287B] disabled:opacity-50 border border-[#EC287B]/70 text-[#EC287B] hover:text-white text-xs font-extrabold flex items-center justify-center transition-colors cursor-pointer"
                            title="Cargar en Deck B"
                          >
                            {isDownloading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              'B'
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {driveNextPageToken && (
                    <div className="p-3 flex justify-center">
                      <button
                        type="button"
                        onClick={onLoadMoreDrive}
                        disabled={driveLoadingMore}
                        className="px-4 py-1.5 rounded bg-[#141720] hover:bg-[#1B202C] border border-[#34D399]/50 text-xs font-bold text-[#34D399] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {driveLoadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>Cargar más canciones</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
