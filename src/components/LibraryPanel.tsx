import React, { useRef, useState } from 'react';
import {
  Download,
  Folder,
  FolderPlus,
  Library,
  Loader2,
  Music,
  PlayCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  DeckId,
  LibraryTab,
  Playlist,
  TrackItem,
  YouTubeSearchResult,
} from '../types/showlive';

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
}

const QUICK_KARAOKE_QUERIES = [
  'Salsa Karaoke',
  'Cumbia Peruana Karaoke',
  'Baladas Románticas Karaoke',
  'Reggaeton Karaoke',
  'Rock en Español Karaoke',
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
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [ytQuery, setYtQuery] = useState('Salsa Karaoke');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

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

  const handleYoutubeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ytQuery.trim()) {
      onSearchYoutube(ytQuery.trim());
    }
  };

  return (
    <div className="flex-1 min-w-0 bg-[#0A0C12] border border-white/10 rounded-lg flex flex-col md:flex-row overflow-hidden">
      {/* Left Sidebar (Desktop) / Top Compact Bar (Mobile): LIBRARY & PLAYLISTS */}
      <aside className="w-full md:w-[195px] shrink-0 bg-[#090B10] border-b md:border-b-0 md:border-r border-white/10 p-2 md:p-2.5 flex flex-col gap-2 md:gap-4 select-none overflow-y-auto max-h-[170px] md:max-h-none">
        <div className="flex md:flex-col items-center md:items-stretch justify-between gap-2">
          <p className="hidden md:block text-[10px] font-bold tracking-wider uppercase text-slate-500 px-2 mb-1">
            Library
          </p>
          <div className="flex md:flex-col gap-1 flex-1 md:flex-none">
            <button
              type="button"
              onClick={() => {
                onSelectTab('local');
                onSelectPlaylist(null);
              }}
              className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-1.5 md:gap-2 px-2.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'local' && !selectedPlaylistId
                  ? 'bg-[#26111B] border border-[#F4256A]/60 text-[#F973A2]'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <Library className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Local Tracks</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('youtube')}
              className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-1.5 md:gap-2 px-2.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'youtube'
                  ? 'bg-[#26111B] border border-[#F4256A]/60 text-[#F973A2]'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">YouTube Karaoke</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="md:hidden flex items-center gap-1 px-2.5 py-2 rounded-md bg-[#131722] border border-white/10 text-[11px] font-medium text-slate-200 cursor-pointer shrink-0"
            title="Cargar Carpeta"
          >
            <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
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
                        ? 'bg-[#26111B] border border-[#F4256A]/50 text-white'
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
                      <Folder className="w-3.5 h-3.5 shrink-0 text-slate-400" />
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
          <div className="hidden md:block mt-auto pt-3 border-t border-white/5">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#131722] hover:bg-[#1B2030] border border-white/10 text-[11px] font-medium text-slate-300 cursor-pointer transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
              <span className="truncate">Cargar Carpeta</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Center Content */}
      <div
        className={`flex-1 min-w-0 flex flex-col relative ${
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
          accept="audio/*,video/*,.djlurivera,.json"
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
            {/* Top Bar of Track Table (Matches Image 2) */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10 bg-[#0D1018]">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display text-sm font-bold text-white whitespace-nowrap">
                  {selectedPlaylistId
                    ? playlists.find((p) => p.id === selectedPlaylistId)?.name ||
                      'Tracks in Library'
                    : 'Tracks in Library'}
                </h2>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#181C28] hover:bg-[#23293A] border border-white/10 text-xs font-medium text-slate-200 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-300" />
                  <span>Subir Música</span>
                </button>

                {tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearLibrary}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#151823] hover:bg-red-600/20 border border-white/10 hover:border-red-500/40 text-xs font-medium text-slate-400 hover:text-red-300 cursor-pointer transition-colors whitespace-nowrap"
                    title="Limpiar todas las pistas y empezar desde cero"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Limpiar</span>
                  </button>
                )}

                {/* Inline compact search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filtrar pista..."
                    className="pl-7 pr-2.5 py-1 w-36 sm:w-44 rounded bg-[#121520] border border-white/10 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenStemModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#8B5CF6] hover:to-[#7C3AED] text-white text-xs font-bold shadow-md shadow-purple-900/30 cursor-pointer transition-all whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Separar Pista (IA)</span>
              </button>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-bold tracking-wider uppercase text-slate-500 border-b border-white/5 bg-[#0A0C12] shrink-0">
              <div className="col-span-7 sm:col-span-8">Nombre</div>
              <div className="col-span-2 sm:col-span-1 text-center">Letra IA</div>
              <div className="col-span-3 text-right">Acciones</div>
            </div>

            {/* Tracks List */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {visibleTracks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-11 h-11 rounded-full bg-[#151926] border border-white/10 flex items-center justify-center mb-3">
                    <Music className="w-5 h-5 text-[#F4256A]" />
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
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F4256A] hover:bg-[#FF3478] text-white text-xs font-bold cursor-pointer transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Subir Música Local</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#161B28] hover:bg-[#1E2536] border border-white/15 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Cargar Carpeta Completa</span>
                    </button>
                  </div>
                </div>
              ) : (
                visibleTracks.map((track) => (
                  <div
                    key={track.id}
                    className="grid grid-cols-12 gap-2 px-4 py-2 items-center hover:bg-white/[0.03] transition-colors group"
                  >
                    <div className="col-span-7 sm:col-span-8 min-w-0 flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-100 truncate">
                        {track.name}
                      </span>
                    </div>

                    <div className="col-span-2 sm:col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => onOpenAiLyrics(track)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
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
                        {track.hasAiLyrics ? 'SI' : 'NO'}
                      </button>
                    </div>

                    <div className="col-span-3 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onExportTrackOrShow(track)}
                        className="w-7 h-7 rounded bg-[#141824] hover:bg-[#1E2436] border border-white/10 text-slate-300 flex items-center justify-center cursor-pointer"
                        title="Descargar letra / exportar preset .djlurivera"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onLoadToDeck(track, 'A')}
                        className="w-7 h-7 rounded bg-blue-600/20 hover:bg-blue-600 border border-blue-500/40 text-blue-400 hover:text-white text-xs font-bold flex items-center justify-center transition-colors cursor-pointer"
                        title="Cargar en Deck A"
                      >
                        A
                      </button>

                      <button
                        type="button"
                        onClick={() => onLoadToDeck(track, 'B')}
                        className="w-7 h-7 rounded bg-[#F4256A]/20 hover:bg-[#F4256A] border border-[#F4256A]/40 text-[#F4256A] hover:text-white text-xs font-bold flex items-center justify-center transition-colors cursor-pointer"
                        title="Cargar en Deck B"
                      >
                        B
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteTrack(track.id)}
                        className="w-7 h-7 rounded bg-[#141824] hover:bg-red-600/25 border border-white/10 hover:border-red-500/50 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors cursor-pointer"
                        title="Eliminar pista"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          /* YOUTUBE KARAOKE SEARCH VIEW */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-3.5 border-b border-white/10 bg-[#0D1018] flex flex-col gap-2.5">
              <form onSubmit={handleYoutubeSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={ytQuery}
                    onChange={(e) => setYtQuery(e.target.value)}
                    placeholder="Buscar karaoke en YouTube o pegar URL de video..."
                    className="w-full pl-9 pr-3 py-2 rounded-md bg-[#121622] border border-white/10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500/70"
                  />
                </div>
                <button
                  type="submit"
                  disabled={ytLoading}
                  className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  {ytLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
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
                      onSearchYoutube(q);
                    }}
                    className="px-2.5 py-1 rounded bg-[#141824] hover:bg-[#1E2436] border border-white/10 text-[11px] text-slate-300 hover:text-white whitespace-nowrap cursor-pointer"
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
                  <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                  <span>Buscando karaokes en YouTube...</span>
                </div>
              ) : ytResults.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center p-6">
                  <Sparkles className="w-7 h-7 text-red-400 mb-2" />
                  <p className="text-sm font-medium text-slate-200">
                    Busca cualquier canción en YouTube Karaoke
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Escribe el título y artista (o pega directamente un link de YouTube) y
                    cárgalo directo a Deck A o Deck B para proyectar en vivo.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ytResults.map((vid) => (
                    <div
                      key={vid.videoId}
                      className="rounded-lg border border-white/10 bg-[#10131C] overflow-hidden flex flex-col"
                    >
                      <div className="relative aspect-video bg-black">
                        <img
                          src={vid.thumbnail}
                          alt={vid.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono-tabular text-white">
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
                            className="py-1 rounded bg-blue-600/25 hover:bg-blue-600 border border-blue-500/40 text-blue-300 hover:text-white text-[11px] font-bold cursor-pointer transition-colors"
                          >
                            Deck A
                          </button>
                          <button
                            type="button"
                            onClick={() => onLoadYoutubeToDeck(vid, 'B')}
                            className="py-1 rounded bg-[#F4256A]/25 hover:bg-[#F4256A] border border-[#F4256A]/40 text-[#F973A2] hover:text-white text-[11px] font-bold cursor-pointer transition-colors"
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
        )}
      </div>
    </div>
  );
};
