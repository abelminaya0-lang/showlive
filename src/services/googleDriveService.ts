import { DriveFolder, DriveMusicFile } from '../types/showlive';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';

export class DriveAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'DriveAuthError';
    this.status = status;
  }
}

interface CachedMediaEntry {
  objectUrl: string;
  durationSec: number;
  isVideo: boolean;
}

const driveMediaCache = new Map<string, CachedMediaEntry>();

export function clearDriveMediaCache() {
  driveMediaCache.forEach((entry) => {
    if (entry.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  });
  driveMediaCache.clear();
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function parseDriveError(res: Response): Promise<never> {
  let msg = `Error de Google Drive (${res.status})`;
  try {
    const json = await res.json();
    if (json?.error?.message) {
      msg = String(json.error.message);
    }
  } catch {
    // Ignore JSON parse errors
  }

  if (res.status === 401 || res.status === 403) {
    throw new DriveAuthError(
      res.status === 401
        ? 'Tu sesión de Google Drive expiró. Pulsa el botón de Google para volver a conectar.'
        : `Permiso denegado en Google Drive: ${msg}`,
      res.status
    );
  }
  throw new Error(msg);
}

export async function listDriveFolders(token: string): Promise<DriveFolder[]> {
  const params = new URLSearchParams({
    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name,parents)',
    pageSize: '500',
    orderBy: 'name',
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });

  const res = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    await parseDriveError(res);
  }

  const data = await res.json();
  return Array.isArray(data.files) ? (data.files as DriveFolder[]) : [];
}

export function getDescendantFolderIds(
  rootFolderId: string,
  allFolders: DriveFolder[],
  maxIds = 25
): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const folder of allFolders) {
    if (!folder.parents?.length) continue;
    for (const parentId of folder.parents) {
      const list = childrenMap.get(parentId);
      if (list) {
        list.push(folder.id);
      } else {
        childrenMap.set(parentId, [folder.id]);
      }
    }
  }

  const visited = new Set<string>([rootFolderId]);
  const queue: string[] = [rootFolderId];
  while (queue.length > 0 && visited.size < maxIds) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) || [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
        if (visited.size >= maxIds) break;
      }
    }
  }

  return Array.from(visited);
}

export interface ListDriveMusicOptions {
  query?: string;
  folderId?: string | null;
  folderIds?: string[];
  pageToken?: string | null;
  pageSize?: number;
}

export interface ListDriveMusicResult {
  files: DriveMusicFile[];
  nextPageToken: string | null;
}

export async function listDriveMusicFiles(
  token: string,
  options: ListDriveMusicOptions = {}
): Promise<ListDriveMusicResult> {
  const { query, folderId, folderIds, pageToken, pageSize = 100 } = options;

  const mediaFilter =
    "(mimeType contains 'audio/' or mimeType contains 'video/' or fileExtension = 'mp3' or fileExtension = 'wav' or fileExtension = 'm4a' or fileExtension = 'ogg' or fileExtension = 'flac' or fileExtension = 'aac' or fileExtension = 'wma' or fileExtension = 'opus' or fileExtension = 'aiff' or fileExtension = 'aif' or fileExtension = 'alac' or fileExtension = 'm4b' or fileExtension = 'mp2' or fileExtension = 'amr' or fileExtension = 'mp4' or fileExtension = 'mov' or fileExtension = 'webm' or fileExtension = 'mkv' or fileExtension = 'avi' or fileExtension = 'm4v' or fileExtension = 'flv' or fileExtension = '3gp')";

  const clauses = ['trashed = false', mediaFilter];

  const targetFolders =
    folderIds && folderIds.length > 0
      ? folderIds.slice(0, 25)
      : folderId
      ? [folderId]
      : [];

  if (targetFolders.length === 1) {
    clauses.push(`'${escapeDriveQueryValue(targetFolders[0])}' in parents`);
  } else if (targetFolders.length > 1) {
    const parentOr = targetFolders
      .map((id) => `'${escapeDriveQueryValue(id)}' in parents`)
      .join(' or ');
    clauses.push(`(${parentOr})`);
  }

  const trimmed = query?.trim();
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean).slice(0, 8);
    for (const word of words) {
      const escaped = escapeDriveQueryValue(word);
      clauses.push(`name contains '${escaped}'`);
    }
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,fileExtension)',
    pageSize: String(pageSize),
    orderBy: 'name',
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const res = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    await parseDriveError(res);
  }

  const data = await res.json();
  return {
    files: Array.isArray(data.files) ? (data.files as DriveMusicFile[]) : [],
    nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
  };
}

function inferIsVideo(file: DriveMusicFile): boolean {
  const mime = (file.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  if (mime.startsWith('audio/')) return false;
  return /\.(mp4|webm|mkv|mov|avi|m4v|flv|3gp)$/i.test(file.name);
}

function inferMimeType(file: DriveMusicFile): string {
  if (file.mimeType && (file.mimeType.startsWith('audio/') || file.mimeType.startsWith('video/'))) {
    return file.mimeType;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.mp3') || lower.endsWith('.mp2')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.m4b') || lower.endsWith('.alac')) return 'audio/mp4';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 'audio/aiff';
  if (lower.endsWith('.wma')) return 'audio/x-ms-wma';
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  return inferIsVideo(file) ? 'video/mp4' : 'audio/mpeg';
}

async function probeMediaDuration(objectUrl: string, isVideo: boolean): Promise<number> {
  return new Promise<number>((resolve) => {
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.preload = 'metadata';
    const timer = window.setTimeout(() => resolve(180), 2500);
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 180);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      resolve(180);
    };
    el.src = objectUrl;
  });
}

export async function downloadDriveMediaObjectUrl(
  token: string,
  file: DriveMusicFile
): Promise<CachedMediaEntry> {
  const cached = driveMediaCache.get(file.id);
  if (cached) {
    return cached;
  }

  const url = `${DRIVE_FILES_API}/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    await parseDriveError(res);
  }

  const rawBlob = await res.blob();
  const isVideo = inferIsVideo(file);
  const typedBlob =
    rawBlob.type && rawBlob.type !== 'application/octet-stream'
      ? rawBlob
      : new Blob([rawBlob], { type: inferMimeType(file) });

  const objectUrl = URL.createObjectURL(typedBlob);
  const durationSec = await probeMediaDuration(objectUrl, isVideo);

  const entry: CachedMediaEntry = {
    objectUrl,
    durationSec,
    isVideo,
  };
  driveMediaCache.set(file.id, entry);
  return entry;
}

export function formatDriveFileSize(sizeStr?: string): string {
  if (!sizeStr) return '';
  const bytes = Number(sizeStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
