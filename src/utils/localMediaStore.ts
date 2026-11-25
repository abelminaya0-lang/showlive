import { Playlist, SamplerBank, TrackItem } from '../types/showlive';

const DB_NAME = 'showlive_local_db';
const DB_VERSION = 1;
const BLOB_STORE = 'media_blobs';
const STATE_KEY = 'showlive_library_state_v1';

export interface PersistedLibraryState {
  playlists: Playlist[];
  tracks: TrackItem[];
  samplerBanks: SamplerBank[];
  activeBankId: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore IndexedDB quota or private-mode errors
  }
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readonly');
      const req = tx.objectStore(BLOB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

export async function deleteMediaBlob(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function clearAllMediaBlobs(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export function savePersistedState(state: PersistedLibraryState): void {
  try {
    const sanitized: PersistedLibraryState = {
      playlists: state.playlists,
      activeBankId: state.activeBankId,
      tracks: state.tracks.map((t) => ({
        ...t,
        // Strip transient object URLs before saving; rehydrated from IndexedDB on load
        audioUrl: t.sourceType === 'file' ? undefined : t.audioUrl,
        videoUrl: t.sourceType === 'file' ? undefined : t.videoUrl,
      })),
      samplerBanks: state.samplerBanks.map((b) => ({
        ...b,
        pads: b.pads.map((p) => ({
          ...p,
          customAudioUrl: undefined,
        })),
      })),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage limit errors
  }
}

export async function loadPersistedState(): Promise<PersistedLibraryState | null> {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLibraryState;

    // Rehydrate track object URLs from IndexedDB
    const rehydratedTracks: TrackItem[] = [];
    for (const trk of parsed.tracks || []) {
      if (trk.sourceType === 'file') {
        const blob = await getMediaBlob(`track:${trk.id}`);
        if (!blob) continue; // Skip missing local files
        const url = URL.createObjectURL(blob);
        rehydratedTracks.push({
          ...trk,
          audioUrl: trk.isVideo ? undefined : url,
          videoUrl: trk.isVideo ? url : undefined,
        });
      } else {
        rehydratedTracks.push(trk);
      }
    }

    // Rehydrate sampler pad custom audio URLs from IndexedDB
    const rehydratedBanks: SamplerBank[] = [];
    for (const bank of parsed.samplerBanks || []) {
      const pads = await Promise.all(
        bank.pads.map(async (pad) => {
          if (pad.customAudioName) {
            const blob = await getMediaBlob(`pad:${bank.id}:${pad.id}`);
            if (blob) {
              return { ...pad, customAudioUrl: URL.createObjectURL(blob) };
            }
          }
          return pad;
        })
      );
      rehydratedBanks.push({ ...bank, pads });
    }

    return {
      playlists: parsed.playlists || [],
      tracks: rehydratedTracks,
      samplerBanks: rehydratedBanks,
      activeBankId: parsed.activeBankId || rehydratedBanks[0]?.id || '',
    };
  } catch {
    return null;
  }
}

export async function clearPersistedState(): Promise<void> {
  localStorage.removeItem(STATE_KEY);
  await clearAllMediaBlobs();
}
