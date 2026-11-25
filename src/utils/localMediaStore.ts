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

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
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
  } catch {
    // Ignore IndexedDB quota or private-mode errors
  }
}

export async function saveMediaBlobsBatch(
  entries: Array<{ key: string; blob: Blob }>
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      const store = tx.objectStore(BLOB_STORE);
      for (const entry of entries) {
        store.put(entry.blob, entry.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readonly');
      const req = tx.objectStore(BLOB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
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
        // Strip transient object URLs before saving; loaded lazily from IndexedDB when needed
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

    // Tracks metadata loads instantaneously; media Blobs are fetched on-demand when loaded to a Deck
    const tracks = parsed.tracks || [];

    // Rehydrate only custom sampler pad audio in one shared IndexedDB transaction
    const padKeys: Array<{ bankIdx: number; padIdx: number; key: string }> = [];
    const banks = parsed.samplerBanks || [];
    banks.forEach((bank, bankIdx) => {
      bank.pads.forEach((pad, padIdx) => {
        if (pad.customAudioName) {
          padKeys.push({ bankIdx, padIdx, key: `pad:${bank.id}:${pad.id}` });
        }
      });
    });

    const rehydratedBanks: SamplerBank[] = banks.map((b) => ({
      ...b,
      pads: b.pads.map((p) => ({ ...p })),
    }));

    if (padKeys.length > 0) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
          const tx = db.transaction(BLOB_STORE, 'readonly');
          const store = tx.objectStore(BLOB_STORE);
          for (const item of padKeys) {
            const req = store.get(item.key);
            req.onsuccess = () => {
              const blob = req.result as Blob | undefined;
              if (blob) {
                rehydratedBanks[item.bankIdx].pads[item.padIdx].customAudioUrl =
                  URL.createObjectURL(blob);
              }
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } catch {
        // Ignore IDB errors
      }
    }

    return {
      playlists: parsed.playlists || [],
      tracks,
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
