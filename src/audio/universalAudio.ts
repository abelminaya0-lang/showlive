import { encodeWav } from './demoTracks';

const VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|avi|m4v|flv|3gp)$/i;

function readAscii(bytes: Uint8Array, offset: number, len: number): string {
  let out = '';
  const end = Math.min(bytes.length, offset + len);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readUint32BE(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readUint16BE(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

/**
 * Parses 80-bit IEEE 754 extended floating point (used for AIFF sampleRate).
 */
function parseExtended80(bytes: Uint8Array, offset: number): number {
  if (offset + 10 > bytes.length) return 44100;
  const expon = ((bytes[offset] & 0x7f) << 8) | bytes[offset + 1];
  let hiMant = 0;
  let loMant = 0;
  for (let i = 2; i < 6; i++) hiMant = hiMant * 256 + bytes[offset + i];
  for (let i = 6; i < 10; i++) loMant = loMant * 256 + bytes[offset + i];
  if (expon === 0 && hiMant === 0 && loMant === 0) return 0;
  const exp = expon - 16383;
  const val = hiMant * Math.pow(2, exp - 31) + loMant * Math.pow(2, exp - 63);
  return bytes[offset] & 0x80 ? -val : val;
}

export function inferStandardMimeFromName(fileName: string, mimeHint?: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mp3') || lower.endsWith('.mp2')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 'audio/aiff';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.m4a') || lower.endsWith('.m4b') || lower.endsWith('.alac')) {
    return 'audio/mp4';
  }
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga') || lower.endsWith('.opus')) {
    return 'audio/ogg';
  }
  if (lower.endsWith('.wma')) return 'audio/x-ms-wma';
  if (lower.endsWith('.amr')) return 'audio/amr';
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.flv')) return 'video/x-flv';
  if (lower.endsWith('.3gp')) return 'video/3gpp';

  const hint = (mimeHint || '').toLowerCase();
  if (hint === 'audio/x-wav' || hint === 'audio/wave') return 'audio/wav';
  if (hint === 'audio/mp3' || hint === 'audio/x-mpeg') return 'audio/mpeg';
  if (hint === 'audio/x-flac') return 'audio/flac';
  if (hint === 'audio/x-m4a') return 'audio/mp4';
  if (hint === 'audio/x-aac') return 'audio/aac';
  if (hint.startsWith('audio/') || hint.startsWith('video/')) return hint;
  return VIDEO_EXT_RE.test(lower) ? 'video/mp4' : 'audio/mpeg';
}

export function sniffMediaTypeFromHeader(
  header: Uint8Array,
  fileName: string,
  mimeHint?: string
): { mimeType: string; isVideo: boolean; isHtml: boolean; container: string } {
  const txtHead = readAscii(header, 0, 32).trimStart().toLowerCase();
  if (txtHead.startsWith('<!doctype') || txtHead.startsWith('<html')) {
    return { mimeType: 'text/html', isVideo: false, isHtml: true, container: 'html' };
  }

  const riff = readAscii(header, 0, 4);
  const sub = readAscii(header, 8, 4);

  if (riff === 'RIFF' && sub === 'WAVE') {
    return { mimeType: 'audio/wav', isVideo: false, isHtml: false, container: 'wav' };
  }
  if (riff === 'RIFF' && sub === 'AVI ') {
    return { mimeType: 'video/x-msvideo', isVideo: true, isHtml: false, container: 'avi' };
  }
  if (riff === 'FORM' && (sub === 'AIFF' || sub === 'AIFC')) {
    return { mimeType: 'audio/aiff', isVideo: false, isHtml: false, container: 'aiff' };
  }
  if (riff === 'fLaC') {
    return { mimeType: 'audio/flac', isVideo: false, isHtml: false, container: 'flac' };
  }
  if (riff === 'OggS') {
    return { mimeType: 'audio/ogg', isVideo: false, isHtml: false, container: 'ogg' };
  }
  if (riff === '#!AM') {
    return { mimeType: 'audio/amr', isVideo: false, isHtml: false, container: 'amr' };
  }
  if (readAscii(header, 0, 3) === 'ID3') {
    return { mimeType: 'audio/mpeg', isVideo: false, isHtml: false, container: 'mp3' };
  }
  if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) {
    return { mimeType: 'audio/mpeg', isVideo: false, isHtml: false, container: 'mp3' };
  }
  if (readAscii(header, 4, 4) === 'ftyp') {
    const isVid =
      VIDEO_EXT_RE.test(fileName) || (mimeHint || '').toLowerCase().startsWith('video/');
    return {
      mimeType: isVid ? 'video/mp4' : 'audio/mp4',
      isVideo: isVid,
      isHtml: false,
      container: 'mp4',
    };
  }
  if (
    header.length >= 4 &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3
  ) {
    const isVid =
      VIDEO_EXT_RE.test(fileName) || (mimeHint || '').toLowerCase().startsWith('video/');
    return {
      mimeType: isVid ? 'video/webm' : 'audio/webm',
      isVideo: isVid,
      isHtml: false,
      container: 'ebml',
    };
  }
  if (
    header.length >= 4 &&
    header[0] === 0x30 &&
    header[1] === 0x26 &&
    header[2] === 0xb2 &&
    header[3] === 0x75
  ) {
    return { mimeType: 'audio/x-ms-wma', isVideo: false, isHtml: false, container: 'asf' };
  }

  const inferred = inferStandardMimeFromName(fileName, mimeHint);
  return {
    mimeType: inferred,
    isVideo: inferred.startsWith('video/'),
    isHtml: false,
    container: 'unknown',
  };
}

function decodePcmSamplesToChannels(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
  channels: number,
  bitsPerSample: number,
  littleEndian: boolean,
  isFloat: boolean
): [Float32Array, Float32Array] | null {
  const bytesPerSample = Math.ceil(bitsPerSample / 8);
  const blockAlign = bytesPerSample * channels;
  if (blockAlign <= 0) return null;

  const avail = Math.min(dataLength, bytes.length - dataOffset);
  const frameCount = Math.floor(avail / blockAlign);
  if (frameCount <= 0) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);

  const readSample = (pos: number): number => {
    if (isFloat) {
      if (bitsPerSample === 32) return view.getFloat32(pos, littleEndian);
      if (bitsPerSample === 64) return view.getFloat64(pos, littleEndian);
    }
    if (bitsPerSample === 8) {
      return littleEndian ? (bytes[pos] - 128) / 128 : (view.getInt8(pos) || 0) / 128;
    }
    if (bitsPerSample === 16) {
      return view.getInt16(pos, littleEndian) / 32768;
    }
    if (bitsPerSample === 24) {
      const b0 = bytes[pos];
      const b1 = bytes[pos + 1];
      const b2 = bytes[pos + 2];
      let val = littleEndian ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
      if (val & 0x800000) val |= ~0xffffff;
      return val / 8388608;
    }
    if (bitsPerSample === 32) {
      return view.getInt32(pos, littleEndian) / 2147483648;
    }
    return 0;
  };

  for (let i = 0; i < frameCount; i++) {
    const framePos = dataOffset + i * blockAlign;
    const sL = readSample(framePos);
    const sR = channels > 1 ? readSample(framePos + bytesPerSample) : sL;
    left[i] = Math.max(-1, Math.min(1, sL));
    right[i] = Math.max(-1, Math.min(1, sR));
  }
  return [left, right];
}

/**
 * Pure-TS instant decoder for AIFF/AIFC and non-standard WAV (WAVE_FORMAT_EXTENSIBLE 0xFFFE,
 * 24-bit/32-bit PCM, IEEE float) into universally playable 16-bit PCM WAV Blob.
 */
export async function convertSpecialPcmToWavBlob(blob: Blob): Promise<Blob | null> {
  if (blob.size < 44) return null;
  const headerBuf = await blob.slice(0, 16).arrayBuffer();
  const header = new Uint8Array(headerBuf);
  const riff = readAscii(header, 0, 4);
  const sub = readAscii(header, 8, 4);

  if (riff === 'FORM' && (sub === 'AIFF' || sub === 'AIFC')) {
    const fullBuf = await blob.arrayBuffer();
    const bytes = new Uint8Array(fullBuf);
    const view = new DataView(fullBuf);

    let offset = 12;
    let channels = 2;
    let bitsPerSample = 16;
    let sampleRate = 44100;
    let compression = 'NONE';
    let ssndOffset = -1;
    let ssndSize = 0;

    while (offset + 8 <= bytes.length) {
      const id = readAscii(bytes, offset, 4);
      const size = readUint32BE(view, offset + 4);
      const payload = offset + 8;

      if (id === 'COMM' && payload + 18 <= bytes.length) {
        channels = readUint16BE(view, payload);
        bitsPerSample = readUint16BE(view, payload + 6);
        sampleRate = Math.round(parseExtended80(bytes, payload + 8)) || 44100;
        if (sub === 'AIFC' && size >= 22 && payload + 22 <= bytes.length) {
          compression = readAscii(bytes, payload + 18, 4);
        }
      } else if (id === 'SSND' && payload + 8 <= bytes.length) {
        const innerOffset = readUint32BE(view, payload);
        ssndOffset = payload + 8 + innerOffset;
        ssndSize = Math.max(0, size - 8 - innerOffset);
      }

      offset = payload + size + (size % 2);
    }

    if (ssndOffset < 0 || ssndSize <= 0) return null;

    const compLower = compression.toLowerCase();
    const isSupportedPcm =
      compression === 'NONE' ||
      compLower === 'sowt' ||
      compLower === 'twos' ||
      compLower === 'raw ' ||
      compLower === 'fl32' ||
      compLower === 'fl64';
    if (!isSupportedPcm) return null;

    const littleEndian = compLower === 'sowt';
    const isFloat = compLower === 'fl32' || compLower === 'fl64';
    const decoded = decodePcmSamplesToChannels(
      bytes,
      ssndOffset,
      ssndSize,
      channels,
      bitsPerSample,
      littleEndian,
      isFloat
    );
    if (!decoded) return null;

    return encodeWav(decoded[0], decoded[1], sampleRate);
  }

  if (riff === 'RIFF' && sub === 'WAVE') {
    const probeLen = Math.min(blob.size, 8192);
    const probeBuf = await blob.slice(0, probeLen).arrayBuffer();
    const probeBytes = new Uint8Array(probeBuf);
    const probeView = new DataView(probeBuf);

    let offset = 12;
    let formatTag = 1;
    let channels = 2;
    let sampleRate = 44100;
    let bitsPerSample = 16;
    let realSubFormat = 1;
    let foundFmt = false;

    while (offset + 8 <= probeBytes.length) {
      const id = readAscii(probeBytes, offset, 4);
      const size = probeView.getUint32(offset + 4, true);
      const payload = offset + 8;
      if (id === 'fmt ' && payload + 16 <= probeBytes.length) {
        foundFmt = true;
        formatTag = probeView.getUint16(payload, true);
        channels = probeView.getUint16(payload + 2, true);
        sampleRate = probeView.getUint32(payload + 4, true) || 44100;
        bitsPerSample = probeView.getUint16(payload + 14, true);
        if (formatTag === 0xfffe && size >= 40 && payload + 26 <= probeBytes.length) {
          realSubFormat = probeView.getUint16(payload + 24, true);
        }
        break;
      }
      offset = payload + size + (size % 2);
    }

    if (!foundFmt) return null;

    // Standard 8-bit or 16-bit PCM WAV plays natively everywhere without conversion
    if (formatTag === 1 && bitsPerSample <= 16) {
      return null;
    }

    const effectiveFormat = formatTag === 0xfffe ? realSubFormat : formatTag;
    if (effectiveFormat !== 1 && effectiveFormat !== 3) {
      // Compressed WAV (ADPCM, MP3-in-WAV, etc.): let server ffmpeg handle if needed
      return null;
    }

    const fullBuf = await blob.arrayBuffer();
    const bytes = new Uint8Array(fullBuf);
    const view = new DataView(fullBuf);
    offset = 12;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= bytes.length) {
      const id = readAscii(bytes, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const payload = offset + 8;
      if (id === 'data') {
        dataOffset = payload;
        dataSize = size;
        break;
      }
      offset = payload + size + (size % 2);
    }

    if (dataOffset < 0 || dataSize <= 0) return null;
    const decoded = decodePcmSamplesToChannels(
      bytes,
      dataOffset,
      dataSize,
      channels,
      bitsPerSample,
      true,
      effectiveFormat === 3
    );
    if (!decoded) return null;

    return encodeWav(decoded[0], decoded[1], sampleRate);
  }

  return null;
}

export async function transcodeBlobViaServer(blob: Blob, fileName: string): Promise<Blob> {
  const res = await fetch('/api/audio/transcode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName || 'track.bin'),
    },
    body: blob,
  });

  if (!res.ok) {
    let msg = 'No se pudo convertir este archivo de audio para reproducirlo.';
    try {
      const json = await res.json();
      if (json?.error) msg = String(json.error);
    } catch {
      // Ignore parse error
    }
    throw new Error(msg);
  }

  const outBlob = await res.blob();
  if (!outBlob.size) {
    throw new Error('La conversión del archivo devolvió audio vacío.');
  }
  return new Blob([outBlob], { type: 'audio/mpeg' });
}

function browserCanPlayMimeNatively(mimeType: string): boolean {
  if (typeof document === 'undefined') return true;
  if (
    mimeType === 'audio/aiff' ||
    mimeType === 'audio/x-ms-wma' ||
    mimeType === 'audio/amr' ||
    mimeType === 'video/x-msvideo' ||
    mimeType === 'video/x-flv'
  ) {
    return false;
  }
  const probe = document.createElement(mimeType.startsWith('video/') ? 'video' : 'audio');
  return probe.canPlayType(mimeType) !== '';
}

export async function ensurePlayableMediaBlob(
  rawBlob: Blob,
  fileName: string,
  mimeHint?: string
): Promise<{ blob: Blob; mimeType: string; isVideo: boolean }> {
  if (!rawBlob || rawBlob.size === 0) {
    throw new Error(`El archivo "${fileName}" está vacío (0 bytes).`);
  }

  const headerBuf = await rawBlob.slice(0, 64).arrayBuffer();
  const header = new Uint8Array(headerBuf);
  const sniffed = sniffMediaTypeFromHeader(header, fileName, mimeHint);

  if (sniffed.isHtml) {
    throw new Error(
      `Google Drive no entregó el audio de "${fileName}" (posible restricción o acceso expirado).`
    );
  }

  // Try instant pure-TS PCM conversion for AIFF or 24-bit/32-bit/Extensible WAV
  if (sniffed.container === 'aiff' || sniffed.container === 'wav') {
    const convertedWav = await convertSpecialPcmToWavBlob(rawBlob);
    if (convertedWav) {
      return { blob: convertedWav, mimeType: 'audio/wav', isVideo: false };
    }
  }

  // If browser doesn't support this container natively (WMA, AVI, FLV, AMR, exotic AIFF, etc.),
  // convert via server FFmpeg immediately so it plays cleanly on first try.
  if (!browserCanPlayMimeNatively(sniffed.mimeType)) {
    const mp3Blob = await transcodeBlobViaServer(rawBlob, fileName);
    return { blob: mp3Blob, mimeType: 'audio/mpeg', isVideo: false };
  }

  const normalizedBlob =
    rawBlob.type === sniffed.mimeType
      ? rawBlob
      : new Blob([rawBlob], { type: sniffed.mimeType });

  return {
    blob: normalizedBlob,
    mimeType: sniffed.mimeType,
    isVideo: sniffed.isVideo,
  };
}

/**
 * Fallback recovery invoked by DeckPanel if <video> fails to decode or play any track
 * (e.g., ALAC inside .m4a, AC3 inside .mp4/.mkv, uncommon codecs, or wrong container tags).
 */
export async function recoverPlayableObjectUrl(
  sourceUrl: string,
  fileName: string
): Promise<string> {
  const res = await fetch(sourceUrl);
  const rawBlob = await res.blob();
  if (!rawBlob.size) {
    throw new Error(`El archivo "${fileName}" está vacío.`);
  }

  // 1. Try pure-TS AIFF / non-standard WAV converter
  const pcmWav = await convertSpecialPcmToWavBlob(rawBlob);
  if (pcmWav) {
    return URL.createObjectURL(pcmWav);
  }

  // 2. Try Web Audio decodeAudioData -> standard WAV
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      try {
        const arr = await rawBlob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        const ch0 = decoded.getChannelData(0);
        const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : ch0;
        const wavBlob = encodeWav(ch0, ch1, decoded.sampleRate);
        return URL.createObjectURL(wavBlob);
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  } catch {
    // Fall through to FFmpeg server transcode
  }

  // 3. Universal server FFmpeg transcode to 320kbps MP3
  const mp3Blob = await transcodeBlobViaServer(rawBlob, fileName);
  return URL.createObjectURL(mp3Blob);
}
