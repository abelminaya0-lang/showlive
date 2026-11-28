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

  if (directDelta === 0) {
    return {
      bpm: candidateBpm,
      tier: 'exact',
      delta: 0,
      label: `MISMO BPM · ${candidateBpm}`,
      score: 0,
    };
  }

  if (directDelta <= 2) {
    return {
      bpm: candidateBpm,
      tier: 'good',
      delta: directDelta,
      label: `±${directDelta} BPM`,
      score: directDelta,
    };
  }

  if (directDelta <= 6) {
    return {
      bpm: candidateBpm,
      tier: 'near',
      delta: directDelta,
      label: `±${directDelta} BPM`,
      score: directDelta + 2,
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
    strictExactOnly?: boolean;
  }
): DriveTrackWithBpm[] {
  const {
    sortByBpm,
    recommendMode,
    referenceBpm,
    excludeTrackName,
    strictExactOnly = true,
  } = options;

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
      if (!item.match) return false;
      if (strictExactOnly) {
        return item.match.tier === 'exact';
      }
      return item.match.tier === 'exact' || item.match.tier === 'good';
    });

    return compatible.sort((a, b) => {
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

export interface TempoSyncResult {
  compatible: boolean;
  ratio: number; // playbackRate applied to incoming track (0.85..1.18)
  targetBpm: number;
  incomingBaseBpm: number;
  effectiveIncomingBpm: number;
  mode: 'exact' | 'direct' | 'double' | 'half' | 'fallback';
  pctDiff: number;
  label: string;
}

/**
 * Computes the playbackRate ratio needed to beatmatch `incomingBpm` to `outgoingBpm`.
 * Supports direct 1:1 matching as well as half-time / double-time (2x / 0.5x) DJ transitions.
 */
export function computeTempoSync(
  outgoingBpm: number | null | undefined,
  incomingBpm: number | null | undefined
): TempoSyncResult {
  const out = outgoingBpm && outgoingBpm > 40 ? outgoingBpm : 0;
  const inc = incomingBpm && incomingBpm > 40 ? incomingBpm : 0;

  if (!out || !inc) {
    return {
      compatible: true,
      ratio: 1,
      targetBpm: out || inc || 100,
      incomingBaseBpm: inc || out || 100,
      effectiveIncomingBpm: inc || out || 100,
      mode: 'fallback',
      pctDiff: 0,
      label: inc ? `${Math.round(inc)} BPM` : 'AUTO SYNC',
    };
  }

  const candidates: Array<{
    effBpm: number;
    ratio: number;
    mode: 'exact' | 'direct' | 'double' | 'half';
    penalty: number;
  }> = [
    { effBpm: inc, ratio: out / inc, mode: Math.abs(out - inc) < 0.5 ? 'exact' : 'direct', penalty: 0 },
    { effBpm: inc * 2, ratio: out / (inc * 2), mode: 'double', penalty: 0.04 },
    { effBpm: inc * 0.5, ratio: out / (inc * 0.5), mode: 'half', penalty: 0.04 },
  ];

  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const score = Math.abs(1 - c.ratio) + c.penalty;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  const compatible = best.ratio >= 0.84 && best.ratio <= 1.18;
  const clampedRatio = Number(Math.max(0.85, Math.min(1.18, best.ratio)).toFixed(3));
  const pctDiff = Math.round((clampedRatio - 1) * 1000) / 10;
  const pctText =
    pctDiff === 0 ? '0%' : `${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(1)}%`;

  const label =
    best.mode === 'exact'
      ? `${Math.round(inc)} BPM (Exacto)`
      : best.mode === 'double'
      ? `${Math.round(inc)}×2 → ${Math.round(out)} BPM (${pctText})`
      : best.mode === 'half'
      ? `${Math.round(inc)}÷2 → ${Math.round(out)} BPM (${pctText})`
      : `${Math.round(inc)} → ${Math.round(out)} BPM (${pctText})`;

  return {
    compatible,
    ratio: clampedRatio,
    targetBpm: Math.round(out),
    incomingBaseBpm: Math.round(inc),
    effectiveIncomingBpm: Math.round(best.effBpm),
    mode: best.mode,
    pctDiff,
    label,
  };
}

export interface AutoDjCandidateLike {
  id: string;
  name: string;
  bpm?: number | null;
}

/**
 * Picks the smartest next song from a folder for Auto DJ:
 * avoids repeats until the whole folder has played, and picks the closest
 * beatmatch-compatible BPM so transitions sound seamless like a real club DJ.
 */
export function pickNextAutoDjCandidate<T extends AutoDjCandidateLike>(
  pool: T[],
  options: {
    currentId?: string | null;
    excludeId?: string | null;
    outgoingBpm?: number | null;
    playedIds?: Set<string>;
  }
): { item: T; sync: TempoSyncResult; resetCycle: boolean } | null {
  if (!pool || pool.length === 0) return null;

  const { currentId, excludeId, outgoingBpm, playedIds } = options;

  let unplayed = pool.filter(
    (item) =>
      item.id !== currentId &&
      item.id !== excludeId &&
      !(playedIds && playedIds.has(item.id))
  );

  let resetCycle = false;
  if (unplayed.length === 0) {
    resetCycle = true;
    unplayed = pool.filter((item) => item.id !== currentId && item.id !== excludeId);
    if (unplayed.length === 0) {
      unplayed = pool.filter((item) => item.id !== currentId);
    }
    if (unplayed.length === 0) {
      unplayed = pool;
    }
  }

  const refBpm = outgoingBpm && outgoingBpm > 40 ? outgoingBpm : null;
  if (!refBpm) {
    const first = unplayed[0];
    const firstBpm = first.bpm ?? extractBpmFromTrackName(first.name);
    return {
      item: first,
      sync: computeTempoSync(null, firstBpm),
      resetCycle,
    };
  }

  let bestItem = unplayed[0];
  let bestSync = computeTempoSync(
    refBpm,
    bestItem.bpm ?? extractBpmFromTrackName(bestItem.name)
  );
  let bestCost = Number.POSITIVE_INFINITY;

  unplayed.forEach((item, idx) => {
    const candBpm = item.bpm ?? extractBpmFromTrackName(item.name);
    const sync = computeTempoSync(refBpm, candBpm);
    // Prefer known BPMs with minimal tempo stretch, gentle tie-breaker by folder order
    const unknownPenalty = candBpm ? 0 : 0.22;
    const incompatiblePenalty = sync.compatible ? 0 : 1.5;
    const modePenalty = sync.mode === 'double' || sync.mode === 'half' ? 0.05 : 0;
    const orderBias = idx * 0.002;
    const cost =
      Math.abs(1 - sync.ratio) + unknownPenalty + incompatiblePenalty + modePenalty + orderBias;

    if (cost < bestCost) {
      bestCost = cost;
      bestItem = item;
      bestSync = sync;
    }
  });

  return {
    item: bestItem,
    sync: bestSync,
    resetCycle,
  };
}

