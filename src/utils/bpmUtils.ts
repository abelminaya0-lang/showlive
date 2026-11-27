import { DriveMusicFile } from '../types/showlive';

/**
 * Extracts BPM from DJ-formatted track filenames, e.g.:
 * - "090 - Ya Es Muy Tarde - Smoky.flac" -> 90
 * - "095 - 160. Daddy Yankee - Yo Voy.wav" -> 95
 * - "Salsa Mix [104 BPM].mp3" -> 104
 * - "Cumbia - 98bpm - En Vivo.wav" -> 98
 */
export function extractBpmFromTrackName(name: string): number | null {
  if (!name) return null;
  const clean = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();

  // 1. Explicit BPM tag anywhere ("128 BPM", "95bpm", "104.5 bpm")
  const explicitMatch = clean.match(
    /(?:^|[\s\-_([\]])(\d{2,3}(?:\.\d{1,2})?)\s*bpm(?=$|[\s\-_)\].])/i
  );
  if (explicitMatch) {
    const n = Math.round(Number(explicitMatch[1]));
    if (n >= 55 && n <= 205) return n;
  }

  // 2. Leading BPM prefix ("090 - ...", "095 - 160. ...", "128_...")
  const leadingMatch = clean.match(/^0*(\d{2,3}(?:\.\d)?)\s*[-–_|]/);
  if (leadingMatch) {
    const n = Math.round(Number(leadingMatch[1]));
    if (n >= 55 && n <= 205) return n;
  }

  // 3. Bracketed BPM ("[102]", "(96)")
  const bracketMatch = clean.match(/(?:\[|\()\s*0*(\d{2,3})\s*(?:\]|\))/);
  if (bracketMatch) {
    const n = Number(bracketMatch[1]);
    if (n >= 60 && n <= 195) return n;
  }

  // 4. Delimited standalone 2-3 digit BPM token ("Artist - 102 - Title")
  const tokenRegex = /(?:^|[\s\-_])0*(\d{2,3})(?=[\s\-_]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(clean)) !== null) {
    const n = Number(m[1]);
    if (n >= 65 && n <= 185) return n;
  }

  return null;
}

export type BpmMatchTier = 'exact' | 'good' | 'near' | 'harmonic' | 'none';

export interface BpmMatchResult {
  bpm: number | null;
  tier: BpmMatchTier;
  delta: number;
  label: string;
  score: number; // Lower is better match
}

export function evaluateBpmMatch(
  candidateBpm: number | null,
  referenceBpm: number
): BpmMatchResult {
  if (!candidateBpm || !referenceBpm || referenceBpm <= 0) {
    return {
      bpm: candidateBpm,
      tier: 'none',
      delta: Number.POSITIVE_INFINITY,
      label: '',
      score: 9999,
    };
  }

  const directDelta = Math.abs(candidateBpm - referenceBpm);
  const doubleDelta = Math.abs(candidateBpm * 2 - referenceBpm);
  const halfDelta = Math.abs(candidateBpm / 2 - referenceBpm);
  const harmDelta = Math.min(doubleDelta, halfDelta);

  if (directDelta <= 2) {
    return {
      bpm: candidateBpm,
      tier: 'exact',
      delta: directDelta,
      label: directDelta === 0 ? 'BPM EXACTO' : `±${directDelta} BPM`,
      score: directDelta,
    };
  }

  if (directDelta <= 6) {
    return {
      bpm: candidateBpm,
      tier: 'good',
      delta: directDelta,
      label: `ENCAJA ±${directDelta}`,
      score: directDelta,
    };
  }

  if (harmDelta <= 3) {
    return {
      bpm: candidateBpm,
      tier: 'harmonic',
      delta: Math.round(harmDelta),
      label: candidateBpm > referenceBpm ? 'DOBLE BPM' : 'MITAD BPM',
      score: 6.5 + harmDelta,
    };
  }

  if (directDelta <= 12) {
    return {
      bpm: candidateBpm,
      tier: 'near',
      delta: directDelta,
      label: `±${directDelta} BPM`,
      score: directDelta + 3,
    };
  }

  return {
    bpm: candidateBpm,
    tier: 'none',
    delta: directDelta,
    label: '',
    score: 100 + directDelta,
  };
}

export interface DriveTrackWithBpm {
  file: DriveMusicFile;
  bpm: number | null;
  match: BpmMatchResult | null;
}

export function buildDriveTrackList(
  files: DriveMusicFile[],
  options: {
    sortByBpm: boolean;
    recommendMode: boolean;
    referenceBpm: number | null;
    excludeTrackName?: string | null;
  }
): DriveTrackWithBpm[] {
  const { sortByBpm, recommendMode, referenceBpm, excludeTrackName } = options;

  const enriched: DriveTrackWithBpm[] = files.map((file) => {
    const bpm = extractBpmFromTrackName(file.name);
    const match =
      recommendMode && referenceBpm ? evaluateBpmMatch(bpm, referenceBpm) : null;
    return { file, bpm, match };
  });

  if (recommendMode && referenceBpm) {
    const excludeLower = (excludeTrackName || '').toLowerCase();
    const compatible = enriched.filter((item) => {
      if (excludeLower && item.file.name.toLowerCase() === excludeLower) {
        return false;
      }
      return item.match && item.match.tier !== 'none';
    });

    if (compatible.length > 0) {
      return compatible.sort((a, b) => {
        const sa = a.match?.score ?? 9999;
        const sb = b.match?.score ?? 9999;
        if (sa !== sb) return sa - sb;
        return a.file.name.localeCompare(b.file.name);
      });
    }

    // If no tracks match within tight range, still sort closest BPMs to the top
    return enriched.sort((a, b) => {
      const sa = a.match?.score ?? 9999;
      const sb = b.match?.score ?? 9999;
      if (sa !== sb) return sa - sb;
      return a.file.name.localeCompare(b.file.name);
    });
  }

  if (sortByBpm) {
    return enriched.sort((a, b) => {
      if (a.bpm !== null && b.bpm !== null) {
        if (a.bpm !== b.bpm) return a.bpm - b.bpm;
        return a.file.name.localeCompare(b.file.name);
      }
      if (a.bpm !== null) return -1;
      if (b.bpm !== null) return 1;
      return a.file.name.localeCompare(b.file.name);
    });
  }

  return enriched;
}
