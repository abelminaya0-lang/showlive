import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { auth, googleProvider } from './firebase';
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

  const libraryRef = useRef<HTMLDivElement | null>(null);
  const autoMixTimerRef = useRef<number | null>(null);
  const autoTransitionDeckRef = useRef<DeckId | null>(null);
  const deckConsumedRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const hydratedUidRef = useRef<string | null>(null);
  const loggedEntryForUidRef = useRef<string | null>(null);
  const cloudSaveTimerRef = useRef<number | null>(null);
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

  // Resolve any Google redirect result (fallback when popup was blocked on standalone browser)
  useEffect(() => {
    getRedirectResult(auth).catch((err: any) => {
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
      await signInWithPopup(auth, googleProvider);
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
      cuePoint: 0,
      showLyricsOverlay: aiConfigRef.current.autoSyncLyrics && readyTrack.hasAiLyrics,
    }));
    if (mixerRef.current.autoMixEnabled) {
      ensureOppositeDeckQueued(deckId, readyTrack, false);
    }
    setMobileActiveDeck(deckId);
    showToast(`Cargado en Deck ${deckId}: ${readyTrack.name}`);
  };

  const getAutoMixPool = useCallback(
    (
      referenceTrack?: TrackItem | null,
      overridePlaylistId?: string | null,
      overrideTracks?: TrackItem[]
    ): TrackItem[] => {
      const allTracks = overrideTracks ?? tracksRef.current;
      const plId =
        overridePlaylistId !== undefined
          ? overridePlaylistId
          : selectedPlaylistIdRef.current ?? referenceTrack?.playlistIds?.[0] ?? null;
      if (plId) {
        const folderTracks = allTracks.filter((t) => t.playlistIds.includes(plId));
        if (folderTracks.length > 0) return folderTracks;
      }
      return allTracks;
    },
    []
  );

  const pickNextTrackFromPool = useCallback(
    (pool: TrackItem[], currentTrack?: TrackItem | null): TrackItem | null => {
      if (pool.length === 0) return null;
      const currentIdx = currentTrack
        ? pool.findIndex((t) => t.id === currentTrack.id)
        : -1;
      const nextIdx = (currentIdx + 1) % pool.length;
      return pool[nextIdx] || null;
    },
    []
  );

  const loadPoolTrackToDeck = useCallback(
    async (deckId: DeckId, track: TrackItem, autoPlay: boolean) => {
      deckConsumedRef.current[deckId] = false;
      const ready = await resolveTrackMediaUrl(track);
      setDeck(deckId, (prev) => ({
        ...prev,
        source: 'local',
        track: ready,
        isPlaying: autoPlay,
        currentTime: 0,
        duration: ready.durationSec,
        cuePoint: 0,
        showLyricsOverlay: aiConfigRef.current.autoSyncLyrics && ready.hasAiLyrics,
      }));
    },
    [resolveTrackMediaUrl]
  );

  const ensureOppositeDeckQueued = useCallback(
    async (
      activeDeckId: DeckId,
      activeTrack?: TrackItem | null,
      forceReplace = false,
      overridePlaylistId?: string | null,
      overrideTracks?: TrackItem[]
    ) => {
      const otherDeckId: DeckId = activeDeckId === 'A' ? 'B' : 'A';
      const otherDeck = otherDeckId === 'A' ? deckARef.current : deckBRef.current;
      if (!forceReplace && otherDeck.isPlaying) return;

      const isOtherEmptyOrDone =
        forceReplace ||
        (!otherDeck.track && !otherDeck.youtubeId) ||
        (otherDeck.source === 'local' && deckConsumedRef.current[otherDeckId]);

      if (!isOtherEmptyOrDone) return;

      const pool = getAutoMixPool(activeTrack, overridePlaylistId, overrideTracks);
      const nextTrack = pickNextTrackFromPool(pool, activeTrack);
      if (!nextTrack) return;

      await loadPoolTrackToDeck(otherDeckId, nextTrack, false);
    },
    [getAutoMixPool, loadPoolTrackToDeck, pickNextTrackFromPool]
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
      const fromDeck = fromDeckId === 'A' ? deckARef.current : deckBRef.current;
      const toDeck = toDeckId === 'A' ? deckARef.current : deckBRef.current;

      const pool = getAutoMixPool(fromDeck.track);
      let nextTrackToLoad: TrackItem | null = null;
      const shouldLoadFromPool =
        (!toDeck.track && !toDeck.youtubeId) ||
        (toDeck.source === 'local' && deckConsumedRef.current[toDeckId] && pool.length > 0);
      if (shouldLoadFromPool && pool.length > 0) {
        nextTrackToLoad = pickNextTrackFromPool(pool, fromDeck.track);
      }

      if (!toDeck.track && !toDeck.youtubeId && !nextTrackToLoad) {
        return; // Nothing to transition to
      }

      autoTransitionDeckRef.current = fromDeckId;
      deckConsumedRef.current[fromDeckId] = true;
      deckConsumedRef.current[toDeckId] = false;
      audioEngine.resume();

      const activeTargetTrack = nextTrackToLoad || toDeck.track;

      if (nextTrackToLoad) {
        loadPoolTrackToDeck(toDeckId, nextTrackToLoad, true);
      } else {
        setDeck(toDeckId, (prev) => ({ ...prev, isPlaying: true }));
      }

      showToast(`AutoMix: pasando a Deck ${toDeckId}`);

      if (autoMixTimerRef.current) {
        window.clearInterval(autoMixTimerRef.current);
      }

      const targetSide = toDeckId === 'B' ? 1 : -1;
      const startVal = mixerRef.current.crossfader;
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
          setDeck(fromDeckId, (prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
          autoTransitionDeckRef.current = null;

          // Auto-load the next song from the active folder onto the now-idle opposite deck
          if (mixerRef.current.autoMixEnabled && activeTargetTrack) {
            ensureOppositeDeckQueued(toDeckId, activeTargetTrack, true);
          }
        }
      }, 75);
    },
    [
      ensureOppositeDeckQueued,
      getAutoMixPool,
      loadPoolTrackToDeck,
      pickNextTrackFromPool,
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
    if (
      mixerRef.current.autoMixEnabled &&
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
    if (mixerRef.current.autoMixEnabled && autoTransitionDeckRef.current !== deckId) {
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
    const nextEnabled = !mixerRef.current.autoMixEnabled;

    if (!nextEnabled && autoMixTimerRef.current) {
      window.clearInterval(autoMixTimerRef.current);
      autoMixTimerRef.current = null;
      autoTransitionDeckRef.current = null;
    }

    const dA = deckARef.current;
    const dB = deckBRef.current;
    const bothEmpty =
      !dA.track && !dA.youtubeId && !dB.track && !dB.youtubeId;
    const pool = getAutoMixPool(dA.track || dB.track);

    setMixer((prev) => ({
      ...prev,
      autoMixEnabled: nextEnabled,
      ...(nextEnabled && bothEmpty && pool.length > 0 ? { crossfader: -1 } : {}),
    }));

    if (nextEnabled) {
      if (dA.isPlaying && dA.source === 'local') {
        ensureOppositeDeckQueued('A', dA.track, false);
      } else if (dB.isPlaying && dB.source === 'local') {
        ensureOppositeDeckQueued('B', dB.track, false);
      } else if (dA.track && !dB.track && !dB.youtubeId) {
        ensureOppositeDeckQueued('A', dA.track, false);
      } else if (dB.track && !dA.track && !dA.youtubeId) {
        ensureOppositeDeckQueued('B', dB.track, false);
      } else if (bothEmpty && pool.length > 0) {
        loadPoolTrackToDeck('A', pool[0], true);
        if (pool.length > 1) {
          loadPoolTrackToDeck('B', pool[1], false);
        }
      }
    }

    showToast(
      nextEnabled
        ? 'AutoMix activado: leerá y cargará la siguiente canción de la carpeta automáticamente'
        : 'AutoMix desactivado'
    );
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
    triggerAutoMixTransition(fromDeckId);
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

      // If AutoMix is active when uploading a folder/tracks, auto-start & queue Deck A / B
      if (mixerRef.current.autoMixEnabled && addedTracks.length > 0) {
        const dA = deckARef.current;
        const dB = deckBRef.current;

        if (!dA.isPlaying && !dB.isPlaying) {
          audioEngine.resume();
          setMixer((prev) => ({ ...prev, crossfader: -1 }));
          await loadPoolTrackToDeck('A', addedTracks[0], true);
          if (addedTracks.length > 1) {
            await loadPoolTrackToDeck('B', addedTracks[1], false);
            showToast(
              `AutoMix activo: "${addedTracks[0].name}" en Deck A y siguiente en Deck B`
            );
          } else {
            showToast(`AutoMix activo: reproduciendo "${addedTracks[0].name}" en Deck A`);
          }
        } else if (dA.isPlaying && !dB.isPlaying) {
          await loadPoolTrackToDeck('B', addedTracks[0], false);
          showToast(
            `Carpeta lista: "${addedTracks[0].name}" cargada en Deck B para AutoMix`
          );
        } else if (dB.isPlaying && !dA.isPlaying) {
          await loadPoolTrackToDeck('A', addedTracks[0], false);
          showToast(
            `Carpeta lista: "${addedTracks[0].name}" cargada en Deck A para AutoMix`
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

      {/* Mobile Compact Header (< lg) */}
      <div className="lg:hidden relative h-11 flex items-center justify-between px-3 bg-[#101218] border-b border-white/10 shrink-0">
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
          {!authUser ? (
            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                setAuthNotice(null);
                setShowLoginScreen(true);
              }}
              className="h-8 px-2.5 rounded bg-[#141720] border border-[#22D3EE]/60 text-[11px] font-bold text-[#22D3EE] cursor-pointer shrink-0"
            >
              Entrar
            </button>
          ) : (
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
      <main className="flex-1 min-h-0 p-2 sm:p-2.5 flex flex-col gap-2 lg:gap-2.5 overflow-hidden">
        {/* Mobile Deck A / Deck B Quick Switcher (shown in mobile Decks mode) */}
        {workspaceMode !== 'pads' && mobileTab === 'decks' && (
          <div className="flex lg:hidden items-center gap-1.5 shrink-0">
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
              ? 'flex flex-col flex-1 min-h-0 gap-2 lg:flex-none lg:flex-row lg:items-stretch lg:gap-2.5 lg:h-[50%] shrink-0'
              : 'fixed -left-[10000px] top-0 w-[720px] h-[320px] opacity-0 pointer-events-none lg:static lg:left-auto lg:top-auto lg:w-auto lg:opacity-100 lg:pointer-events-auto lg:flex lg:flex-none lg:flex-row lg:items-stretch lg:gap-2.5 lg:h-[50%] shrink-0'
          }
        >
          <div
            className={
              mobileTab === 'decks' && mobileActiveDeck === 'A'
                ? 'flex flex-1 min-h-0 min-w-0'
                : 'fixed -left-[10000px] top-0 w-[640px] h-[360px] opacity-0 pointer-events-none lg:static lg:left-auto lg:top-auto lg:w-auto lg:h-auto lg:opacity-100 lg:pointer-events-auto lg:flex lg:flex-1 lg:min-w-0'
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
            />
          </div>

          <div
            className={
              mobileTab === 'mixer'
                ? 'flex flex-1 min-h-0 lg:flex-none lg:order-2'
                : 'hidden lg:flex lg:order-2 min-h-0'
            }
          >
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

          <div
            className={
              mobileTab === 'decks' && mobileActiveDeck === 'B'
                ? 'flex flex-1 min-h-0 min-w-0 lg:order-3'
                : 'fixed -left-[10000px] top-0 w-[640px] h-[360px] opacity-0 pointer-events-none lg:static lg:left-auto lg:top-auto lg:w-auto lg:h-auto lg:opacity-100 lg:pointer-events-auto lg:order-3 lg:flex lg:flex-1 lg:min-w-0'
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
            />
          </div>
        </section>

        {/* LOWER SECTION: LIBRARY + SAMPLER */}
        <section
          ref={libraryRef}
          className={`${
            workspaceMode === 'pads' || mobileTab === 'library' || mobileTab === 'sampler'
              ? 'flex'
              : 'hidden lg:flex'
          } flex-1 min-h-0 flex-col lg:flex-row gap-2.5 overflow-hidden`}
        >
          <div
            className={
              workspaceMode === 'pads'
                ? 'hidden'
                : mobileTab === 'library'
                ? 'flex flex-1 min-h-0'
                : 'hidden lg:flex lg:flex-1 lg:min-h-0'
            }
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
              ytResults={ytResults}
              ytLoading={ytLoading}
              ytError={ytError}
              onSearchYoutube={handleSearchYoutube}
              onLoadYoutubeToDeck={handleLoadYoutubeToDeck}
            />
          </div>

          <div
            className={
              workspaceMode === 'pads' || mobileTab === 'sampler'
                ? 'flex flex-1 min-h-0'
                : 'hidden lg:flex lg:min-h-0'
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

      {/* Mobile Bottom Navigation Bar (< lg) */}
      <nav
        aria-label="Navegación móvil"
        className="lg:hidden h-[58px] shrink-0 bg-[#101218] border-t border-white/15 grid grid-cols-5 items-center px-1 select-none"
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
        <div className="fixed bottom-16 lg:bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#101218]/95 border border-[#FACC15]/75 text-xs font-bold text-[#FACC15] shadow-[0_0_16px_rgba(250,204,21,0.2)] pointer-events-none">
          {toastMsg}
        </div>
      )}
      </div>
    </Suspense>
  );
}
