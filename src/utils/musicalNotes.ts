export interface MusicalNoteInfo {
  index: number; // 0..11 (0 = C / Do)
  latin: string;
  intl: string;
}

export const CHROMATIC_NOTES: MusicalNoteInfo[] = [
  { index: 0, latin: 'Do', intl: 'C' },
  { index: 1, latin: 'Do#', intl: 'C#' },
  { index: 2, latin: 'Re', intl: 'D' },
  { index: 3, latin: 'Mib', intl: 'Eb' },
  { index: 4, latin: 'Mi', intl: 'E' },
  { index: 5, latin: 'Fa', intl: 'F' },
  { index: 6, latin: 'Fa#', intl: 'F#' },
  { index: 7, latin: 'Sol', intl: 'G' },
  { index: 8, latin: 'Sol#', intl: 'G#' },
  { index: 9, latin: 'La', intl: 'A' },
  { index: 10, latin: 'Sib', intl: 'Bb' },
  { index: 11, latin: 'Si', intl: 'B' },
];

const KEY_ALIASES: Record<string, number> = {
  c: 0, do: 0,
  'c#': 1, db: 1, 'do#': 1, reb: 1,
  d: 2, re: 2,
  'd#': 3, eb: 3, 're#': 3, mib: 3,
  e: 4, mi: 4,
  f: 5, fa: 5,
  'f#': 6, gb: 6, 'fa#': 6, solb: 6,
  g: 7, sol: 7,
  'g#': 8, ab: 8, 'sol#': 8, lab: 8,
  a: 9, la: 9,
  'a#': 10, bb: 10, 'la#': 10, sib: 10,
  b: 11, si: 11,
};

export interface ParsedKey {
  rootIndex: number;
  isMinor: boolean;
}

export function parseMusicalKey(rawKey?: string): ParsedKey {
  if (!rawKey || !rawKey.trim()) {
    return { rootIndex: 0, isMinor: false }; // Default Do (C)
  }
  const cleaned = rawKey.trim().toLowerCase().replace(/\s+/g, '');
  const isMinor =
    cleaned.endsWith('m') ||
    cleaned.includes('min') ||
    cleaned.includes('men');
  const notePart = cleaned
    .replace(/menor|minor|min|mayor|major|maj|m$/g, '')
    .trim();

  const rootIndex = KEY_ALIASES[notePart] ?? 0;
  return { rootIndex, isMinor };
}

export function formatKeyLatin(rootIndex: number, isMinor: boolean): string {
  const norm = ((rootIndex % 12) + 12) % 12;
  const note = CHROMATIC_NOTES[norm];
  return `${note.latin}${isMinor ? 'm' : ''}`;
}

export function formatKeyIntl(rootIndex: number, isMinor: boolean): string {
  const norm = ((rootIndex % 12) + 12) % 12;
  const note = CHROMATIC_NOTES[norm];
  return `${note.intl}${isMinor ? 'm' : ''}`;
}

export function getTransposedKey(
  baseKey: string | undefined,
  semitones: number
): {
  base: ParsedKey;
  targetIndex: number;
  latin: string;
  intl: string;
} {
  const base = parseMusicalKey(baseKey);
  const targetIndex = (((base.rootIndex + semitones) % 12) + 12) % 12;
  return {
    base,
    targetIndex,
    latin: formatKeyLatin(targetIndex, base.isMinor),
    intl: formatKeyIntl(targetIndex, base.isMinor),
  };
}

/**
 * Computes shortest semitone delta (-6 to +6) from baseIndex to desired targetIndex.
 */
export function shortestSemitoneDelta(baseIndex: number, targetIndex: number): number {
  let diff = (((targetIndex - baseIndex) % 12) + 12) % 12;
  if (diff > 6) diff -= 12;
  return diff;
}
