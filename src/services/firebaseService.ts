import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ADMIN_EMAIL, OperationType, db, handleFirestoreError } from '../firebase';
import {
  AccessLog,
  AccessRequest,
  AuthorizedClient,
  CurrencyCode,
  Playlist,
  SamplerBank,
  TrackItem,
} from '../types/showlive';

function toMillis(val: unknown): number | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof (val as any)?.toMillis === 'function') return (val as any).toMillis();
  if (typeof val === 'number') return val;
  return null;
}

export function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

export function isBootstrappedAdmin(email?: string | null): boolean {
  return normalizeEmail(email) === ADMIN_EMAIL;
}

export async function checkUserIsAdmin(user: User): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (isBootstrappedAdmin(user.email)) return true;
  const path = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeClientAccess(
  email: string,
  onData: (client: AuthorizedClient | null) => void,
  onError?: (err: unknown) => void
): () => void {
  const cleanEmail = normalizeEmail(email);
  const path = `clients/${cleanEmail}`;
  return onSnapshot(
    doc(db, 'clients', cleanEmail),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        email: d.email,
        clientName: d.clientName || '',
        active: Boolean(d.active),
        planName: d.planName || 'Mensual',
        amountPaid: Number(d.amountPaid || 0),
        currency: d.currency === 'USD' ? 'USD' : 'PEN',
        notes: d.notes || '',
        uid: d.uid || '',
        displayName: d.displayName || '',
        photoURL: d.photoURL || '',
        loginCount: Number(d.loginCount || 0),
        lastLoginAt: toMillis(d.lastLoginAt),
        createdAt: toMillis(d.createdAt),
        updatedAt: toMillis(d.updatedAt),
        createdBy: d.createdBy || '',
      });
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeMyAccessRequest(
  uid: string,
  onData: (req: AccessRequest | null) => void
): () => void {
  const path = `accessRequests/${uid}`;
  return onSnapshot(
    doc(db, 'accessRequests', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        uid: d.uid,
        email: d.email,
        displayName: d.displayName || '',
        photoURL: d.photoURL || '',
        status: d.status || 'pending',
        requestedAt: toMillis(d.requestedAt),
        updatedAt: toMillis(d.updatedAt),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function submitAccessRequest(user: User): Promise<void> {
  const cleanEmail = normalizeEmail(user.email);
  if (!cleanEmail) return;
  const path = `accessRequests/${user.uid}`;
  const ref = doc(db, 'accessRequests', user.uid);
  const displayName = (user.displayName || cleanEmail.split('@')[0]).slice(0, 100);
  const photoURL = (user.photoURL || '').slice(0, 400);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: cleanEmail,
        displayName,
        photoURL,
        status: 'pending',
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.status !== 'approved') {
      await updateDoc(ref, {
        displayName,
        photoURL,
        status: 'pending',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function recordAuthorizedClientEntry(
  user: User,
  currentClient: AuthorizedClient
): Promise<void> {
  const cleanEmail = normalizeEmail(user.email);
  if (!cleanEmail) return;

  const clientPath = `clients/${cleanEmail}`;
  try {
    await updateDoc(doc(db, 'clients', cleanEmail), {
      uid: user.uid,
      displayName: (user.displayName || currentClient.clientName || cleanEmail).slice(0, 100),
      photoURL: (user.photoURL || '').slice(0, 400),
      loginCount: (currentClient.loginCount || 0) + 1,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, clientPath);
  }

  const logId = `${user.uid}_${Date.now()}`;
  const logPath = `accessLogs/${logId}`;
  try {
    await setDoc(doc(db, 'accessLogs', logId), {
      uid: user.uid,
      email: cleanEmail,
      displayName: (user.displayName || currentClient.clientName || cleanEmail).slice(0, 100),
      enteredAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, logPath);
  }
}

// --- Admin Subscriptions & Mutations ---
export function subscribeAllClients(
  onData: (clients: AuthorizedClient[]) => void
): () => void {
  const path = 'clients';
  const q = query(collection(db, 'clients'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: AuthorizedClient[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          email: d.email,
          clientName: d.clientName || '',
          active: Boolean(d.active),
          planName: d.planName || 'Mensual',
          amountPaid: Number(d.amountPaid || 0),
          currency: d.currency === 'USD' ? 'USD' : 'PEN',
          notes: d.notes || '',
          uid: d.uid || '',
          displayName: d.displayName || '',
          photoURL: d.photoURL || '',
          loginCount: Number(d.loginCount || 0),
          lastLoginAt: toMillis(d.lastLoginAt),
          createdAt: toMillis(d.createdAt),
          updatedAt: toMillis(d.updatedAt),
          createdBy: d.createdBy || '',
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeAccessRequests(
  onData: (requests: AccessRequest[]) => void
): () => void {
  const path = 'accessRequests';
  const q = query(collection(db, 'accessRequests'), orderBy('requestedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: AccessRequest[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          uid: d.uid,
          email: d.email,
          displayName: d.displayName || '',
          photoURL: d.photoURL || '',
          status: d.status || 'pending',
          requestedAt: toMillis(d.requestedAt),
          updatedAt: toMillis(d.updatedAt),
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeAccessLogs(
  onData: (logs: AccessLog[]) => void
): () => void {
  const path = 'accessLogs';
  const q = query(
    collection(db, 'accessLogs'),
    orderBy('enteredAt', 'desc'),
    limit(120)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: AccessLog[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          uid: d.uid,
          email: d.email,
          displayName: d.displayName || '',
          enteredAt: toMillis(d.enteredAt),
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface UpsertClientInput {
  email: string;
  clientName: string;
  planName: string;
  amountPaid: number;
  currency: CurrencyCode;
  notes: string;
  active: boolean;
  requestUid?: string;
}

export async function upsertAuthorizedClient(
  adminUid: string,
  input: UpsertClientInput
): Promise<void> {
  const cleanEmail = normalizeEmail(input.email);
  if (!cleanEmail || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanEmail)) {
    throw new Error('Ingresa un correo electrónico válido.');
  }

  const path = `clients/${cleanEmail}`;
  const ref = doc(db, 'clients', cleanEmail);
  const safeAmount = Math.max(0, Math.min(1000000, Number(input.amountPaid) || 0));
  const safeClientName = (input.clientName || cleanEmail.split('@')[0]).trim().slice(0, 80);
  const safePlanName = (input.planName || 'Mensual').trim().slice(0, 50);
  const safeNotes = (input.notes || '').trim().slice(0, 300);
  const safeCurrency: CurrencyCode = input.currency === 'USD' ? 'USD' : 'PEN';

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        email: cleanEmail,
        clientName: safeClientName,
        active: Boolean(input.active),
        planName: safePlanName,
        amountPaid: safeAmount,
        currency: safeCurrency,
        notes: safeNotes,
        uid: '',
        displayName: '',
        photoURL: '',
        loginCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: adminUid,
      });
    } else {
      await updateDoc(ref, {
        clientName: safeClientName,
        active: Boolean(input.active),
        planName: safePlanName,
        amountPaid: safeAmount,
        currency: safeCurrency,
        notes: safeNotes,
        updatedAt: serverTimestamp(),
      });
    }

    if (input.requestUid) {
      await updateDoc(doc(db, 'accessRequests', input.requestUid), {
        status: input.active ? 'approved' : 'rejected',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function setClientActiveStatus(
  email: string,
  active: boolean
): Promise<void> {
  const cleanEmail = normalizeEmail(email);
  const path = `clients/${cleanEmail}`;
  try {
    await updateDoc(doc(db, 'clients', cleanEmail), {
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAuthorizedClient(email: string): Promise<void> {
  const cleanEmail = normalizeEmail(email);
  const path = `clients/${cleanEmail}`;
  try {
    await deleteDoc(doc(db, 'clients', cleanEmail));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateAccessRequestStatus(
  uid: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const path = `accessRequests/${uid}`;
  try {
    await updateDoc(doc(db, 'accessRequests', uid), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Per-User Cloud Workspace Sync (Playlists & Samplers) ---
export interface CloudWorkspaceData {
  playlists: Playlist[];
  tracksMeta: TrackItem[];
  samplerBanks: SamplerBank[];
  activeBankId: string;
}

function sanitizeTracksForCloud(tracks: TrackItem[]): TrackItem[] {
  return tracks.slice(0, 500).map((t) => {
    const item: TrackItem = {
      id: String(t.id).slice(0, 80),
      name: String(t.name).slice(0, 180),
      durationSec: Number.isFinite(t.durationSec) ? t.durationSec : 180,
      sourceType: t.sourceType,
      isVideo: Boolean(t.isVideo),
      playlistIds: Array.isArray(t.playlistIds) ? t.playlistIds.slice(0, 20) : [],
      hasAiLyrics: Boolean(t.hasAiLyrics),
    };
    if (t.artist) item.artist = String(t.artist).slice(0, 100);
    if (typeof t.bpm === 'number') item.bpm = t.bpm;
    if (t.musicalKey) item.musicalKey = String(t.musicalKey).slice(0, 20);
    if (t.youtubeId) item.youtubeId = String(t.youtubeId).slice(0, 32);
    if (Array.isArray(t.lyrics) && t.lyrics.length > 0) {
      item.lyrics = t.lyrics.slice(0, 160).map((l) => ({
        timeSec: Number(l.timeSec) || 0,
        section: String(l.section || '').slice(0, 40),
        text: String(l.text || '').slice(0, 200),
      }));
    }
    if (t.demoPreset) item.demoPreset = t.demoPreset;
    return item;
  });
}

function sanitizeBanksForCloud(banks: SamplerBank[]): SamplerBank[] {
  return banks.slice(0, 20).map((b) => ({
    id: String(b.id).slice(0, 64),
    name: String(b.name).slice(0, 80),
    pads: b.pads.slice(0, 32).map((p) => {
      const pad: any = {
        id: Number(p.id),
        label: String(p.label || 'Empty').slice(0, 32),
        color: String(p.color || '#181C26').slice(0, 24),
        shortcut: String(p.shortcut || '').slice(0, 8),
        volume: typeof p.volume === 'number' ? p.volume : 1,
      };
      if (p.fxPreset) pad.fxPreset = p.fxPreset;
      if (p.customAudioName) {
        pad.customAudioName = String(p.customAudioName).slice(0, 140);
      }
      return pad;
    }),
  }));
}

export async function loadUserWorkspace(
  uid: string
): Promise<CloudWorkspaceData | null> {
  const path = `userWorkspaces/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'userWorkspaces', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      playlists: Array.isArray(d.playlists) ? d.playlists : [],
      tracksMeta: Array.isArray(d.tracksMeta) ? d.tracksMeta : [],
      samplerBanks: Array.isArray(d.samplerBanks) ? d.samplerBanks : [],
      activeBankId: typeof d.activeBankId === 'string' ? d.activeBankId : '',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserWorkspace(
  user: User,
  data: CloudWorkspaceData
): Promise<void> {
  const cleanEmail = normalizeEmail(user.email);
  if (!cleanEmail) return;
  const path = `userWorkspaces/${user.uid}`;
  const ref = doc(db, 'userWorkspaces', user.uid);

  const playlists = data.playlists.slice(0, 100).map((p) => ({
    id: String(p.id).slice(0, 64),
    name: String(p.name).slice(0, 80),
  }));
  const tracksMeta = sanitizeTracksForCloud(data.tracksMeta);
  const samplerBanks = sanitizeBanksForCloud(data.samplerBanks);
  const activeBankId = String(data.activeBankId || samplerBanks[0]?.id || '').slice(
    0,
    64
  );

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: cleanEmail,
        playlists,
        tracksMeta,
        samplerBanks,
        activeBankId,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        playlists,
        tracksMeta,
        samplerBanks,
        activeBankId,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
