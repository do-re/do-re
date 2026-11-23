/**
 * Pure helpers for HomeView, kept out of the component file so they can be unit-tested and
 * React fast refresh works.
 */
import type { PlaybackState } from '../player/types';

/** How far (px) a drag must travel sideways to count as a swipe. */
export const SWIPE_THRESHOLD_PX = 60;

/**
 * Largest gap (s) between two playback updates that still counts as listening. Bigger jumps
 * are seeks, which must not count as time listened.
 */
export const MAX_LISTEN_STEP_S = 1.5;

/**
 * Formats seconds as m:ss for the elapsed-time display (R-HOME-05).
 * Requires: none.
 * Effects: none.
 * @returns floor(seconds) as minutes:two-digit-seconds; negative or non-finite input gives "0:00"
 */
export function formatTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Adds the time actually played between two playback updates (stub getSecondsListened).
 * Only forward steps of at most MAX_LISTEN_STEP_S while playing count, so pauses, seeks and
 * replays from the start add nothing.
 * Requires: listened >= 0.
 * Effects: none.
 * @returns listened plus (next.position - prev.position) if prev exists, both updates are
 *          playing and the step is in (0, MAX_LISTEN_STEP_S]; otherwise listened
 */
export function nextListened(listened: number, prev: PlaybackState | null, next: PlaybackState): number {
  if (prev === null || prev.isPaused || next.isPaused) return listened;
  const step = next.positionSeconds - prev.positionSeconds;
  return step > 0 && step <= MAX_LISTEN_STEP_S ? listened + step : listened;
}

/**
 * Which way a finished drag swiped.
 * Requires: none.
 * Effects: none.
 * @returns 'right' if dx >= SWIPE_THRESHOLD_PX, 'left' if dx <= -SWIPE_THRESHOLD_PX, else null
 */
export function swipeDirection(dx: number): 'left' | 'right' | null {
  if (dx >= SWIPE_THRESHOLD_PX) return 'right';
  if (dx <= -SWIPE_THRESHOLD_PX) return 'left';
  return null;
}

/**
 * The full-page background colour for a song (R-HOME-09), taken from its Audio Features so it
 * needs no image processing: happiness (valence) sets the hue, from blue (sad) to orange
 * (happy); energy sets the saturation. Lightness stays at 25% so white text keeps a contrast
 * ratio of at least 4.5:1 (R-UI-03).
 * Requires: features has at least 3 entries in [0, 1] (valence, danceability, energy first,
 *           as in AudioFeatures).
 * Effects: none.
 * @returns a CSS hsl() colour
 */
export function backgroundFor(features: readonly number[]): string {
  const clamp = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
  const valence = clamp(features[0]);
  const energy = clamp(features[2]);
  const hue = Math.round(220 - valence * 190);
  const saturation = Math.round(35 + energy * 40);
  return `hsl(${hue} ${saturation}% 25%)`;
}

const SHOWN_MATCHES_KEY = 'do-re.shownMatches';

function readShown(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(SHOWN_MATCHES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff markMatchShown(matchId) was called earlier in this browser tab
 */
export function wasMatchShown(matchId: string): boolean {
  return readShown().includes(matchId);
}

/**
 * Remembers (for this browser tab) that a match was opened, so HomeView opens each pending
 * match by itself only once. Without this, pressing Back on MatchView would bounce the user
 * straight back to it.
 * Requires: none.
 * Effects: wasMatchShown(matchId) becomes true for this tab if storage is available.
 */
export function markMatchShown(matchId: string): void {
  try {
    const shown = readShown();
    if (!shown.includes(matchId)) {
      sessionStorage.setItem(SHOWN_MATCHES_KEY, JSON.stringify([...shown, matchId]));
    }
  } catch {
    // Storage blocked: the match may be shown again, which is harmless.
  }
}
