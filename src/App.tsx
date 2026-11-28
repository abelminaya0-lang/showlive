import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { ArrowLeftRight, Disc, LayoutGrid, Library, Maximize, Settings, Sliders } from 'lucide-react';
import { audioEngine } from './audio/audioEngine';
import {
  INITIAL_PLAYLISTS,
  INITIAL_SAMPLER_BANKS,
  INITIAL_TRACKS,
  getOrCreateDemoTrackUrl,
} from './audio/demoTracks';
import { LandingView } from './components/LandingView';
import { DownloadAppButton, OfflineIndicator } from './components/PWAInstallControls';
import {
  DRIVE_REDIRECT_UI_FLAG,
  auth,
  clearDriveAccessToken,
  getDriveAccessToken,
  googleProvider,
  initDriveAuth,
  setDriveAccessToken,
  signInGoogleForDrive,
} from './firebase';
import {
  checkUserIsAdmin,
  ensureAdminClientRecord,
  loadUserWorkspace,
  recordAuthorizedClientEntry,
  saveUserWorkspace,
  submitAccessRequest,
  subscribeClientAccess,
  subscribeMyAccessRequest,
} from './services/firebaseService';
import {
  DriveAuthError,
  clearDriveMediaCache,
  downloadDriveMediaObjectUrl,
  getDescendantFolderIds,
  listDriveFolders,
  listDriveMusicFiles,
} from './services/googleDriveService';
import {
  computeTempoSync,
  extractBpmFromTrackName,
  extractChorusFromLyrics,
  pickNextAutoDjCandidate,
} from './utils/bpmUtils';

const loadDeckPanel = () => import('./components/DeckPanel');
const loadMixerPanel = () => import('./components/MixerPanel');
const loadLibraryPanel = () => import('./components/LibraryPanel');
const loadSamplerPanel = () => import('./components/SamplerPanel');
const loadTopBar = () => import('./components/TopBar');
const loadModals = () => import('./components/Modals');
const loadAdminDashboard = () => import('./components/AdminDashboardView');
const loadLoginView = () => import('./components/LoginView');

const DeckPanel = lazy(() => loadDeckPanel().then((m) => ({ default: m.DeckPanel })));
const MixerPanel = lazy(() => loadMixerPanel().then((m) => ({ default: m.MixerPanel })));
const LibraryPanel = lazy(() => loadLibraryPanel().then((m) => ({ default: m.LibraryPanel })));
const SamplerPanel = lazy(() => loadSamplerPanel().then((m) => ({ default: m.SamplerPanel })));
const TopBar = lazy(() => loadTopBar().then((m) => ({ default: m.TopBar })));
const AiLyricsModal = lazy(() => loadModals().then((m) => ({ default: m.AiLyricsModal })));
const AiModelModal = lazy(() => loadModals().then((m) => ({ default: m.AiModelModal })));
const PadEditorModal = lazy(() => loadModals().then((m) => ({ default: m.PadEditorModal })));
const StemSeparatorModal = lazy(() => loadModals().then((m) => ({ default: m.StemSeparatorModal })));
const AdminDashboardView = lazy(() =>
  loadAdminDashboard().then((m) => ({ default: m.AdminDashboardView }))
);
const LoginView = lazy(() => loadLoginView().then((m) => ({ default: m.LoginView })));

import {
  clearPersistedState,
  deleteMediaBlob,
  getMediaBlob,
  loadPersistedState,
  rehydrateSamplerBanks,
  saveMediaBlob,
  saveMediaBlobsBatch,
  savePersistedState,
} from './utils/localMediaStore';
import {
  AccessRequest,
  AuthorizedClient,
  AutoDjMixStyle,
  AutoDjPhase,
  AutoDjSourceType,
  AutoDjStatus,
  ChannelEqState,
  DeckId,
  DeckSource,
  DeckState,
  DriveFolder,
  DriveMusicFile,
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
    playbackRate: 1,
    syncedBpm: null,
    cuePoint: 0,
    stemMode: 'full',
    youtubeId: null,
    youtubeTitle: null,
    isExpanded: false,
    showLyricsOverlay: true,
  };
}

export default function App() {
  const [inStudio, setInStudio] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('mixer');
  const [mobileTab, setMobileTab] = useState<'decks' | 'mixer' | 'library' | 'sampler'>('decks');
  const [mobileActiveDeck, setMobileActiveDeck] = useState<DeckId>('A');
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
  const [isSamplerDucking, setIsSamplerDucking] = useState(false);

  // YouTube Search State
  const [ytResults, setYtResults] = useState<YouTubeSearchResult[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

  // Google Drive Music State
  const [driveFiles, setDriveFiles] = useState<DriveMusicFile[]>([]);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [driveSelectedFolderId, setDriveSelectedFolderId] = useState<string | null>(null);
  const [driveQuery, setDriveQuery] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveLoadingMore, setDriveLoadingMore] = useState(false);
  const [driveNextPageToken, setDriveNextPageToken] = useState<string | null>(null);
  const [driveLoadingFileId, setDriveLoadingFileId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [needsDriveAuth, setNeedsDriveAuth] = useState(() => !getDriveAccessToken());
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveAccountEmail, setDriveAccountEmail] = useState<string | null>(null);
  const [driveHasLoaded, setDriveHasLoaded] = useState(false);

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

  // Firebase Auth & RBAC State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [showLoginScreen, setShowLoginScreen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [clientRecord, setClientRecord] = useState<AuthorizedClient | null>(null);
  const [clientChecked, setClientChecked] = useState(false);
  const [accessRequest, setAccessRequest] = useState<AccessRequest | null>(null);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);

  const [autoDjSource, setAutoDjSource] = useState<{
    sourceType: AutoDjSourceType;
    playlistId: string | null;
    driveFolderId: string | null;
    label: string;
  }>({
    sourceType: 'all-local',
    playlistId: null,
    driveFolderId: null,
    label: 'Todas las pistas',
  });
  const [autoDjPhase, setAutoDjPhase] = useState<AutoDjPhase>('idle');
  const [autoDjMixStyle, setAutoDjMixStyle] = useState<AutoDjMixStyle>('coro');
  const [autoDjNextInfo, setAutoDjNextInfo] = useState<{
    name: string | null;
    bpm: number | null;
    targetRate: number | null;
    syncModeLabel: string | null;
    mixInSec: number | null;
    suggestedMixOutSec: number | null;
    suggestedMixInSec: number | null;
  }>({
    name: null,
    bpm: null,
    targetRate: null,
    syncModeLabel: null,
    mixInSec: null,
    suggestedMixOutSec: null,
    suggestedMixInSec: null,
  });

  const libraryRef = useRef<HTMLDivElement | null>(null);
  const autoMixTimerRef = useRef<number | null>(null);
  const autoDjBeatTimerRef = useRef<number | null>(null);
  const autoDjPllTimerRef = useRef<number | null>(null);
  const autoDjGlideTimerRef = useRef<number | null>(null);
  const autoTransitionDeckRef = useRef<DeckId | null>(null);
  const autoDjPlayedIdsRef = useRef<Set<string>>(new Set());
  const autoDjPreloadKeyRef = useRef<string | null>(null);
  const deckConsumedRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const hydratedUidRef = useRef<string | null>(null);
  const loggedEntryForUidRef = useRef<string | null>(null);
  const cloudSaveTimerRef = useRef<number | null>(null);
  const driveReqSeqRef = useRef(0);
  const driveFoldersRef = useRef(driveFolders);
  driveFoldersRef.current = driveFolders;
  const driveFilesRef = useRef(driveFiles);
  driveFilesRef.current = driveFiles;
  const driveSelectedFolderIdRef = useRef(driveSelectedFolderId);
  driveSelectedFolderIdRef.current = driveSelectedFolderId;
  const libraryTabRef = useRef(libraryTab);
  libraryTabRef.current = libraryTab;
  const playlistsRef = useRef(playlists);
  playlistsRef.current = playlists;
  const autoDjSourceRef = useRef(autoDjSource);
  autoDjSourceRef.current = autoDjSource;
  const autoDjMixStyleRef = useRef(autoDjMixStyle);
  autoDjMixStyleRef.current = autoDjMixStyle;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const selectedPlaylistIdRef = useRef(selectedPlaylistId);
  selectedPlaylistIdRef.current = selectedPlaylistId;
  const deckARef = useRef(deckA);
  deckARef.current = deckA;
  const deckBRef = useRef(deckB);
  deckBRef.current = deckB;
  const mixerRef = useRef(mixer);
  mixerRef.current = mixer;
  const aiConfigRef = useRef(aiConfig);
  aiConfigRef.current = aiConfig;

  const clientSuspended = Boolean(clientRecord && !clientRecord.active);
  const isAuthorized = Boolean(
    authUser && authUser.emailVerified && (isAdmin || !clientSuspended)
  );

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => audioEngine.subscribeDuckState(setIsSamplerDucking), []);

  // Listen to Firebase Auth & ID token changes (handles email verification reloads cleanly)
  useEffect(() => {
    let unsubClient: (() => void) | null = null;
    let unsubRequest: (() => void) | null = null;
    let lastIdentityKey = '';
    let disposed = false;
    let runSeq = 0;

    const unsubAuth = onIdTokenChanged(auth, async (fbUser) => {
      const nextKey = fbUser
        ? `${fbUser.uid}:${fbUser.emailVerified ? '1' : '0'}`
        : 'signed-out';

      if (nextKey === lastIdentityKey) {
        return;
      }
      lastIdentityKey = nextKey;
      const mySeq = ++runSeq;

      if (unsubClient) {
        unsubClient();
        unsubClient = null;
      }
      if (unsubRequest) {
        unsubRequest();
        unsubRequest = null;
      }

      setAuthUser(fbUser);

      if (!fbUser || !fbUser.email) {
        setIsAdmin(false);
        setClientRecord(null);
        setAccessRequest(null);
        setClientChecked(true);
        setAuthLoading(false);
        setShowAdminDashboard(false);
        hydratedUidRef.current = null;
        loggedEntryForUidRef.current = null;
        return;
      }

      setAuthError(null);
      setShowLoginScreen(false);

      if (!fbUser.emailVerified) {
        setIsAdmin(false);
        setClientRecord(null);
        setAccessRequest(null);
        setClientChecked(true);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      setClientChecked(false);

      let adminFlag = false;
      try {
        adminFlag = await checkUserIsAdmin(fbUser);
      } catch {
        adminFlag = false;
      }

      if (disposed || mySeq !== runSeq) return;
      setIsAdmin(adminFlag);

      if (adminFlag) {
        setClientRecord(null);
        setClientChecked(true);
        setAuthLoading(false);
        ensureAdminClientRecord(fbUser).catch(() => {
          // Non-blocking sync
        });
        const wantsAdminUrl =
          window.location.hash === '#admin' ||
          new URLSearchParams(window.location.search).get('admin') === '1';
        if (wantsAdminUrl) {
          setShowAdminDashboard(true);
        }
        return;
      }

      unsubClient = subscribeClientAccess(
        fbUser.email,
        (clientDoc) => {
          setClientRecord(clientDoc);
          setClientChecked(true);
          setAuthLoading(false);
        },
        () => {
          setClientRecord(null);
          setClientChecked(true);
          setAuthLoading(false);
        }
      );

      unsubRequest = subscribeMyAccessRequest(fbUser.uid, setAccessRequest);
    });

    return () => {
      disposed = true;
      unsubAuth();
      if (unsubClient) unsubClient();
      if (unsubRequest) unsubRequest();
    };
  }, []);

  // Keep in-memory Google Drive auth status synced with Firebase Auth state
  useEffect(() => {
    return initDriveAuth(
      (fbUser, _token, resolvedEmail) => {
        setNeedsDriveAuth(false);
        setDriveAccountEmail(resolvedEmail || fbUser?.email || null);
      },
      () => {
        setNeedsDriveAuth(true);
        setDriveFiles([]);
        setDriveFolders([]);
        setDriveNextPageToken(null);
      }
    );
  }, []);

  // Resolve any Google redirect result (fallback when popup was blocked on standalone browser)
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          const cred = GoogleAuthProvider.credentialFromResult(result);
          if (cred?.accessToken) {
            setDriveAccessToken(cred.accessToken, result.user.email || null);
            setNeedsDriveAuth(false);
            setDriveAccountEmail(result.user.email || null);
          }
          try {
            if (sessionStorage.getItem(DRIVE_REDIRECT_UI_FLAG) === '1') {
              sessionStorage.removeItem(DRIVE_REDIRECT_UI_FLAG);
              setLibraryTab('drive');
              setMobileTab('library');
            }
          } catch {
            // Ignore storage errors
          }
        }
      })
      .catch((err: any) => {
        const code = String(err?.code || '');
        if (code && code !== 'auth/null-user') {
          setAuthError(
            code === 'auth/unauthorized-domain'
              ? `El dominio "${window.location.hostname}" no está autorizado en Firebase. Agrégalo en Firebase Console (proyecto tactile-cosine-j2t1j) → Authentication → Settings → Authorized domains.`
              : `No se pudo completar el acceso con Google (${code}).`
          );
          setShowLoginScreen(true);
        }
      });
  }, []);

  // Auto-open full ShowLive Studio as soon as user signs in
  useEffect(() => {
    if (!authLoading && isAuthorized && !showAdminDashboard && !inStudio) {
      setShowLoginScreen(false);
      setInStudio(true);
    }
  }, [authLoading, isAuthorized, showAdminDashboard, inStudio]);

  // Warn if an explicitly suspended client logs in
  useEffect(() => {
    if (clientChecked && !authLoading && authUser && clientSuspended) {
      showToast('Esta cuenta está suspendida en el panel de clientes.');
    }
  }, [authLoading, authUser, clientChecked, clientSuspended, showToast]);

  // Record user studio entry log once per session
  useEffect(() => {
    if (
      authUser &&
      authUser.emailVerified &&
      clientChecked &&
      !authLoading &&
      !isAdmin &&
      !clientSuspended &&
      loggedEntryForUidRef.current !== authUser.uid
    ) {
      loggedEntryForUidRef.current = authUser.uid;
      recordAuthorizedClientEntry(authUser, clientRecord).catch(() => {
        // Handled cleanly via handleFirestoreError
      });
    }
  }, [authUser, authLoading, clientChecked, clientRecord, clientSuspended, isAdmin]);

  // Rehydrate user's cloud workspace (playlists & samplers) + local IndexedDB blobs (or guest local state)
  useEffect(() => {
    if (authLoading) return;
    const targetKey = authUser && isAuthorized ? authUser.uid : 'guest';
    if (hydratedUidRef.current === targetKey) return;
    let active = true;

    (async () => {
      const uidForCloud = authUser && isAuthorized ? authUser.uid : undefined;
      const [localData, cloudData] = await Promise.all([
        loadPersistedState(uidForCloud),
        uidForCloud ? loadUserWorkspace(uidForCloud).catch(() => null) : Promise.resolve(null),
      ]);
      if (!active) return;

      if (cloudData) {
        const cloudTracks = cloudData.tracksMeta || [];
        const localTracks = localData?.tracks || [];
        const cloudMap = new Map(cloudTracks.map((t) => [t.id, t]));
        const mergedTracks: TrackItem[] = [
          ...cloudTracks,
          ...localTracks.filter((lt) => !cloudMap.has(lt.id)),
        ];
        const nextBanks =
          cloudData.samplerBanks.length > 0
            ? await rehydrateSamplerBanks(cloudData.samplerBanks)
            : localData?.samplerBanks?.length
              ? localData.samplerBanks
              : INITIAL_SAMPLER_BANKS;

        setPlaylists(cloudData.playlists || []);
        setTracks(mergedTracks);
        setSamplerBanks(nextBanks);
        setActiveBankId(
          cloudData.activeBankId || nextBanks[0]?.id || INITIAL_SAMPLER_BANKS[0].id
        );
      } else if (localData) {
        setPlaylists(localData.playlists);
        setTracks(localData.tracks);
        if (localData.samplerBanks.length > 0) {
          setSamplerBanks(localData.samplerBanks);
          setActiveBankId(localData.activeBankId || localData.samplerBanks[0].id);
        }
      } else {
        setPlaylists(INITIAL_PLAYLISTS);
        setTracks(INITIAL_TRACKS);
        setSamplerBanks(INITIAL_SAMPLER_BANKS);
        setActiveBankId(INITIAL_SAMPLER_BANKS[0].id);
      }

      hydratedUidRef.current = targetKey;
    })();

    return () => {
      active = false;
    };
  }, [authLoading, authUser, isAuthorized]);

  // Persist locally & debounced sync to Firestore whenever playlists, tracks, or sampler changes
  useEffect(() => {
    const targetKey = authUser && isAuthorized ? authUser.uid : 'guest';
    if (hydratedUidRef.current !== targetKey) return;

    savePersistedState(
      {
        playlists,
        tracks,
        samplerBanks,
        activeBankId,
      },
      authUser && isAuthorized ? authUser.uid : undefined
    );

    if (!authUser || !isAuthorized) return;

    if (cloudSaveTimerRef.current) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }
    cloudSaveTimerRef.current = window.setTimeout(() => {
      saveUserWorkspace(authUser, {
        playlists,
        tracksMeta: tracks,
        samplerBanks,
        activeBankId,
      }).catch(() => {
        // Logged in firebaseService
      });
    }, 1200);

    return () => {
      if (cloudSaveTimerRef.current) {
        window.clearTimeout(cloudSaveTimerRef.current);
      }
    };
  }, [authUser, isAuthorized, playlists, tracks, samplerBanks, activeBankId]);

  const signingInRef = useRef(false);

  const handleSignInGoogle = async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setAuthError(null);
    setAuthNotice(null);
    try {
      const { user, email } = await signInGoogleForDrive({
        allowRedirectFallback: false,
      });
      setNeedsDriveAuth(false);
      setDriveAccountEmail(email || user.email || null);
      setShowLoginScreen(false);
    } catch (err: any) {
      const code = String(err?.code || '');
      const isStandalone = (() => {
        try {
          return window.self === window.top;
        } catch {
          return false;
        }
      })();
      if (
        isStandalone &&
        (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment')
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr: any) {
          setAuthError(
            `No se pudo abrir Google (${redirectErr?.code || 'error de redirección'}).`
          );
          return;
        }
      }
      if (code === 'auth/popup-closed-by-user') {
        setAuthError('Cerraste la ventana de Google antes de completar el ingreso.');
      } else if (code === 'auth/cancelled-popup-request') {
        setAuthError('Ya hay una ventana de Google abierta. Completa el ingreso o inténtalo de nuevo.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Tu navegador bloqueó la ventana emergente de Google. Permite popups e intenta de nuevo.');
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `El dominio "${window.location.hostname}" no está autorizado en Firebase. Agrégalo en Firebase Console (proyecto tactile-cosine-j2t1j) → Authentication → Settings → Authorized domains.`
        );
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError('El inicio de sesión con Google no está habilitado en Firebase Authentication.');
      } else if (code === 'auth/account-exists-with-different-credential') {
        setAuthError('Ese correo ya existe con contraseña. Inicia con Email y Password arriba.');
      } else if (code === 'auth/user-disabled') {
        setAuthError('Esta cuenta fue deshabilitada en Firebase.');
      } else if (code === 'auth/network-request-failed') {
        setAuthError('Error de red al conectar con Google. Verifica tu conexión o desactiva bloqueadores.');
      } else {
        setAuthError(
          `No se pudo iniciar sesión con Google (${code || err?.message || 'error desconocido'}).`
        );
      }
    } finally {
      signingInRef.current = false;
    }
  };

  const handleEmailSignIn = async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      await signInWithEmailAndPassword(auth, cleanEmail, password);
      setShowLoginScreen(false);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setAuthError('Correo o contraseña incorrectos (si aún no creaste clave, pulsa Regístrate o entra con Google).');
      } else if (code === 'auth/invalid-email') {
        setAuthError('Ingresa un correo electrónico válido.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Demasiados intentos seguidos. Espera unos minutos o restablece tu contraseña.');
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError(
          'El inicio con Email/Contraseña aún no está activado en Firebase (Sign-in method). Actívalo abajo o entra directo con "Iniciar sesión con Google".'
        );
      } else if (code === 'auth/network-request-failed') {
        setAuthError('Error de red al conectar. Verifica tu conexión.');
      } else {
        setAuthError(`No se pudo iniciar sesión (${code || err?.message || 'error'}).`);
      }
    }
  };

  const handleEmailRegister = async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      try {
        await sendEmailVerification(cred.user);
      } catch {
        // User can resend from LandingView
      }
      setAuthNotice('Cuenta creada. Te enviamos un correo para confirmar tu cuenta.');
      setShowLoginScreen(false);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/email-already-in-use') {
        setAuthError('Ese correo ya está registrado. Inicia sesión o usa "Olvidé mi contraseña".');
      } else if (code === 'auth/weak-password') {
        setAuthError('La contraseña debe tener al menos 6 caracteres.');
      } else if (code === 'auth/invalid-email') {
        setAuthError('Ingresa un correo electrónico válido.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Demasiados intentos seguidos. Espera unos minutos antes de reintentar.');
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError(
          'El registro con Email/Contraseña aún no está activado en Firebase (Sign-in method). Actívalo abajo o entra con Google.'
        );
      } else {
        setAuthError(`No se pudo crear la cuenta (${code || err?.message || 'error'}).`);
      }
    }
  };

  const handleResetPassword = async (email: string) => {
    setAuthError(null);
    setAuthNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setAuthNotice(
        'Te enviamos un enlace a tu correo para crear o restablecer tu contraseña. Revisa Spam si no lo ves.'
      );
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/user-not-found') {
        setAuthError('No existe una cuenta registrada con ese correo todavía. Regístrate primero o escríbenos por WhatsApp.');
      } else if (code === 'auth/invalid-email') {
        setAuthError('Ingresa un correo electrónico válido.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Demasiados intentos seguidos. Espera unos minutos antes de reintentar.');
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError('Email/Contraseña no está activado en Firebase (Sign-in method).');
      } else {
        setAuthError(`No se pudo enviar el correo (${code || err?.message || 'error'}).`);
      }
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      showToast('Correo de verificación reenviado.');
    } catch {
      showToast('Espera un minuto antes de reenviar el correo.');
    }
  };

  const handleRefreshVerification = async () => {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      if (auth.currentUser.emailVerified) {
        showToast('Correo verificado correctamente.');
      } else {
        showToast('Tu correo aún no aparece verificado. Revisa tu bandeja.');
      }
    } catch {
      showToast('No se pudo verificar el estado de tu correo.');
    }
  };

  const handleSignOut = async () => {
    setDeckA((p) => ({ ...p, isPlaying: false }));
    setDeckB((p) => ({ ...p, isPlaying: false }));
    audioEngine.stopAllPads();
    clearDriveAccessToken();
    clearDriveMediaCache();
    setNeedsDriveAuth(true);
    setDriveFiles([]);
    setDriveFolders([]);
    setDriveNextPageToken(null);
    setDriveAccountEmail(null);
    setShowAdminDashboard(false);
    setShowLoginScreen(false);
    setAuthError(null);
    setAuthNotice(null);
    hydratedUidRef.current = null;
    loggedEntryForUidRef.current = null;
    await signOut(auth);
  };

  const handleSwitchAccount = async () => {
    await handleSignOut();
    setShowLoginScreen(true);
  };

  const handleRequestAccess = async () => {
    if (!authUser) return;
    try {
      await submitAccessRequest(authUser);
      showToast('Solicitud enviada al administrador');
    } catch {
      showToast('No se pudo enviar la solicitud');
    }
  };

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

  // Warm up lazy Studio chunks once LandingView is idle
  useEffect(() => {
    if (inStudio) return;
    const warm = () => {
      loadLoginView();
      loadTopBar();
      loadDeckPanel();
      loadMixerPanel();
      loadLibraryPanel();
      loadSamplerPanel();
    };
    const win = window as any;
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(warm, { timeout: 1500 });
      return () => win.cancelIdleCallback(id);
    }
    const timer = globalThis.setTimeout(warm, 600);
    return () => globalThis.clearTimeout(timer);
  }, [inStudio]);

  const handleOpenStudio = (initialTab: LibraryTab = 'local') => {
    audioEngine.resume();
    setShowAdminDashboard(false);
    setShowLoginScreen(false);
    setLibraryTab(initialTab);
    setInStudio(true);
    if (initialTab === 'youtube' && ytResults.length === 0) {
      handleSearchYoutube('Salsa Karaoke');
    }
  };

  // Resolve lazy local file Blob URL if track was restored from metadata-only cache
  const resolveTrackMediaUrl = useCallback(
    async (track: TrackItem): Promise<TrackItem> => {
      if (track.sourceType !== 'file' || track.audioUrl || track.videoUrl) {
        return track;
      }
      const blob = await getMediaBlob(`track:${track.id}`);
      if (!blob) return track;
      const objectUrl = URL.createObjectURL(blob);
      const updated: TrackItem = {
        ...track,
        audioUrl: track.isVideo ? undefined : objectUrl,
        videoUrl: track.isVideo ? objectUrl : undefined,
      };
      setTracks((prev) => prev.map((t) => (t.id === track.id ? updated : t)));
      return updated;
    },
    []
  );

  // Load Local Track to Deck
  const handleLoadToDeck = async (track: TrackItem, deckId: DeckId) => {
    audioEngine.resume();
    deckConsumedRef.current[deckId] = false;
    const readyTrack = await resolveTrackMediaUrl(track);
    setDeck(deckId, (prev) => ({
      ...prev,
      source: 'local',
      track: readyTrack,
      isPlaying: false,
      currentTime: 0,
      duration: readyTrack.durationSec,
      playbackRate: 1,
      syncedBpm: null,
      cuePoint: readyTrack.introStartSec ?? 0,
      showLyricsOverlay: aiConfigRef.current.autoSyncLyrics && readyTrack.hasAiLyrics,
    }));
    if (mixerRef.current.autoMixEnabled) {
      ensureOppositeDeckQueued(deckId, readyTrack, false);
    }
    setMobileActiveDeck(deckId);
    showToast(`Cargado en Deck ${deckId}: ${readyTrack.name}`);
  };

  type AutoDjPoolEntry =
    | { kind: 'local'; id: string; name: string; bpm: number | null; track: TrackItem }
    | { kind: 'drive'; id: string; name: string; bpm: number | null; driveFile: DriveMusicFile };

  const getAutoDjPool = useCallback(
    (
      referenceTrack?: TrackItem | null,
      overrideSource?: {
        sourceType: AutoDjSourceType;
        playlistId?: string | null;
        driveFolderId?: string | null;
      },
      overrideTracks?: TrackItem[]
    ): AutoDjPoolEntry[] => {
      const src = overrideSource ?? autoDjSourceRef.current;

      if (src.sourceType === 'drive' && driveFilesRef.current.length > 0) {
        return driveFilesRef.current.map((f) => ({
          kind: 'drive' as const,
          id: `drive-${f.id}`,
          name: f.name,
          bpm: extractBpmFromTrackName(f.name),
          driveFile: f,
        }));
      }

      const allTracks = overrideTracks ?? tracksRef.current;
      const plId =
        src.sourceType === 'playlist'
          ? src.playlistId ?? selectedPlaylistIdRef.current ?? referenceTrack?.playlistIds?.[0] ?? null
          : src.sourceType === 'all-local'
          ? null
          : selectedPlaylistIdRef.current ?? referenceTrack?.playlistIds?.[0] ?? null;

      const filtered =
        plId && allTracks.some((t) => t.playlistIds.includes(plId))
          ? allTracks.filter((t) => t.playlistIds.includes(plId))
          : allTracks;

      return filtered.map((t) => ({
        kind: 'local' as const,
        id: t.id,
        name: t.name,
        bpm: t.bpm ?? extractBpmFromTrackName(t.name),
        track: t,
      }));
    },
    []
  );

  const computeTrackMixOutSec = useCallback(
    (track: TrackItem | null | undefined, duration: number, style: AutoDjMixStyle): number => {
      if (!duration || duration <= 5) return Math.max(2, (duration || 8) * 0.65);
      const minTailSec = duration < 45 ? Math.max(4.5, duration * 0.22) : 11;
      const minOutSec = Math.max(4, duration * 0.42);
      const maxOutSec = Math.max(minOutSec + 1, duration - minTailSec);

      if (style === 'coro') {
        const lyricChorus = extractChorusFromLyrics(track?.lyrics);
        const lyricTarget =
          lyricChorus.lastChorusEndSec ??
          (lyricChorus.lastChorusSec !== null ? lyricChorus.lastChorusSec + 10 : null);
        if (lyricTarget !== null && lyricTarget >= minOutSec && lyricTarget <= maxOutSec) {
          return lyricTarget;
        }
        if (
          track?.coroMixOutSec !== undefined &&
          track.coroMixOutSec >= minOutSec &&
          track.coroMixOutSec <= maxOutSec
        ) {
          return track.coroMixOutSec;
        }
      }

      if (
        track?.outroStartSec !== undefined &&
        track.outroStartSec >= Math.max(4, duration * 0.48) &&
        track.outroStartSec <= duration - 3
      ) {
        return track.outroStartSec;
      }

      return Math.max(minOutSec, Math.min(maxOutSec, duration - Math.min(14, Math.max(5.5, duration * 0.3))));
    },
    []
  );

  const resolveAutoDjEntryToTrack = useCallback(
    async (entry: AutoDjPoolEntry): Promise<TrackItem | null> => {
      if (entry.kind === 'local') {
        const ready = await resolveTrackMediaUrl(entry.track);
        const mediaUrl = ready.videoUrl || ready.audioUrl || '';
        if (
          mediaUrl &&
          (!ready.bpm ||
            ready.introStartSec === undefined ||
            ready.outroStartSec === undefined ||
            ready.barOffsetSec === undefined ||
            ready.coroMixOutSec === undefined)
        ) {
          const analysis = await audioEngine.analyzeAudioUrl(mediaUrl);
          if (analysis) {
            const enriched: TrackItem = {
              ...ready,
              bpm: ready.bpm || analysis.detectedBpm,
              introStartSec: ready.introStartSec ?? analysis.introStartSec,
              outroStartSec: ready.outroStartSec ?? analysis.outroStartSec,
              beatOffsetSec: ready.beatOffsetSec ?? analysis.beatOffsetSec,
              barOffsetSec: ready.barOffsetSec ?? analysis.barOffsetSec,
              coroStartSec: ready.coroStartSec ?? analysis.coroStartSec,
              coroMixOutSec: ready.coroMixOutSec ?? analysis.coroMixOutSec,
              coroDropInSec: ready.coroDropInSec ?? analysis.coroDropInSec,
            };
            setTracks((prev) => prev.map((t) => (t.id === enriched.id ? enriched : t)));
            return enriched;
          }
        }
        return ready;
      }

      const token = getDriveAccessToken();
      if (!token) {
        setNeedsDriveAuth(true);
        return null;
      }

      try {
        const { objectUrl, durationSec, isVideo } = await downloadDriveMediaObjectUrl(
          token,
          entry.driveFile
        );
        const parsedBpm = extractBpmFromTrackName(entry.driveFile.name);
        const analysis = await audioEngine.analyzeAudioUrl(objectUrl);
        return {
          id: `drive-${entry.driveFile.id}`,
          name: entry.driveFile.name,
          bpm: parsedBpm ?? analysis?.detectedBpm ?? undefined,
          durationSec,
          sourceType: 'file',
          audioUrl: isVideo ? undefined : objectUrl,
          videoUrl: isVideo ? objectUrl : undefined,
          isVideo,
          playlistIds: [],
          hasAiLyrics: false,
          introStartSec: analysis?.introStartSec,
          outroStartSec: analysis?.outroStartSec,
          beatOffsetSec: analysis?.beatOffsetSec,
          barOffsetSec: analysis?.barOffsetSec,
          coroStartSec: analysis?.coroStartSec,
          coroMixOutSec: analysis?.coroMixOutSec,
          coroDropInSec: analysis?.coroDropInSec,
        };
      } catch (err: any) {
        if (err instanceof DriveAuthError) {
          clearDriveAccessToken();
          setNeedsDriveAuth(true);
        }
        return null;
      }
    },
    [resolveTrackMediaUrl]
  );

  const loadPoolTrackToDeck = useCallback(
    async (
      deckId: DeckId,
      track: TrackItem,
      autoPlay: boolean,
      syncRatio = 1,
      syncedBpm: number | null = null,
      overrideStartCue?: number
    ): Promise<TrackItem> => {
      deckConsumedRef.current[deckId] = false;
      const ready = await resolveTrackMediaUrl(track);
      const startCue = overrideStartCue ?? ready.introStartSec ?? 0;
      setDeck(deckId, (prev) => ({
        ...prev,
        source: 'local',
        track: ready,
        isPlaying: autoPlay,
        currentTime: startCue,
        duration: ready.durationSec,
        playbackRate: syncRatio,
        syncedBpm,
        cuePoint: startCue,
        showLyricsOverlay: aiConfigRef.current.autoSyncLyrics && ready.hasAiLyrics,
      }));
      return ready;
    },
    [resolveTrackMediaUrl]
  );

  const ensureOppositeDeckQueued = useCallback(
    async (
      activeDeckId: DeckId,
      activeTrack?: TrackItem | null,
      forceReplace = false,
      overrideSource?: {
        sourceType: AutoDjSourceType;
        playlistId?: string | null;
        driveFolderId?: string | null;
      },
      overrideTargetBpm?: number | null
    ) => {
      const otherDeckId: DeckId = activeDeckId === 'A' ? 'B' : 'A';
      const otherDeck = otherDeckId === 'A' ? deckARef.current : deckBRef.current;
      const activeDeck = activeDeckId === 'A' ? deckARef.current : deckBRef.current;
      if (!forceReplace && otherDeck.isPlaying) return;

      const isOtherEmptyOrDone =
        forceReplace ||
        (!otherDeck.track && !otherDeck.youtubeId) ||
        (otherDeck.source === 'local' && deckConsumedRef.current[otherDeckId]);

      if (!isOtherEmptyOrDone) return;

      const pool = getAutoDjPool(activeTrack, overrideSource);
      const activeEffectiveBpm =
        overrideTargetBpm && overrideTargetBpm > 40
          ? overrideTargetBpm
          : activeTrack?.bpm
          ? activeTrack.bpm * (activeDeck.playbackRate ?? 1)
          : activeTrack?.name
          ? extractBpmFromTrackName(activeTrack.name)
          : null;

      const pick = pickNextAutoDjCandidate(pool, {
        currentId: activeTrack?.id || null,
        excludeId: forceReplace ? otherDeck.track?.id || null : null,
        outgoingBpm: activeEffectiveBpm,
        playedIds: autoDjPlayedIdsRef.current,
      });
      if (!pick) return;

      if (pick.resetCycle) {
        autoDjPlayedIdsRef.current.clear();
        if (activeTrack?.id) {
          autoDjPlayedIdsRef.current.add(activeTrack.id);
        }
      }

      const preloadKey = `${otherDeckId}:${pick.item.id}`;
      if (autoDjPreloadKeyRef.current === preloadKey) return;
      autoDjPreloadKeyRef.current = preloadKey;

      setAutoDjNextInfo((prev) => ({
        ...prev,
        name: pick.item.name,
        bpm: pick.sync.incomingBaseBpm || pick.item.bpm || null,
        targetRate: pick.sync.ratio,
        syncModeLabel: pick.sync.label,
      }));

      try {
        const resolved = await resolveAutoDjEntryToTrack(pick.item);
        if (!resolved) return;

        // Re-check if the deck was touched while downloading
        const latestOther = otherDeckId === 'A' ? deckARef.current : deckBRef.current;
        if (latestOther.isPlaying && !forceReplace) return;

        const refinedSync = computeTempoSync(
          activeEffectiveBpm,
          resolved.bpm ?? extractBpmFromTrackName(resolved.name)
        );

        // Reset standby deck EQ cleanly so it's ready for a club transition
        setMixer((prev) => ({
          ...prev,
          [otherDeckId]: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
        }));

        const loaded = await loadPoolTrackToDeck(
          otherDeckId,
          resolved,
          false,
          refinedSync.ratio,
          refinedSync.mode === 'fallback' ? null : refinedSync.targetBpm
        );

        const mediaSrc = loaded.videoUrl || loaded.audioUrl || null;
        await audioEngine.waitForDeckReadyAndSeek(
          otherDeckId,
          loaded.introStartSec ?? 0,
          refinedSync.ratio,
          true,
          mediaSrc
        );

        setAutoDjNextInfo((prev) => ({
          ...prev,
          name: loaded.name,
          bpm: loaded.bpm ?? refinedSync.incomingBaseBpm ?? null,
          targetRate: refinedSync.ratio,
          syncModeLabel: refinedSync.label,
          suggestedMixInSec: loaded.introStartSec ?? 0,
        }));
      } finally {
        if (autoDjPreloadKeyRef.current === preloadKey) {
          autoDjPreloadKeyRef.current = null;
        }
      }
    },
    [getAutoDjPool, loadPoolTrackToDeck, resolveAutoDjEntryToTrack]
  );

  const handleDeckTrackAnalysis = useCallback(
    (
      deckId: DeckId,
      analysis: {
        trackId: string;
        detectedBpm: number;
        introStartSec: number;
        outroStartSec: number;
        beatOffsetSec: number;
        barOffsetSec: number;
        coroStartSec: number;
        coroMixOutSec: number;
        coroDropInSec: number;
      }
    ) => {
      setDeck(deckId, (prev) => {
        if (!prev.track || prev.track.id !== analysis.trackId) return prev;
        return {
          ...prev,
          track: {
            ...prev.track,
            bpm: prev.track.bpm || analysis.detectedBpm,
            introStartSec: prev.track.introStartSec ?? analysis.introStartSec,
            outroStartSec: prev.track.outroStartSec ?? analysis.outroStartSec,
            beatOffsetSec: prev.track.beatOffsetSec ?? analysis.beatOffsetSec,
            barOffsetSec: prev.track.barOffsetSec ?? analysis.barOffsetSec,
            coroStartSec: prev.track.coroStartSec ?? analysis.coroStartSec,
            coroMixOutSec: prev.track.coroMixOutSec ?? analysis.coroMixOutSec,
            coroDropInSec: prev.track.coroDropInSec ?? analysis.coroDropInSec,
          },
        };
      });
      setTracks((prev) =>
        prev.map((t) =>
          t.id === analysis.trackId
            ? {
                ...t,
                bpm: t.bpm || analysis.detectedBpm,
                introStartSec: t.introStartSec ?? analysis.introStartSec,
                outroStartSec: t.outroStartSec ?? analysis.outroStartSec,
                beatOffsetSec: t.beatOffsetSec ?? analysis.beatOffsetSec,
                barOffsetSec: t.barOffsetSec ?? analysis.barOffsetSec,
                coroStartSec: t.coroStartSec ?? analysis.coroStartSec,
                coroMixOutSec: t.coroMixOutSec ?? analysis.coroMixOutSec,
                coroDropInSec: t.coroDropInSec ?? analysis.coroDropInSec,
              }
            : t
        )
      );
    },
    []
  );

  // Transport Controls
  const handleTogglePlay = (deckId: DeckId) => {
    audioEngine.resume();
    const currentDeck = deckId === 'A' ? deckARef.current : deckBRef.current;
    if (currentDeck.source === 'local' && !currentDeck.track) {
      showToast(`Carga una pista primero en Deck ${deckId}`);
      return;
    }
    if (currentDeck.source === 'youtube' && !currentDeck.youtubeId) {
      showToast(`Carga un video YouTube en Deck ${deckId}`);
      return;
    }
    const willPlay = !currentDeck.isPlaying;
    setDeck(deckId, (prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
    if (willPlay && mixerRef.current.autoMixEnabled && currentDeck.source === 'local') {
      ensureOppositeDeckQueued(deckId, currentDeck.track, false);
    }
  };

  const handleCue = (deckId: DeckId) => {
    audioEngine.resume();
    setDeck(deckId, (prev) => {
      if (!prev.track) return prev;
      if (!prev.isPlaying) {
        showToast(`Cue fijado en ${Math.floor(prev.currentTime)}s (Deck ${deckId})`);
        return { ...prev, cuePoint: prev.currentTime };
      }
      return { ...prev, isPlaying: false, currentTime: prev.cuePoint };
    });
  };

  const handleSeek = (deckId: DeckId, timeSec: number) => {
    setDeck(deckId, (prev) => ({ ...prev, currentTime: timeSec }));
  };

  const clearAutoDjTimers = useCallback(() => {
    audioEngine.setDeckAutoControlled('A', false);
    audioEngine.setDeckAutoControlled('B', false);
    if (autoMixTimerRef.current) {
      window.clearInterval(autoMixTimerRef.current);
      autoMixTimerRef.current = null;
    }
    if (autoDjBeatTimerRef.current) {
      window.clearTimeout(autoDjBeatTimerRef.current);
      autoDjBeatTimerRef.current = null;
    }
    if (autoDjPllTimerRef.current) {
      window.clearTimeout(autoDjPllTimerRef.current);
      autoDjPllTimerRef.current = null;
    }
    if (autoDjGlideTimerRef.current) {
      window.clearInterval(autoDjGlideTimerRef.current);
      autoDjGlideTimerRef.current = null;
    }
  }, []);

  const triggerAutoMixTransition = useCallback(
    async (fromDeckId: DeckId, isManual = false) => {
      if (autoTransitionDeckRef.current === fromDeckId) return;
      const toDeckId: DeckId = fromDeckId === 'A' ? 'B' : 'A';
      const fromDeck = fromDeckId === 'A' ? deckARef.current : deckBRef.current;
      let toDeck = toDeckId === 'A' ? deckARef.current : deckBRef.current;

      const pool = getAutoDjPool(fromDeck.track);
      const outBpmRaw = fromDeck.track?.bpm
        ? fromDeck.track.bpm * (fromDeck.playbackRate ?? 1)
        : fromDeck.track?.name
        ? extractBpmFromTrackName(fromDeck.track.name)
        : null;

      let nextTrackToLoad: TrackItem | null = null;
      const shouldLoadFromPool =
        (!toDeck.track && !toDeck.youtubeId) ||
        (toDeck.source === 'local' && deckConsumedRef.current[toDeckId] && pool.length > 0);

      if (shouldLoadFromPool && pool.length > 0) {
        const pick = pickNextAutoDjCandidate(pool, {
          currentId: fromDeck.track?.id || null,
          outgoingBpm: outBpmRaw,
          playedIds: autoDjPlayedIdsRef.current,
        });
        if (pick) {
          nextTrackToLoad = await resolveAutoDjEntryToTrack(pick.item);
        }
      }

      toDeck = toDeckId === 'A' ? deckARef.current : deckBRef.current;
      let incomingTrack = nextTrackToLoad || toDeck.track;

      if (!incomingTrack && !toDeck.youtubeId) {
        return; // Nothing to transition to
      }

      // Ensure incoming track has analyzed 4-beat compás grid & BPM before beatmatching
      if (incomingTrack && incomingTrack.sourceType === 'file') {
        const inUrl = incomingTrack.videoUrl || incomingTrack.audioUrl || '';
        if (
          inUrl &&
          (!incomingTrack.bpm ||
            incomingTrack.barOffsetSec === undefined ||
            incomingTrack.beatOffsetSec === undefined ||
            incomingTrack.introStartSec === undefined)
        ) {
          const analysis = await audioEngine.analyzeAudioUrl(inUrl);
          if (analysis) {
            incomingTrack = {
              ...incomingTrack,
              bpm: incomingTrack.bpm || analysis.detectedBpm,
              introStartSec: incomingTrack.introStartSec ?? analysis.introStartSec,
              outroStartSec: incomingTrack.outroStartSec ?? analysis.outroStartSec,
              beatOffsetSec: incomingTrack.beatOffsetSec ?? analysis.beatOffsetSec,
              barOffsetSec: incomingTrack.barOffsetSec ?? analysis.barOffsetSec,
              coroStartSec: incomingTrack.coroStartSec ?? analysis.coroStartSec,
              coroMixOutSec: incomingTrack.coroMixOutSec ?? analysis.coroMixOutSec,
              coroDropInSec: incomingTrack.coroDropInSec ?? analysis.coroDropInSec,
            };
          }
        }
      }

      autoTransitionDeckRef.current = fromDeckId;
      deckConsumedRef.current[fromDeckId] = true;
      deckConsumedRef.current[toDeckId] = false;
      if (fromDeck.track?.id) {
        autoDjPlayedIdsRef.current.add(fromDeck.track.id);
      }
      audioEngine.resume();
      clearAutoDjTimers();

      const fromBaseBpm =
        fromDeck.track?.bpm ||
        (fromDeck.track?.name ? extractBpmFromTrackName(fromDeck.track.name) : null) ||
        100;
      const fromStartRate = fromDeck.playbackRate ?? 1;
      const effFromBpm = fromBaseBpm * fromStartRate;

      // Calculate exact BPM beatmatching ratio (key-locked via preservesPitch=true)
      const inBpm =
        incomingTrack?.bpm ??
        (incomingTrack?.name ? extractBpmFromTrackName(incomingTrack.name) : null);
      const sync = computeTempoSync(effFromBpm, inBpm);

      const inIntroCue = incomingTrack?.introStartSec ?? 0;
      const startInAtSec =
        toDeck.currentTime > inIntroCue + 2 && !nextTrackToLoad
          ? toDeck.currentTime
          : inIntroCue;

      setAutoDjPhase('cueing');
      setAutoDjNextInfo((prev) => ({
        ...prev,
        name: incomingTrack?.name || toDeck.youtubeTitle || null,
        bpm: inBpm || null,
        targetRate: sync.ratio,
        syncModeLabel: sync.label,
        mixInSec: 0,
        suggestedMixInSec: startInAtSec,
      }));

      // Cue incoming deck EQ cleanly (Bass cut -22 dB + HPF +0.28) while keeping outgoing track punchy
      const startFromEq = mixerRef.current[fromDeckId];
      setMixer((prev) => ({
        ...prev,
        [fromDeckId]: {
          ...startFromEq,
          volume: Math.max(0.96, startFromEq.volume || 1),
        },
        [toDeckId]: {
          high: -0.5,
          mid: -2.5,
          low: -22,
          filter: 0.28,
          volume: 1.0,
        },
      }));

      // Load/park incoming deck PAUSED at exact Beat-1 cue and await media decode readiness BEFORE crossfading!
      if (incomingTrack && toDeck.source === 'local') {
        let readyTrack = incomingTrack;
        if (nextTrackToLoad) {
          readyTrack = await loadPoolTrackToDeck(
            toDeckId,
            incomingTrack,
            false,
            sync.ratio,
            sync.mode === 'fallback' ? null : sync.targetBpm,
            startInAtSec
          );
        } else {
          setDeck(toDeckId, (prev) => ({
            ...prev,
            track: readyTrack,
            isPlaying: false,
            currentTime: startInAtSec,
            playbackRate: sync.ratio,
            syncedBpm: sync.mode === 'fallback' ? null : sync.targetBpm,
          }));
        }

        const expectedSrc =
          readyTrack.sourceType === 'demo'
            ? getOrCreateDemoTrackUrl(readyTrack)
            : readyTrack.videoUrl || readyTrack.audioUrl || null;

        await audioEngine.waitForDeckReadyAndSeek(
          toDeckId,
          startInAtSec,
          sync.ratio,
          true,
          expectedSrc
        );
      }

      if (autoTransitionDeckRef.current !== fromDeckId) return;

      // Exact unit-safe Compás (4-beat bar) alignment in SOURCE media seconds -> WALL milliseconds
      const fromEl = audioEngine.getDeckMediaElement(fromDeckId);
      const liveFromTime = fromEl ? fromEl.currentTime : fromDeck.currentTime;
      const fromDur = fromDeck.duration || fromDeck.track?.durationSec || 180;
      const fromSrcBeat = 60 / Math.max(55, fromBaseBpm);
      const fromSrcBar = fromSrcBeat * 4;
      const fromBarOff =
        fromDeck.track?.barOffsetSec ??
        fromDeck.track?.beatOffsetSec ??
        fromDeck.track?.introStartSec ??
        0;

      let beatWaitMs = 0;
      if (fromDeck.isPlaying && fromBaseBpm > 40) {
        const remainingSrc = Math.max(0.5, fromDur - liveFromTime);
        if (isManual) {
          // Manual "Mezclar Ya": snap cleanly to the next exact Beat (full beat window, even for slow tempos)
          const beatPhaseSrc =
            (((liveFromTime - fromBarOff) % fromSrcBeat) + fromSrcBeat) % fromSrcBeat;
          const rawBeatWaitSrc = (fromSrcBeat - beatPhaseSrc) % fromSrcBeat;
          const waitSrcSec = rawBeatWaitSrc < 0.03 ? 0 : rawBeatWaitSrc;
          beatWaitMs = Math.round((waitSrcSec / Math.max(0.5, fromStartRate)) * 1000);
        } else {
          // Automatic DJ transition: wait specifically for Beat 1 of the 4-beat compás
          const barPhaseSrc =
            (((liveFromTime - fromBarOff) % fromSrcBar) + fromSrcBar) % fromSrcBar;
          const rawBarWaitSrc = (fromSrcBar - barPhaseSrc) % fromSrcBar;
          let waitSrcSec = rawBarWaitSrc < 0.04 ? 0 : rawBarWaitSrc;
          if (waitSrcSec > remainingSrc * 0.42) {
            // If near song end, align to half-bar (Beat 1 or 3) or next single beat so mix never runs out of audio
            const halfBarSrc = fromSrcBeat * 2;
            const halfPhase =
              (((liveFromTime - fromBarOff) % halfBarSrc) + halfBarSrc) % halfBarSrc;
            const halfWait = (halfBarSrc - halfPhase) % halfBarSrc;
            waitSrcSec =
              halfWait <= remainingSrc * 0.35
                ? halfWait < 0.03
                  ? 0
                  : halfWait
                : (((fromSrcBeat -
                    ((((liveFromTime - fromBarOff) % fromSrcBeat) + fromSrcBeat) %
                      fromSrcBeat)) %
                    fromSrcBeat) < 0.03
                    ? 0
                    : (fromSrcBeat -
                        ((((liveFromTime - fromBarOff) % fromSrcBeat) + fromSrcBeat) %
                          fromSrcBeat)) %
                      fromSrcBeat);
          }
          beatWaitMs = Math.round((waitSrcSec / Math.max(0.5, fromStartRate)) * 1000);
        }
      }

      const startBlendLoop = async () => {
        if (autoTransitionDeckRef.current !== fromDeckId) return;

        audioEngine.setDeckAutoControlled(fromDeckId, true);
        audioEngine.setDeckAutoControlled(toDeckId, true);

        // Start incoming deck playback immediately synced with Beat-1 playbackRate
        setDeck(toDeckId, (prev) => ({
          ...prev,
          isPlaying: true,
          currentTime: startInAtSec,
          playbackRate: sync.ratio,
          syncedBpm: sync.mode === 'fallback' ? null : sync.targetBpm,
        }));

        await audioEngine.playDeckMediaSynced(toDeckId, sync.ratio, true);

        const activeFromEl = audioEngine.getDeckMediaElement(fromDeckId);
        const activeToEl = audioEngine.getDeckMediaElement(toDeckId);
        const toBaseBpm = inBpm && inBpm > 40 ? inBpm : fromBaseBpm;
        const toSrcBeat = 60 / Math.max(55, toBaseBpm);
        const toBarOff =
          incomingTrack?.barOffsetSec ??
          incomingTrack?.beatOffsetSec ??
          incomingTrack?.introStartSec ??
          startInAtSec;

        // Coupled Master-Tempo Bridge: ride both decks TOGETHER from outgoing BPM -> incoming BPM
        const startEffBpm = effFromBpm;
        const endEffBpm = sync.compatible ? sync.effectiveIncomingBpm : effFromBpm;
        const avgMixBpm = 0.5 * (startEffBpm + endEffBpm);
        const meanBarMs = (240 / Math.max(55, avgMixBpm)) * 1000;

        let hardNudgeActive = false;
        let pllTrim = 1;

        // Stage-1 Active PLL Snap (~95ms after play starts) to kill HTMLMediaElement startup latency
        if (activeFromEl && activeToEl && fromBaseBpm > 40 && toBaseBpm > 40) {
          autoDjPllTimerRef.current = window.setTimeout(() => {
            if (autoTransitionDeckRef.current !== fromDeckId) return;
            const pFrom =
              ((((activeFromEl.currentTime - fromBarOff) / fromSrcBeat) % 1) + 1) % 1;
            const pTo = ((((activeToEl.currentTime - toBarOff) / toSrcBeat) % 1) + 1) % 1;
            let errBeats = pFrom - pTo;
            if (errBeats > 0.5) errBeats -= 1;
            if (errBeats < -0.5) errBeats += 1;

            if (Math.abs(errBeats) > 0.025) {
              hardNudgeActive = true;
              const corrDurSec = 0.18;
              const errWallSec = errBeats * (60 / Math.max(55, startEffBpm));
              const nudgeFactor = Math.max(0.93, Math.min(1.07, 1 + errWallSec / corrDurSec));
              audioEngine.setDeckPlaybackRate(toDeckId, sync.ratio * nudgeFactor, true);
              window.setTimeout(() => {
                hardNudgeActive = false;
              }, Math.round(corrDurSec * 1000));
            }
          }, 95);
        }

        showToast(`Auto DJ: ${sync.label} · Compás bloqueado → Deck ${toDeckId}`);

        const targetSide = toDeckId === 'B' ? 1 : -1;
        const startXf = mixerRef.current.crossfader;
        const latestFromTime = activeFromEl ? activeFromEl.currentTime : fromDeck.currentTime;
        const remainingFromSrc = Math.max(2.5, fromDur - latestFromTime);
        const remainingWallMs = (remainingFromSrc / Math.max(0.5, fromStartRate)) * 1000;

        // Quantize transition duration strictly to an integer number of 4-beat compases (4, 2, or 1 bar)
        const maxBudgetMs = remainingWallMs * 0.88;
        const targetBars =
          fromDur < 45
            ? maxBudgetMs >= 2 * meanBarMs
              ? 2
              : 1
            : maxBudgetMs >= 4 * meanBarMs
            ? 4
            : maxBudgetMs >= 2 * meanBarMs
            ? 2
            : 1;
        const targetMixMs = Math.max(1800, Math.round(targetBars * meanBarMs));
        const tickMs = 40;
        const totalSteps = Math.max(30, Math.round(targetMixMs / tickMs));
        let step = 0;

        setAutoDjPhase('blending');

        autoMixTimerRef.current = window.setInterval(() => {
          step++;
          const t = Math.min(1, step / totalSteps);
          // Equal-energy smooth S-curve crossfader that dwells cleanly in the dual-deck blend zone
          const smoothT = t * t * (3 - 2 * t);
          const xf = startXf + (targetSide - startXf) * smoothT;

          // Coupled Master-Tempo Bridge (t = 0.20..0.82): both tracks glide TOGETHER to Song B's BPM!
          let tempoRamp = 0;
          if (t >= 0.82) {
            tempoRamp = 1;
          } else if (t > 0.2) {
            const tr = (t - 0.2) / 0.62;
            tempoRamp = tr * tr * (3 - 2 * tr);
          }
          const masterBpm = startEffBpm + (endEffBpm - startEffBpm) * tempoRamp;
          const baseFromRate = (masterBpm / Math.max(40, startEffBpm)) * fromStartRate;
          const baseToRate = sync.compatible
            ? masterBpm / Math.max(40, sync.effectiveIncomingBpm)
            : sync.ratio;

          // Stage-2 Continuous Micro-PLL Phase Tracker during the active mix (prevents WSOLA drift!)
          if (
            !hardNudgeActive &&
            t < 0.85 &&
            activeFromEl &&
            activeToEl &&
            !activeFromEl.paused &&
            !activeToEl.paused &&
            fromBaseBpm > 40 &&
            toBaseBpm > 40
          ) {
            const pFrom =
              ((((activeFromEl.currentTime - fromBarOff) / fromSrcBeat) % 1) + 1) % 1;
            const pTo = ((((activeToEl.currentTime - toBarOff) / toSrcBeat) % 1) + 1) % 1;
            let errBeats = pFrom - pTo;
            if (errBeats > 0.5) errBeats -= 1;
            if (errBeats < -0.5) errBeats += 1;

            const desiredTrim =
              Math.abs(errBeats) > 0.018
                ? Math.max(0.975, Math.min(1.025, 1 + errBeats * 0.38))
                : 1;
            pllTrim = pllTrim * 0.72 + desiredTrim * 0.28;
          } else if (t >= 0.85) {
            pllTrim = pllTrim * 0.6 + 0.4;
          }

          if (!hardNudgeActive) {
            audioEngine.setDeckPlaybackRate(fromDeckId, baseFromRate, true);
            audioEngine.setDeckPlaybackRate(toDeckId, baseToRate * pllTrim, true);
          }

          if (step % 6 === 0) {
            setDeck(toDeckId, (prev) => ({
              ...prev,
              playbackRate: Number(baseToRate.toFixed(4)),
              syncedBpm:
                Math.abs(baseToRate - 1) <= 0.004
                  ? null
                  : Math.round(masterBpm * 10) / 10,
            }));
          }

          let outLow = startFromEq.low;
          let outMid = startFromEq.mid;
          let outFilter = startFromEq.filter;
          let inLow = -22;
          let inMid = -2.5;
          let inHigh = -0.5;
          let inFilter = 0.28;

          if (t < 0.36) {
            setAutoDjPhase('blending');
            const p1 = t / 0.36;
            inLow = Number((-22 + 7 * p1).toFixed(1));
            inMid = Number((-2.5 + 1.3 * p1).toFixed(1));
            inHigh = Number((-0.5 + 0.5 * p1).toFixed(1));
            inFilter = Number((0.28 - 0.18 * p1).toFixed(2));
            outMid = Number((0 - 1.0 * p1).toFixed(1));
          } else if (t <= 0.66) {
            // Centered right at t = 0.50 -> exact Beat 1 of Bar 3 (4-bar mix) or Bar 2 (2-bar mix)!
            setAutoDjPhase('bass-swap');
            const s = (t - 0.36) / 0.3;
            const smoothS = s * s * (3 - 2 * s);
            inLow = Number((-15 + 15 * smoothS).toFixed(1));
            outLow = Number((0 - 22 * smoothS).toFixed(1));
            inMid = Number((-1.2 + 1.2 * smoothS).toFixed(1));
            inHigh = 0;
            outMid = Number((-1.0 - 2.8 * smoothS).toFixed(1));
            inFilter = Number((0.1 * (1 - smoothS)).toFixed(2));
          } else {
            setAutoDjPhase('gliding');
            const sExit = (t - 0.66) / 0.34;
            inLow = 0;
            inMid = 0;
            inHigh = 0;
            inFilter = 0;
            outLow = -22;
            outMid = Number((-3.8 - 5.7 * sExit).toFixed(1));
            outFilter = Number((0.48 * sExit).toFixed(2));
          }

          setMixer((prev) => ({
            ...prev,
            crossfader: Number(xf.toFixed(3)),
            [fromDeckId]: {
              ...prev[fromDeckId],
              low: outLow,
              mid: outMid,
              filter: outFilter,
            },
            [toDeckId]: {
              ...prev[toDeckId],
              high: inHigh,
              mid: inMid,
              low: inLow,
              filter: inFilter,
              volume: 1.0,
            },
          }));

          if (step >= totalSteps) {
            if (autoMixTimerRef.current) {
              window.clearInterval(autoMixTimerRef.current);
              autoMixTimerRef.current = null;
            }

            // Stop outgoing track & restore clean neutral EQ on both channels
            audioEngine.setDeckAutoControlled(fromDeckId, false);
            setDeck(fromDeckId, (prev) => ({
              ...prev,
              isPlaying: false,
              currentTime: 0,
              playbackRate: 1,
              syncedBpm: null,
            }));
            audioEngine.setDeckPlaybackRate(fromDeckId, 1, true);

            setMixer((prev) => ({
              ...prev,
              crossfader: targetSide,
              [fromDeckId]: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
              [toDeckId]: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
            }));

            autoTransitionDeckRef.current = null;

            // Incoming track has ALREADY smoothly arrived at its natural BPM (1.0000) via the coupled bridge!
            if (Math.abs(baseToRate - 1) > 0.005) {
              let gStep = 0;
              const gSteps = 24;
              autoDjGlideTimerRef.current = window.setInterval(() => {
                gStep++;
                const gt = gStep / gSteps;
                const nextRate = baseToRate + (1 - baseToRate) * gt;
                audioEngine.setDeckPlaybackRate(toDeckId, nextRate, true);
                setDeck(toDeckId, (prev) => ({
                  ...prev,
                  playbackRate: Number(nextRate.toFixed(4)),
                  syncedBpm:
                    gt >= 1 || !prev.track?.bpm
                      ? null
                      : Math.round(prev.track.bpm * nextRate * 10) / 10,
                }));
                if (gStep >= gSteps) {
                  if (autoDjGlideTimerRef.current) {
                    window.clearInterval(autoDjGlideTimerRef.current);
                    autoDjGlideTimerRef.current = null;
                  }
                  audioEngine.setDeckAutoControlled(toDeckId, false);
                  setAutoDjPhase(mixerRef.current.autoMixEnabled ? 'standby' : 'idle');
                }
              }, 70);
            } else {
              audioEngine.setDeckAutoControlled(toDeckId, false);
              setDeck(toDeckId, (prev) => ({
                ...prev,
                playbackRate: 1,
                syncedBpm: null,
              }));
              audioEngine.setDeckPlaybackRate(toDeckId, 1, true);
              setAutoDjPhase(mixerRef.current.autoMixEnabled ? 'standby' : 'idle');
            }

            // Pre-load & analyze next compatible track from the designated folder onto idle deck
            if (mixerRef.current.autoMixEnabled && incomingTrack) {
              const steadyBpm =
                incomingTrack.bpm ??
                (incomingTrack.name ? extractBpmFromTrackName(incomingTrack.name) : null);
              ensureOppositeDeckQueued(toDeckId, incomingTrack, true, undefined, steadyBpm);
            }
          }
        }, tickMs);
      };

      if (beatWaitMs > 12) {
        autoDjBeatTimerRef.current = window.setTimeout(() => {
          startBlendLoop();
        }, beatWaitMs);
      } else {
        await startBlendLoop();
      }
    },
    [
      clearAutoDjTimers,
      ensureOppositeDeckQueued,
      getAutoDjPool,
      loadPoolTrackToDeck,
      resolveAutoDjEntryToTrack,
      showToast,
    ]
  );

  const handleTimeUpdate = (deckId: DeckId, currentTime: number, duration: number) => {
    setDeck(deckId, (prev) => ({
      ...prev,
      currentTime,
      duration: duration > 0 ? duration : prev.duration,
    }));

    const activeDeck = deckId === 'A' ? deckARef.current : deckBRef.current;
    if (!mixerRef.current.autoMixEnabled || !activeDeck.isPlaying || duration <= 5) {
      return;
    }

    const rate = activeDeck.playbackRate ?? 1;
    const realRemaining = (duration - currentTime) / Math.max(0.5, rate);
    const triggerAtSec = computeTrackMixOutSec(
      activeDeck.track,
      duration,
      autoDjMixStyleRef.current
    );

    // Keep live countdown & suggested mix cue synced
    const mixInSec = Math.max(0, Math.round((triggerAtSec - currentTime) / Math.max(0.5, rate)));
    if (autoTransitionDeckRef.current === null) {
      setAutoDjNextInfo((prev) =>
        prev.mixInSec === mixInSec && prev.suggestedMixOutSec === triggerAtSec
          ? prev
          : { ...prev, mixInSec, suggestedMixOutSec: triggerAtSec }
      );
    }

    // Proactively ensure opposite deck is pre-loaded & analyzed before mix point
    if (realRemaining <= 28 && autoTransitionDeckRef.current !== deckId) {
      ensureOppositeDeckQueued(deckId, activeDeck.track, false);
    }

    // Anticipate ~1.5 beats before Beat-1 of the Coro/Outro compás so media preparation finishes cleanly ON the downbeat
    const baseBpm = activeDeck.track?.bpm || 100;
    const beatSrcSec = 60 / Math.max(55, baseBpm);
    const prepareAtSec = Math.max(2.5, triggerAtSec - Math.min(1.35, beatSrcSec * 1.6));

    if (
      currentTime >= prepareAtSec &&
      autoTransitionDeckRef.current !== deckId &&
      autoTransitionDeckRef.current === null
    ) {
      triggerAutoMixTransition(deckId, false);
    }
  };

  const handleEnded = (deckId: DeckId) => {
    setDeck(deckId, (prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    if (mixerRef.current.autoMixEnabled && autoTransitionDeckRef.current !== deckId) {
      triggerAutoMixTransition(deckId, false);
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
    const targetDeck = deckId === 'A' ? deckARef.current : deckBRef.current;
    if (stemMode !== 'full' && (targetDeck.source !== 'local' || !targetDeck.track)) {
      showToast('Carga una canción local (MP3/MP4) para quitar la voz en tiempo real');
      return;
    }
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
    if (stemMode === 'instrumental') {
      showToast(`Deck ${deckId}: Voz removida — Modo Pista activo`);
    } else if (stemMode === 'full') {
      showToast(`Deck ${deckId}: Audio original restaurado`);
    } else {
      showToast(`Separación IA aplicada en Deck ${deckId}: ${stemMode}`);
    }
  };

  // Mixer & Auto DJ Session
  const handleChangeChannel = (deckId: DeckId, patch: Partial<ChannelEqState>) => {
    audioEngine.resume();
    setMixer((prev) => ({
      ...prev,
      [deckId]: { ...prev[deckId], ...patch },
    }));
  };

  const startOrEnableAutoDj = useCallback(
    async (explicitSource?: {
      sourceType: AutoDjSourceType;
      playlistId?: string | null;
      driveFolderId?: string | null;
      label: string;
    }) => {
      audioEngine.resume();
      const dA = deckARef.current;
      const dB = deckBRef.current;

      const isDriveContext =
        !explicitSource &&
        driveFilesRef.current.length > 0 &&
        (libraryTabRef.current === 'drive' ||
          dA.track?.id.startsWith('drive-') ||
          dB.track?.id.startsWith('drive-'));

      const chosenSource = explicitSource
        ? {
            sourceType: explicitSource.sourceType,
            playlistId: explicitSource.playlistId ?? null,
            driveFolderId: explicitSource.driveFolderId ?? null,
            label: explicitSource.label,
          }
        : isDriveContext
        ? {
            sourceType: 'drive' as const,
            playlistId: null,
            driveFolderId: driveSelectedFolderIdRef.current ?? null,
            label:
              driveSelectedFolderIdRef.current
                ? driveFoldersRef.current.find((f) => f.id === driveSelectedFolderIdRef.current)
                    ?.name || 'Carpeta Drive'
                : 'Google Drive',
          }
        : selectedPlaylistIdRef.current
        ? {
            sourceType: 'playlist' as const,
            playlistId: selectedPlaylistIdRef.current,
            driveFolderId: null,
            label:
              playlistsRef.current.find((p) => p.id === selectedPlaylistIdRef.current)?.name ||
              'Carpeta',
          }
        : {
            sourceType: 'all-local' as const,
            playlistId: null,
            driveFolderId: null,
            label: 'Todas las pistas',
          };

      setAutoDjSource(chosenSource);
      autoDjSourceRef.current = chosenSource;
      autoDjPlayedIdsRef.current.clear();
      setAutoDjPhase('standby');

      const bothEmpty = !dA.track && !dA.youtubeId && !dB.track && !dB.youtubeId;
      const pool = getAutoDjPool(dA.track || dB.track, chosenSource);

      if (pool.length === 0 && bothEmpty) {
        showToast(`No hay canciones en "${chosenSource.label}" para iniciar Auto DJ`);
        return;
      }

      setMixer((prev) => ({
        ...prev,
        autoMixEnabled: true,
        ...(bothEmpty || explicitSource
          ? { crossfader: dB.isPlaying && !dA.isPlaying ? 1 : -1 }
          : !dA.isPlaying && !dB.isPlaying && dB.track && !dA.track
          ? { crossfader: 1 }
          : !dA.isPlaying && !dB.isPlaying && dA.track
          ? { crossfader: -1 }
          : {}),
      }));

      if (explicitSource && !dA.isPlaying && !dB.isPlaying && pool.length > 0) {
        // Fresh folder DJ session: load track 1 into Deck A, start playing, pre-queue best BPM match into Deck B
        const firstEntry = pool[0];
        const firstTrack = await resolveAutoDjEntryToTrack(firstEntry);
        if (firstTrack) {
          autoDjPlayedIdsRef.current.add(firstTrack.id);
          setMixer((prev) => ({
            ...prev,
            crossfader: -1,
            A: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
          }));
          await loadPoolTrackToDeck('A', firstTrack, true, 1, null);
          await ensureOppositeDeckQueued('A', firstTrack, true, chosenSource);
          showToast(`Auto DJ iniciado en "${chosenSource.label}": adaptando BPM y mezclas en coro`);
          return;
        }
      }

      if (dA.isPlaying && dA.source === 'local') {
        if (dA.track?.id) autoDjPlayedIdsRef.current.add(dA.track.id);
        if (dB.track && !deckConsumedRef.current.B) {
          const outBpm = dA.track?.bpm ?? (dA.track?.name ? extractBpmFromTrackName(dA.track.name) : null);
          const inBpm = dB.track.bpm ?? extractBpmFromTrackName(dB.track.name);
          const sync = computeTempoSync(outBpm, inBpm);
          setAutoDjNextInfo((prev) => ({
            ...prev,
            name: dB.track?.name || null,
            bpm: inBpm || null,
            targetRate: sync.ratio,
            syncModeLabel: sync.label,
            suggestedMixInSec: dB.track?.introStartSec ?? 0,
          }));
        } else {
          await ensureOppositeDeckQueued('A', dA.track, Boolean(explicitSource), chosenSource);
        }
      } else if (dB.isPlaying && dB.source === 'local') {
        if (dB.track?.id) autoDjPlayedIdsRef.current.add(dB.track.id);
        if (dA.track && !deckConsumedRef.current.A) {
          const outBpm = dB.track?.bpm ?? (dB.track?.name ? extractBpmFromTrackName(dB.track.name) : null);
          const inBpm = dA.track.bpm ?? extractBpmFromTrackName(dA.track.name);
          const sync = computeTempoSync(outBpm, inBpm);
          setAutoDjNextInfo((prev) => ({
            ...prev,
            name: dA.track?.name || null,
            bpm: inBpm || null,
            targetRate: sync.ratio,
            syncModeLabel: sync.label,
            suggestedMixInSec: dA.track?.introStartSec ?? 0,
          }));
        } else {
          await ensureOppositeDeckQueued('B', dB.track, Boolean(explicitSource), chosenSource);
        }
      } else if (dA.track && dA.source === 'local') {
        // Deck A is loaded & paused: start playing Deck A cleanly and prepare Deck B!
        if (dA.track.id) autoDjPlayedIdsRef.current.add(dA.track.id);
        setDeck('A', (prev) => ({ ...prev, isPlaying: true }));
        if (dB.track && !deckConsumedRef.current.B) {
          const outBpm = dA.track.bpm ?? extractBpmFromTrackName(dA.track.name);
          const inBpm = dB.track.bpm ?? extractBpmFromTrackName(dB.track.name);
          const sync = computeTempoSync(outBpm, inBpm);
          setAutoDjNextInfo((prev) => ({
            ...prev,
            name: dB.track?.name || null,
            bpm: inBpm || null,
            targetRate: sync.ratio,
            syncModeLabel: sync.label,
            suggestedMixInSec: dB.track?.introStartSec ?? 0,
          }));
        } else {
          await ensureOppositeDeckQueued('A', dA.track, Boolean(explicitSource), chosenSource);
        }
      } else if (dB.track && dB.source === 'local') {
        if (dB.track.id) autoDjPlayedIdsRef.current.add(dB.track.id);
        setDeck('B', (prev) => ({ ...prev, isPlaying: true }));
        await ensureOppositeDeckQueued('B', dB.track, Boolean(explicitSource), chosenSource);
      } else if (bothEmpty && pool.length > 0) {
        const firstTrack = await resolveAutoDjEntryToTrack(pool[0]);
        if (firstTrack) {
          autoDjPlayedIdsRef.current.add(firstTrack.id);
          await loadPoolTrackToDeck('A', firstTrack, true, 1, null);
          await ensureOppositeDeckQueued('A', firstTrack, true, chosenSource);
        }
      }

      showToast(`Auto DJ ON (${chosenSource.label}): beatmatch y mezcla en coro activos`);
    },
    [
      ensureOppositeDeckQueued,
      getAutoDjPool,
      loadPoolTrackToDeck,
      resolveAutoDjEntryToTrack,
      showToast,
    ]
  );

  const stopAutoDj = useCallback(() => {
    clearAutoDjTimers();
    autoTransitionDeckRef.current = null;
    autoDjPreloadKeyRef.current = null;
    setAutoDjPhase('idle');
    setAutoDjNextInfo({
      name: null,
      bpm: null,
      targetRate: null,
      syncModeLabel: null,
      mixInSec: null,
      suggestedMixOutSec: null,
      suggestedMixInSec: null,
    });
    setMixer((prev) => ({
      ...prev,
      autoMixEnabled: false,
    }));
    showToast('Auto DJ detenido');
  }, [clearAutoDjTimers, showToast]);

  const handleToggleAutoMix = () => {
    if (mixerRef.current.autoMixEnabled) {
      stopAutoDj();
    } else {
      startOrEnableAutoDj();
    }
  };

  const handleToggleAutoDjMixStyle = useCallback(() => {
    setAutoDjMixStyle((prev) => {
      const next = prev === 'coro' ? 'outro' : 'coro';
      showToast(
        next === 'coro'
          ? 'Auto DJ: mezclará en el Coro / frase sugerida'
          : 'Auto DJ: mezclará al Final de cada canción'
      );
      return next;
    });
  }, [showToast]);

  const handleSkipAutoDjNext = () => {
    const dA = deckARef.current;
    const dB = deckBRef.current;
    const activeDeckId: DeckId =
      dA.isPlaying && !dB.isPlaying
        ? 'A'
        : dB.isPlaying && !dA.isPlaying
        ? 'B'
        : mixerRef.current.crossfader <= 0
        ? 'A'
        : 'B';
    const activeDeck = activeDeckId === 'A' ? dA : dB;
    const otherDeckId: DeckId = activeDeckId === 'A' ? 'B' : 'A';
    const otherDeck = otherDeckId === 'A' ? dA : dB;
    if (otherDeck.track?.id) {
      autoDjPlayedIdsRef.current.add(otherDeck.track.id);
    }
    ensureOppositeDeckQueued(activeDeckId, activeDeck.track, true);
    showToast('Buscando otra pista compatible en la carpeta...');
  };

  const handleManualCrossfadeNow = () => {
    const dA = deckARef.current;
    const dB = deckBRef.current;
    const fromDeckId: DeckId =
      dA.isPlaying && !dB.isPlaying
        ? 'A'
        : dB.isPlaying && !dA.isPlaying
        ? 'B'
        : mixerRef.current.crossfader <= 0 && (dA.track || dA.youtubeId)
        ? 'A'
        : 'B';
    triggerAutoMixTransition(fromDeckId, true);
  };

  // File, Folder & .djlurivera Import (batched IndexedDB + parallel metadata)
  const handleImportFiles = async (fileList: FileList) => {
    const files = Array.from(fileList).sort((a, b) => {
      const pathA = ((a as any).webkitRelativePath as string) || a.name;
      const pathB = ((b as any).webkitRelativePath as string) || b.name;
      return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
    });
    const createdPlaylists: Playlist[] = [];
    const playlistMap = new Map(playlists.map((p) => [p.name.toLowerCase(), p.id]));
    const mediaToPrepare: Array<{
      file: File;
      trackId: string;
      isVideo: boolean;
      targetPlaylistIds: string[];
    }> = [];

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

      const isAudioExt = /\.(mp3|wav|ogg|oga|m4a|m4b|aac|flac|opus|wma|aiff|aif|alac|mp2|amr|ac3|dts|ape|wv|caf)$/i.test(file.name);
      const isVideoExt = /\.(mp4|webm|mkv|mov|avi|m4v|flv|3gp)$/i.test(file.name);
      if (
        !file.type.startsWith('audio/') &&
        !file.type.startsWith('video/') &&
        !isAudioExt &&
        !isVideoExt
      ) {
        continue;
      }

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
      const isVideo = file.type.startsWith('video/') || isVideoExt;
      mediaToPrepare.push({ file, trackId, isVideo, targetPlaylistIds });
    }

    const activeImportedPlaylistId =
      createdPlaylists[0]?.id || mediaToPrepare[0]?.targetPlaylistIds?.[0] || null;

    if (createdPlaylists.length > 0) {
      setPlaylists((prev) => [...prev, ...createdPlaylists]);
      setSelectedPlaylistId(createdPlaylists[0].id);
      selectedPlaylistIdRef.current = createdPlaylists[0].id;
    }

    if (mediaToPrepare.length > 0) {
      // Batch-save all blobs in ONE IndexedDB transaction
      saveMediaBlobsBatch(
        mediaToPrepare.map((m) => ({ key: `track:${m.trackId}`, blob: m.file }))
      );

      // Extract metadata durations concurrently
      const addedTracks: TrackItem[] = await Promise.all(
        mediaToPrepare.map(async ({ file, trackId, isVideo, targetPlaylistIds }) => {
          const objectUrl = URL.createObjectURL(file);
          const durationSec = await new Promise<number>((resolve) => {
            const el = document.createElement(isVideo ? 'video' : 'audio');
            el.preload = 'metadata';
            const fallbackTimer = window.setTimeout(() => resolve(180), 1500);
            el.onloadedmetadata = () => {
              window.clearTimeout(fallbackTimer);
              resolve(el.duration || 180);
            };
            el.onerror = () => {
              window.clearTimeout(fallbackTimer);
              resolve(180);
            };
            el.src = objectUrl;
          });
          return {
            id: trackId,
            name: file.name,
            bpm: extractBpmFromTrackName(file.name) ?? undefined,
            durationSec,
            sourceType: 'file',
            audioUrl: isVideo ? undefined : objectUrl,
            videoUrl: isVideo ? objectUrl : undefined,
            isVideo,
            playlistIds: targetPlaylistIds,
            hasAiLyrics: false,
          };
        })
      );

      const nextTracks = [...addedTracks, ...tracksRef.current];
      tracksRef.current = nextTracks;
      setTracks(nextTracks);

      // If Auto DJ is active when uploading a folder/tracks, auto-start & queue Deck A / B by BPM
      if (mixerRef.current.autoMixEnabled && addedTracks.length > 0) {
        const uploadedFolderLabel =
          createdPlaylists[0]?.name ||
          playlistsRef.current.find((p) => p.id === activeImportedPlaylistId)?.name ||
          'Todas las pistas';
        const nextSrc = activeImportedPlaylistId
          ? {
              sourceType: 'playlist' as const,
              playlistId: activeImportedPlaylistId,
              driveFolderId: null,
              label: uploadedFolderLabel,
            }
          : autoDjSourceRef.current;
        if (activeImportedPlaylistId) {
          setAutoDjSource(nextSrc);
          autoDjSourceRef.current = nextSrc;
          autoDjPlayedIdsRef.current.clear();
        }

        const dA = deckARef.current;
        const dB = deckBRef.current;

        if (!dA.isPlaying && !dB.isPlaying) {
          audioEngine.resume();
          setMixer((prev) => ({
            ...prev,
            crossfader: -1,
            A: { high: 0, mid: 0, low: 0, filter: 0, volume: 1.0 },
          }));
          const firstAnalyzed =
            (await resolveAutoDjEntryToTrack({
              kind: 'local',
              id: addedTracks[0].id,
              name: addedTracks[0].name,
              bpm: addedTracks[0].bpm ?? null,
              track: addedTracks[0],
            })) || addedTracks[0];
          autoDjPlayedIdsRef.current.add(firstAnalyzed.id);
          await loadPoolTrackToDeck('A', firstAnalyzed, true, 1, null);
          if (addedTracks.length > 1) {
            await ensureOppositeDeckQueued('A', firstAnalyzed, true, nextSrc);
            showToast(
              `Auto DJ activo: "${firstAnalyzed.name}" en Deck A y siguiente por BPM en Deck B`
            );
          } else {
            showToast(`Auto DJ activo: reproduciendo "${firstAnalyzed.name}" en Deck A`);
          }
        } else if (dA.isPlaying && !dB.isPlaying) {
          await ensureOppositeDeckQueued('A', dA.track, true, nextSrc);
          showToast(
            `Carpeta lista: tema compatible en Deck B para Auto DJ`
          );
        } else if (dB.isPlaying && !dA.isPlaying) {
          await ensureOppositeDeckQueued('B', dB.track, true, nextSrc);
          showToast(
            `Carpeta lista: tema compatible en Deck A para Auto DJ`
          );
        } else {
          showToast(`${addedTracks.length} pista(s) guardada(s) en la carpeta`);
        }
      } else if (activeImportedPlaylistId && createdPlaylists.length > 0) {
        showToast(
          `Carpeta "${createdPlaylists[0].name}" cargada (${addedTracks.length} pistas)`
        );
      } else {
        showToast(`${addedTracks.length} pista(s) guardada(s) localmente`);
      }
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

  // YouTube Karaoke Search (with direct link parsing + client-side mirror fallback)
  const handleSearchYoutube = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setYtLoading(true);
    setYtError(null);

    // 1. Instant direct YouTube link / ID detection in browser
    const urlMatch = trimmed.match(
      /(?:(?:music\.|m\.|www\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    const idMatch = trimmed.match(/^[A-Za-z0-9_-]{11}$/);
    const directId = urlMatch?.[1] || idMatch?.[0];
    if (directId) {
      setYtResults([
        {
          videoId: directId,
          title: `YouTube Video (${directId})`,
          channel: 'Enlace directo',
          duration: 'HD',
          thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
          views: 'Directo',
        },
      ]);
      setYtLoading(false);
      return;
    }

    try {
      // 2. Try fast parallel race: local/Vercel /api/youtube/search AND live CORS Piped mirror
      const fetchJsonWithTimeout = async (url: string, ms: number) => {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), ms);
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          const ct = r.headers.get('content-type') || '';
          if (!r.ok || !ct.includes('application/json')) {
            throw new Error('Bad response');
          }
          return await r.json();
        } finally {
          window.clearTimeout(t);
        }
      };

      const fmtSec = (sec?: number) => {
        if (!sec || !Number.isFinite(sec) || sec <= 0) return 'HD';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
      };

      const backendTask = fetchJsonWithTimeout(
        `/api/youtube/search?q=${encodeURIComponent(trimmed)}`,
        4000
      ).then((data) => {
        if (!Array.isArray(data?.items) || data.items.length === 0) {
          throw new Error('No backend items');
        }
        return data.items as YouTubeSearchResult[];
      });

      const fetchPipedMirror = (baseUrl: string) =>
        fetchJsonWithTimeout(
          `${baseUrl}/search?q=${encodeURIComponent(trimmed)}&filter=videos`,
          5000
        ).then((d) => {
          const items = (Array.isArray(d?.items) ? d.items : [])
            .map((it: any) => {
              const m = String(it?.url || '').match(/v=([A-Za-z0-9_-]{11})/);
              if (!m?.[1]) return null;
              return {
                videoId: m[1],
                title: it.title || 'YouTube Video',
                channel: it.uploaderName || 'YouTube',
                duration: fmtSec(it.duration),
                thumbnail: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`,
                views: it.views ? `${Number(it.views).toLocaleString()} vistas` : '',
              };
            })
            .filter(Boolean) as YouTubeSearchResult[];
          if (items.length === 0) throw new Error('No piped items');
          return items.slice(0, 16);
        });

      const fastestItems = await Promise.any([
        backendTask,
        fetchPipedMirror('https://api.piped.private.coffee'),
        fetchPipedMirror('https://pipedapi.ducks.party'),
      ]);
      setYtResults(fastestItems);
    } catch {
      setYtError(
        'No se pudieron obtener resultados en este momento. Intenta de nuevo o pega la URL del video.'
      );
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
      isPlaying: false,
    }));
    setMobileActiveDeck(deckId);
    showToast(`YouTube listo en Deck ${deckId}: ${video.title} (pulsa Play)`);
  };

  // Google Drive Music Library Handlers
  const loadDriveLibrary = useCallback(
    async (
      tokenOverride?: string,
      query = '',
      folderId: string | null = null,
      refreshFolders = false
    ) => {
      const token = tokenOverride || getDriveAccessToken();
      if (!token) {
        setNeedsDriveAuth(true);
        return;
      }

      const reqId = ++driveReqSeqRef.current;
      setDriveLoading(true);
      setDriveError(null);
      setDriveQuery(query);

      try {
        const shouldFetchFolders = refreshFolders || driveFoldersRef.current.length === 0;
        const folderIds = folderId
          ? getDescendantFolderIds(folderId, driveFoldersRef.current)
          : undefined;
        const [musicRes, foldersRes] = await Promise.all([
          listDriveMusicFiles(token, { query, folderId, folderIds }),
          shouldFetchFolders ? listDriveFolders(token) : Promise.resolve(null),
        ]);
        if (reqId !== driveReqSeqRef.current) return;
        setDriveFiles(musicRes.files);
        setDriveNextPageToken(musicRes.nextPageToken);
        if (foldersRes) {
          setDriveFolders(foldersRes);
        }
        setDriveHasLoaded(true);
        setNeedsDriveAuth(false);
      } catch (err: any) {
        if (reqId !== driveReqSeqRef.current) return;
        if (err instanceof DriveAuthError) {
          clearDriveAccessToken();
          setNeedsDriveAuth(true);
          setDriveHasLoaded(false);
          setDriveError(err.message);
        } else {
          setDriveError(err?.message || 'No se pudo cargar tu música de Google Drive.');
        }
      } finally {
        if (reqId === driveReqSeqRef.current) {
          setDriveLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (
      libraryTab === 'drive' &&
      !needsDriveAuth &&
      !driveHasLoaded &&
      !driveLoading &&
      !driveError
    ) {
      const token = getDriveAccessToken();
      if (token) {
        loadDriveLibrary(token, driveQuery, driveSelectedFolderId, true);
      }
    }
  }, [
    libraryTab,
    needsDriveAuth,
    driveHasLoaded,
    driveLoading,
    driveError,
    driveQuery,
    driveSelectedFolderId,
    loadDriveLibrary,
  ]);

  const handleConnectDrive = async () => {
    if (driveConnecting) return;
    setDriveConnecting(true);
    setDriveError(null);
    setDriveHasLoaded(false);
    try {
      const { user, accessToken, email } = await signInGoogleForDrive({
        allowRedirectFallback: true,
      });
      const accountEmail = email || user?.email || null;
      setDriveAccountEmail(accountEmail);
      setNeedsDriveAuth(false);
      setDriveSelectedFolderId(null);
      await loadDriveLibrary(accessToken, '', null, true);
      showToast(`Google Drive conectado (${accountEmail || 'Google'})`);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/redirect-started') {
        return;
      }
      let msg = err?.message || 'No se pudo conectar con Google Drive.';
      if (code === 'auth/popup-closed-by-user') {
        msg = 'Cerraste la ventana de Google antes de conectar tu Drive.';
      } else if (code === 'auth/cancelled-popup-request') {
        msg = 'Ya hay una ventana de Google abierta. Completa el acceso o intenta de nuevo.';
      } else if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        msg =
          'Tu navegador bloqueó la ventana de Google dentro de la vista previa. Pulsa "Abrir en pestaña nueva" abajo para conectar tu Google Drive.';
      } else if (code === 'auth/unauthorized-domain') {
        msg = `El dominio "${window.location.hostname}" no está autorizado en Firebase Console (Authentication → Settings → Authorized domains).`;
      }
      setDriveError(msg);
      showToast(msg);
    } finally {
      setDriveConnecting(false);
    }
  };

  const handleSearchDrive = useCallback(
    (query: string, folderId?: string | null) => {
      const resolvedFolder = folderId !== undefined ? folderId : driveSelectedFolderId;
      loadDriveLibrary(undefined, query, resolvedFolder, false);
    },
    [driveSelectedFolderId, loadDriveLibrary]
  );

  const handleLoadMoreDrive = async () => {
    const token = getDriveAccessToken();
    if (!token || !driveNextPageToken || driveLoadingMore) return;
    setDriveLoadingMore(true);
    setDriveError(null);
    try {
      const folderIds = driveSelectedFolderId
        ? getDescendantFolderIds(driveSelectedFolderId, driveFoldersRef.current)
        : undefined;
      const res = await listDriveMusicFiles(token, {
        query: driveQuery,
        folderId: driveSelectedFolderId,
        folderIds,
        pageToken: driveNextPageToken,
      });
      setDriveFiles((prev) => [...prev, ...res.files]);
      setDriveNextPageToken(res.nextPageToken);
    } catch (err: any) {
      if (err instanceof DriveAuthError) {
        clearDriveAccessToken();
        setNeedsDriveAuth(true);
        setDriveHasLoaded(false);
        setDriveError(err.message);
      } else {
        setDriveError(err?.message || 'No se pudieron cargar más canciones.');
      }
    } finally {
      setDriveLoadingMore(false);
    }
  };

  const handleLoadDriveFileToDeck = async (file: DriveMusicFile, deckId: DeckId) => {
    const token = getDriveAccessToken();
    if (!token) {
      setNeedsDriveAuth(true);
      showToast('Inicia sesión con Google para abrir esta canción de Drive');
      return;
    }

    audioEngine.resume();
    setDriveLoadingFileId(file.id);
    setDriveError(null);
    showToast(`Cargando desde Drive: ${file.name}...`);

    try {
      const { objectUrl, durationSec, isVideo } = await downloadDriveMediaObjectUrl(token, file);
      const parsedBpm = extractBpmFromTrackName(file.name);
      const track: TrackItem = {
        id: `drive-${file.id}`,
        name: file.name,
        bpm: parsedBpm ?? undefined,
        durationSec,
        sourceType: 'file',
        audioUrl: isVideo ? undefined : objectUrl,
        videoUrl: isVideo ? objectUrl : undefined,
        isVideo,
        playlistIds: [],
        hasAiLyrics: false,
      };
      deckConsumedRef.current[deckId] = false;
      setDeck(deckId, (prev) => ({
        ...prev,
        source: 'local',
        track,
        isPlaying: false,
        currentTime: 0,
        duration: durationSec,
        playbackRate: 1,
        syncedBpm: null,
        cuePoint: 0,
        showLyricsOverlay: false,
      }));
      if (mixerRef.current.autoMixEnabled) {
        ensureOppositeDeckQueued(deckId, track, false);
      }
      setMobileActiveDeck(deckId);
      showToast(`Listo en Deck ${deckId}: ${file.name} (pulsa Play)`);
    } catch (err: any) {
      if (err instanceof DriveAuthError) {
        clearDriveAccessToken();
        setNeedsDriveAuth(true);
        setDriveHasLoaded(false);
        setDriveError(err.message);
      } else {
        const errMsg = err?.message || `Error al abrir ${file.name} desde Google Drive`;
        setDriveError(errMsg);
        showToast(errMsg);
      }
    } finally {
      setDriveLoadingFileId(null);
    }
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

  const handleDropAudioOnPad = async (padId: number, file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a)$/i.test(file.name)) {
      return;
    }
    const url = URL.createObjectURL(file);
    const label = file.name.replace(/\.[^.]+$/, '').slice(0, 11);
    const activeBank = samplerBanks.find((b) => b.id === activeBankId);
    const existing = activeBank?.pads.find((p) => p.id === padId);
    if (!existing) return;

    const isLoopMode = triggerMode === 'loop';
    const analysis = await audioEngine.analyzeAudioUrl(url);
    handleSavePad(
      {
        ...existing,
        label,
        color: existing.color === '#181C26' ? '#E11D48' : existing.color,
        customAudioUrl: url,
        customAudioName: file.name,
        fxPreset: undefined,
        loopMode: isLoopMode ? 'loop' : existing.loopMode,
        loopBpm: analysis?.detectedBpm || existing.loopBpm,
        loopStartSec: analysis?.introStartSec ?? existing.loopStartSec,
      },
      file
    );
    showToast(
      analysis
        ? `Cargado en Pad ${padId}: ${label} (${analysis.detectedBpm} BPM · Cola ${analysis.introStartSec.toFixed(2)}s)`
        : `Sample cargado en Pad ${padId}: ${label}`
    );
  };

  const extractDeckIntroClip = async (deckId: DeckId) => {
    const deck = deckId === 'A' ? deckA : deckB;
    if (deck.source !== 'local' || !deck.track) return null;
    const url =
      deck.track.sourceType === 'file'
        ? deck.track.videoUrl || deck.track.audioUrl || ''
        : getOrCreateDemoTrackUrl(deck.track);
    if (!url) return null;
    const clip = await audioEngine.extractIntroClipFromUrl(
      url,
      deck.track.name,
      deck.track.bpm
    );
    if (!clip) return null;
    return {
      ...clip,
      label: deck.track.name.slice(0, 11),
    };
  };

  const handleCaptureDeckIntro = async (deckId: DeckId) => {
    const deck = deckId === 'A' ? deckA : deckB;
    if (deck.source !== 'local' || !deck.track) {
      showToast(`Carga primero una canción local en Deck ${deckId}`);
      return;
    }
    const clip = await extractDeckIntroClip(deckId);
    if (!clip) {
      showToast(`No se pudo analizar el audio del Deck ${deckId}`);
      return;
    }
    const activeBank = samplerBanks.find((b) => b.id === activeBankId) || samplerBanks[0];
    if (!activeBank) return;

    const emptyInB = activeBank.pads.find(
      (p) => p.id >= 17 && !p.fxPreset && !p.customAudioUrl
    );
    const emptyAny = activeBank.pads.find(
      (p) => !p.fxPreset && !p.customAudioUrl
    );
    const targetPad = emptyInB || emptyAny || activeBank.pads[31];
    if (!targetPad) return;

    const nextPad: SamplerPad = {
      ...targetPad,
      label: clip.label,
      color: deckId === 'A' ? '#2DD4BF' : '#EC4899',
      customAudioUrl: clip.url,
      customAudioName: clip.file.name,
      fxPreset: undefined,
      loopMode: 'loop',
      loopBpm: clip.detectedBpm,
      loopStartSec: clip.introStartSec,
      loopFullFile: false,
    };

    await handleSavePad(nextPad, clip.file);
    audioEngine.resume();
    await audioEngine.triggerPad(nextPad, 'loop', clip.detectedBpm);
    showToast(
      `Auto Loop 1ª Cola de "${deck.track.name}" (${clip.detectedBpm} BPM) en Pad ${targetPad.id}`
    );
  };

  if (showAdminDashboard && isAdmin && authUser) {
    return (
      <Suspense
        fallback={
          <div className="h-screen w-screen bg-[#080A0F] text-slate-300 flex items-center justify-center text-sm font-medium">
            Cargando panel personal...
          </div>
        }
      >
        <AdminDashboardView
          adminUid={authUser.uid}
          adminEmail={authUser.email || ''}
          onOpenStudio={() => {
            setShowAdminDashboard(false);
            handleOpenStudio('local');
          }}
          onSignOut={handleSignOut}
        />
      </Suspense>
    );
  }

  if (showLoginScreen && !authUser) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen w-full bg-[#060913] text-slate-300 flex items-center justify-center text-sm font-medium">
            Cargando inicio de sesión...
          </div>
        }
      >
        <LoginView
          onBack={() => {
            setAuthError(null);
            setAuthNotice(null);
            setShowLoginScreen(false);
          }}
          onGoogleSignIn={handleSignInGoogle}
          onEmailSignIn={handleEmailSignIn}
          onEmailRegister={handleEmailRegister}
          onResetPassword={handleResetPassword}
          onClearFeedback={() => {
            setAuthError(null);
            setAuthNotice(null);
          }}
          authError={authError}
          authNotice={authNotice}
        />
      </Suspense>
    );
  }

  if (!inStudio) {
    return (
      <LandingView
        onOpenStudio={handleOpenStudio}
        authLoading={authLoading}
        userEmail={authUser?.email || null}
        userName={authUser?.displayName || null}
        userPhoto={authUser?.photoURL || null}
        emailVerified={Boolean(authUser?.emailVerified)}
        isAuthorized={true}
        isAdmin={isAdmin}
        clientSuspended={clientSuspended}
        accessRequestStatus={accessRequest?.status || null}
        onOpenLogin={() => {
          setAuthError(null);
          setAuthNotice(null);
          setShowLoginScreen(true);
        }}
        onSwitchAccount={handleSwitchAccount}
        onSignOut={handleSignOut}
        onRequestAccess={handleRequestAccess}
        onResendVerification={handleResendVerification}
        onRefreshVerification={handleRefreshVerification}
        onOpenAdminDashboard={() => setShowAdminDashboard(true)}
        authError={authError}
        authNotice={authNotice}
      />
    );
  }

  // Compute effective channel gain for YouTube volume sync (ducks during sampler cuñas)
  const normXf = (mixer.crossfader + 1) * 0.5;
  const duckFactor = isSamplerDucking ? 0.28 : 1;
  const effVolA = mixer.A.volume * Math.cos(normXf * 0.5 * Math.PI) * duckFactor;
  const effVolB = mixer.B.volume * Math.cos((1 - normXf) * 0.5 * Math.PI) * duckFactor;
  const activeDeckBpm =
    (deckA.isPlaying ? deckA.track?.bpm : undefined) ||
    (deckB.isPlaying ? deckB.track?.bpm : undefined) ||
    deckA.track?.bpm ||
    deckB.track?.bpm ||
    100;

  const autoDjPoolSize = getAutoDjPool(deckA.track || deckB.track).length;
  const activeMixOutSuggestion = (() => {
    const focused =
      deckA.isPlaying && !deckB.isPlaying
        ? deckA
        : deckB.isPlaying && !deckA.isPlaying
        ? deckB
        : mixer.crossfader <= 0 && deckA.track
        ? deckA
        : deckB.track
        ? deckB
        : null;
    if (!focused?.track || focused.duration <= 5) return null;
    return computeTrackMixOutSec(focused.track, focused.duration, autoDjMixStyle);
  })();

  const autoDjStatus: AutoDjStatus = {
    enabled: mixer.autoMixEnabled,
    sourceType: autoDjSource.sourceType,
    playlistId: autoDjSource.playlistId,
    driveFolderId: autoDjSource.driveFolderId,
    sourceLabel: autoDjSource.label,
    phase: mixer.autoMixEnabled ? autoDjPhase : 'idle',
    mixStyle: autoDjMixStyle,
    nextTrackName: autoDjNextInfo.name,
    nextTrackBpm: autoDjNextInfo.bpm,
    targetRate: autoDjNextInfo.targetRate,
    syncModeLabel: autoDjNextInfo.syncModeLabel,
    mixInSec: autoDjNextInfo.mixInSec,
    suggestedMixOutSec: autoDjNextInfo.suggestedMixOutSec ?? activeMixOutSuggestion,
    suggestedMixInSec: autoDjNextInfo.suggestedMixInSec,
    playedCount: autoDjPlayedIdsRef.current.size,
    totalCount: autoDjPoolSize,
  };

  const lyricsModalTrack = tracks.find((t) => t.id === lyricsModalTrackId) || null;

  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen bg-[#080A0F] text-slate-300 flex items-center justify-center text-sm font-medium">
          Cargando consola ShowLive...
        </div>
      }
    >
      <div className="h-screen w-screen overflow-hidden bg-[#0A0B0F] text-slate-100 flex flex-col">
      <TopBar
        workspaceMode={workspaceMode}
        onChangeMode={setWorkspaceMode}
        onOpenAiConfig={() => setShowAiConfigModal(true)}
        onOpenLogin={() => {
          setAuthError(null);
          setAuthNotice(null);
          setShowLoginScreen(true);
        }}
        onLogout={handleSignOut}
        aiConfig={aiConfig}
        isAdmin={isAdmin}
        onOpenAdminDashboard={() => {
          setDeckA((p) => ({ ...p, isPlaying: false }));
          setDeckB((p) => ({ ...p, isPlaying: false }));
          setShowAdminDashboard(true);
        }}
        userPhoto={authUser?.photoURL || null}
        userEmail={authUser?.email || null}
      />

      {/* Mobile Compact Header (< md) */}
      <div className="md:hidden relative h-11 flex items-center justify-between px-3 bg-[#101218] border-b border-white/10 shrink-0">
        <div className="studio-tricolor-bar absolute bottom-0 inset-x-0 h-[2px] opacity-85 pointer-events-none" />
        <span className="font-display text-sm font-extrabold tracking-tight">
          <span className="text-[#FACC15]">Show</span>
          <span className="text-[#22D3EE]">Live</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="h-8 px-2 rounded bg-[#141720] border border-white/15 text-slate-200 flex items-center gap-1 text-[11px] font-semibold cursor-pointer shrink-0"
            title="Pantalla Completa"
          >
            <Maximize className="w-3.5 h-3.5 text-[#22D3EE]" />
            <span>Full</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setDeckA((p) => ({ ...p, isPlaying: false }));
                setDeckB((p) => ({ ...p, isPlaying: false }));
                setShowAdminDashboard(true);
              }}
              className="h-8 px-2.5 rounded bg-[#141720] border border-[#FACC15]/60 text-[11px] font-bold text-[#FACC15] cursor-pointer shrink-0"
            >
              Dashboard
            </button>
          )}
          <DownloadAppButton variant="mobile" />
          {authUser && (
            <button
              type="button"
              onClick={handleSignOut}
              className="h-8 px-2.5 rounded bg-[#141720] border border-[#EC287B]/50 text-[11px] font-semibold text-slate-200 cursor-pointer shrink-0"
            >
              Salir
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Body */}
      <main className="flex-1 min-h-0 p-2 sm:p-2.5 flex flex-col gap-2 xl:gap-2.5 overflow-hidden">
        {/* Mobile Deck A / Deck B Quick Switcher (shown in mobile Decks mode) */}
        {workspaceMode !== 'pads' && mobileTab === 'decks' && (
          <div className="flex md:hidden items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setMobileActiveDeck('A')}
              className={`flex-1 min-w-0 h-10 px-2.5 rounded-lg border flex items-center justify-between gap-1.5 text-left transition-all cursor-pointer ${
                mobileActiveDeck === 'A'
                  ? 'bg-[#22D3EE]/15 border-[#22D3EE] text-white shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                  : 'bg-[#101218] border-white/15 text-slate-400'
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-[#22D3EE] text-[#090A0E] text-[10px] font-extrabold shrink-0">
                  A
                </span>
                <span className="text-[11px] font-semibold truncate">
                  {deckA.source === 'youtube'
                    ? deckA.youtubeTitle || 'YouTube'
                    : deckA.track?.name || 'Vacío'}
                </span>
              </span>
              {deckA.isPlaying && (
                <span className="w-2 h-2 rounded-full bg-[#22D3EE] shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={handleManualCrossfadeNow}
              className="w-10 h-10 rounded-lg bg-[#101218] border border-[#FACC15]/55 text-[#FACC15] flex items-center justify-center shrink-0 cursor-pointer"
              title="Transición automática al otro Deck"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setMobileActiveDeck('B')}
              className={`flex-1 min-w-0 h-10 px-2.5 rounded-lg border flex items-center justify-between gap-1.5 text-left transition-all cursor-pointer ${
                mobileActiveDeck === 'B'
                  ? 'bg-[#EC287B]/15 border-[#EC287B] text-white shadow-[0_0_10px_rgba(236,40,123,0.25)]'
                  : 'bg-[#101218] border-white/15 text-slate-400'
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-[#EC287B] text-white text-[10px] font-extrabold shrink-0">
                  B
                </span>
                <span className="text-[11px] font-semibold truncate">
                  {deckB.source === 'youtube'
                    ? deckB.youtubeTitle || 'YouTube'
                    : deckB.track?.name || 'Vacío'}
                </span>
              </span>
              {deckB.isPlaying && (
                <span className="w-2 h-2 rounded-full bg-[#EC287B] shrink-0" />
              )}
            </button>
          </div>
        )}

        {/* UPPER SECTION: DECK A + MIXER + DECK B — Always mounted offscreen when inactive so YouTube & local playback never stop */}
        <section
          aria-hidden={workspaceMode === 'pads'}
          className={
            workspaceMode === 'pads'
              ? 'fixed -left-[10000px] top-0 w-[800px] h-[360px] opacity-0 pointer-events-none'
              : mobileTab === 'decks' || mobileTab === 'mixer'
              ? 'flex flex-col flex-1 min-h-0 gap-2 md:flex-none md:flex-row md:items-stretch md:gap-2 xl:gap-2.5 md:h-[45%] lg:h-[47%] xl:h-[50%] md:min-h-[250px] lg:min-h-[264px] xl:min-h-0 shrink-0'
              : 'fixed -left-[10000px] top-0 w-[720px] h-[320px] opacity-0 pointer-events-none md:static md:left-auto md:top-auto md:w-auto md:opacity-100 md:pointer-events-auto md:flex md:flex-none md:flex-row md:items-stretch md:gap-2 xl:gap-2.5 md:h-[45%] lg:h-[47%] xl:h-[50%] md:min-h-[250px] lg:min-h-[264px] xl:min-h-0 shrink-0'
          }
        >
          <div
            className={
              mobileTab === 'decks' && mobileActiveDeck === 'A'
                ? 'flex flex-1 min-h-0 min-w-0'
                : 'fixed -left-[10000px] top-0 w-[640px] h-[360px] opacity-0 pointer-events-none md:static md:left-auto md:top-auto md:w-auto md:h-auto md:opacity-100 md:pointer-events-auto md:flex md:flex-1 md:min-w-0'
            }
          >
            <DeckPanel
              deck={deckA}
              channelVolume={effVolA}
              onTogglePlay={() => handleTogglePlay('A')}
              onSetPlaying={(playing) =>
                setDeck('A', (prev) => ({ ...prev, isPlaying: playing }))
              }
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
              onCaptureIntroToPad={handleCaptureDeckIntro}
              onPlaybackError={(msg) => showToast(msg)}
              onDetectedBpm={(bpm) =>
                setDeckA((p) =>
                  p.track && !p.track.bpm ? { ...p, track: { ...p.track, bpm } } : p
                )
              }
              onTrackAnalysis={(analysis) => handleDeckTrackAnalysis('A', analysis)}
              suggestedMixOutSec={
                deckA.track && deckA.duration > 5
                  ? computeTrackMixOutSec(deckA.track, deckA.duration, autoDjMixStyle)
                  : null
              }
            />
          </div>

          <div
            className={
              mobileTab === 'mixer'
                ? 'flex flex-1 min-h-0 md:flex-none md:order-2'
                : 'hidden md:flex md:order-2 min-h-0'
            }
          >
            <MixerPanel
              mixer={mixer}
              autoDjStatus={autoDjStatus}
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
              deckAPlaying={deckA.isPlaying}
              deckBPlaying={deckB.isPlaying}
              deckAEnding={
                deckA.isPlaying && deckA.duration > 8 && deckA.duration - deckA.currentTime <= 15
              }
              deckBEnding={
                deckB.isPlaying && deckB.duration > 8 && deckB.duration - deckB.currentTime <= 15
              }
            />
          </div>

          <div
            className={
              mobileTab === 'decks' && mobileActiveDeck === 'B'
                ? 'flex flex-1 min-h-0 min-w-0 md:order-3'
                : 'fixed -left-[10000px] top-0 w-[640px] h-[360px] opacity-0 pointer-events-none md:static md:left-auto md:top-auto md:w-auto md:h-auto md:opacity-100 md:pointer-events-auto md:order-3 md:flex md:flex-1 md:min-w-0'
            }
          >
            <DeckPanel
              deck={deckB}
              channelVolume={effVolB}
              onTogglePlay={() => handleTogglePlay('B')}
              onSetPlaying={(playing) =>
                setDeck('B', (prev) => ({ ...prev, isPlaying: playing }))
              }
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
              onCaptureIntroToPad={handleCaptureDeckIntro}
              onPlaybackError={(msg) => showToast(msg)}
              onDetectedBpm={(bpm) =>
                setDeckB((p) =>
                  p.track && !p.track.bpm ? { ...p, track: { ...p.track, bpm } } : p
                )
              }
              onTrackAnalysis={(analysis) => handleDeckTrackAnalysis('B', analysis)}
              suggestedMixOutSec={
                deckB.track && deckB.duration > 5
                  ? computeTrackMixOutSec(deckB.track, deckB.duration, autoDjMixStyle)
                  : null
              }
            />
          </div>
        </section>

        {/* LOWER SECTION: LIBRARY + SAMPLER */}
        <section
          ref={libraryRef}
          className={`${
            workspaceMode === 'pads' || mobileTab === 'library' || mobileTab === 'sampler'
              ? 'flex'
              : 'hidden md:flex'
          } flex-1 min-h-0 flex-col md:flex-row gap-2 xl:gap-2.5 overflow-hidden`}
        >
          <div
            className={
              workspaceMode === 'pads'
                ? 'hidden'
                : mobileTab === 'library'
                ? 'flex flex-1 min-h-0 min-w-0 overflow-hidden'
                : 'hidden md:flex md:flex-1 md:min-h-0 md:min-w-0 overflow-hidden'
            }
          >
            <LibraryPanel
              activeTab={libraryTab}
              onSelectTab={(tab) => {
                setLibraryTab(tab);
                if (tab === 'youtube' && ytResults.length === 0) {
                  handleSearchYoutube('Salsa Karaoke');
                }
                if (tab === 'drive') {
                  const token = getDriveAccessToken();
                  if (!token) {
                    setNeedsDriveAuth(true);
                  } else if (driveFiles.length === 0 && !driveLoading) {
                    loadDriveLibrary(token, driveQuery, driveSelectedFolderId, true);
                  }
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
                await clearPersistedState(authUser?.uid);
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
              autoDjStatus={autoDjStatus}
              onStartAutoDjSession={startOrEnableAutoDj}
              onStopAutoDj={stopAutoDj}
              onManualCrossfadeNow={handleManualCrossfadeNow}
              onSkipAutoDjNext={handleSkipAutoDjNext}
              onToggleAutoDjMixStyle={handleToggleAutoDjMixStyle}
              ytResults={ytResults}
              ytLoading={ytLoading}
              ytError={ytError}
              onSearchYoutube={handleSearchYoutube}
              onLoadYoutubeToDeck={handleLoadYoutubeToDeck}
              driveFiles={driveFiles}
              driveFolders={driveFolders}
              driveSelectedFolderId={driveSelectedFolderId}
              driveLoading={driveLoading}
              driveLoadingMore={driveLoadingMore}
              driveNextPageToken={driveNextPageToken}
              driveLoadingFileId={driveLoadingFileId}
              driveError={driveError}
              needsDriveAuth={needsDriveAuth}
              driveConnecting={driveConnecting}
              driveAccountEmail={driveAccountEmail || authUser?.email || null}
              onConnectDrive={handleConnectDrive}
              onSearchDrive={handleSearchDrive}
              onLoadMoreDrive={handleLoadMoreDrive}
              onSelectDriveFolder={setDriveSelectedFolderId}
              onLoadDriveFileToDeck={handleLoadDriveFileToDeck}
              deckAStatus={{
                isPlaying: deckA.isPlaying,
                trackName: deckA.track?.name || deckA.youtubeTitle || null,
                bpm: deckA.track?.bpm ?? null,
              }}
              deckBStatus={{
                isPlaying: deckB.isPlaying,
                trackName: deckB.track?.name || deckB.youtubeTitle || null,
                bpm: deckB.track?.bpm ?? null,
              }}
            />
          </div>

          <div
            className={
              workspaceMode === 'pads' || mobileTab === 'sampler'
                ? 'flex flex-1 min-h-0'
                : 'hidden md:flex md:min-h-0'
            }
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
              fallbackBpm={activeDeckBpm}
              isDucking={isSamplerDucking}
              deckALabel={deckA.source === 'local' ? deckA.track?.name || null : null}
              deckBLabel={deckB.source === 'local' ? deckB.track?.name || null : null}
              onCaptureDeckIntro={handleCaptureDeckIntro}
              isCollapsed={
                workspaceMode === 'pads' || mobileTab === 'sampler' ? false : samplerCollapsed
              }
              onToggleCollapse={() => setSamplerCollapsed((v) => !v)}
              isFullPadsView={workspaceMode === 'pads'}
              onToggleFullPadsView={() =>
                setWorkspaceMode((m) => (m === 'pads' ? 'mixer' : 'pads'))
              }
              onEditPad={setEditingPad}
              onDropAudioOnPad={handleDropAudioOnPad}
            />
          </div>
        </section>
      </main>

      {/* Mobile Bottom Navigation Bar (< md) */}
      <nav
        aria-label="Navegación móvil"
        className="md:hidden h-[58px] shrink-0 bg-[#101218] border-t border-white/15 grid grid-cols-5 items-center px-1 select-none"
      >
        <button
          type="button"
          onClick={() => {
            setWorkspaceMode('mixer');
            setMobileTab('decks');
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            workspaceMode !== 'pads' && mobileTab === 'decks'
              ? 'text-[#FACC15]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-2.5 py-1 rounded-xl ${
              workspaceMode !== 'pads' && mobileTab === 'decks' ? 'bg-[#FACC15]/15 border border-[#FACC15]/50' : ''
            }`}
          >
            <Disc className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Decks</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setWorkspaceMode('mixer');
            setMobileTab('mixer');
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            workspaceMode !== 'pads' && mobileTab === 'mixer'
              ? 'text-[#FACC15]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-2.5 py-1 rounded-xl ${
              workspaceMode !== 'pads' && mobileTab === 'mixer' ? 'bg-[#FACC15]/15 border border-[#FACC15]/50' : ''
            }`}
          >
            <Sliders className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Mixer</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setWorkspaceMode('mixer');
            setMobileTab('library');
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            workspaceMode !== 'pads' && mobileTab === 'library'
              ? 'text-[#22D3EE]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-2.5 py-1 rounded-xl ${
              workspaceMode !== 'pads' && mobileTab === 'library' ? 'bg-[#22D3EE]/15 border border-[#22D3EE]/50' : ''
            }`}
          >
            <Library className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Música</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setWorkspaceMode('mixer');
            setMobileTab('sampler');
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors cursor-pointer ${
            workspaceMode === 'pads' || mobileTab === 'sampler'
              ? 'text-[#EC287B]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span
            className={`px-2.5 py-1 rounded-xl ${
              workspaceMode === 'pads' || mobileTab === 'sampler' ? 'bg-[#EC287B]/15 border border-[#EC287B]/50' : ''
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Pads</span>
        </button>

        <button
          type="button"
          onClick={() => setShowAiConfigModal(true)}
          className="flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          <span className="px-2.5 py-1">
            <Settings className="w-5 h-5" />
          </span>
          <span className="text-[10px] font-semibold leading-none">Ajustes</span>
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
          onLogout={handleSignOut}
          isAdmin={isAdmin}
          userEmail={authUser?.email || null}
          onOpenLogin={() => {
            setAuthError(null);
            setAuthNotice(null);
            setShowLoginScreen(true);
          }}
          onOpenAdminDashboard={() => {
            setDeckA((p) => ({ ...p, isPlaying: false }));
            setDeckB((p) => ({ ...p, isPlaying: false }));
            setShowAdminDashboard(true);
          }}
        />
      )}

      {editingPad && (
        <PadEditorModal
          pad={editingPad}
          activeDeckBpm={activeDeckBpm}
          hasDeckA={Boolean(deckA.source === 'local' && deckA.track)}
          hasDeckB={Boolean(deckB.source === 'local' && deckB.track)}
          onExtractDeckIntro={extractDeckIntroClip}
          onSave={handleSavePad}
          onClose={() => setEditingPad(null)}
        />
      )}

      {/* Subtle Bottom Toast */}
      {toastMsg && (
        <div className="fixed bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#101218]/95 border border-[#FACC15]/75 text-xs font-bold text-[#FACC15] shadow-[0_0_16px_rgba(250,204,21,0.2)] pointer-events-none">
          {toastMsg}
        </div>
      )}

      <OfflineIndicator />
      </div>
    </Suspense>
  );
}
