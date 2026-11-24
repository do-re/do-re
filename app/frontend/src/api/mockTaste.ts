/**
 * Mock of MusicTasteModel (architecture-stubs-v2.java). Same constants and update rule as the
 * stub, so Felix can port it directly and the demo behaves like the real app.
 *
 * Abstraction function: for each user, `tastes` is the point in 7-dimensional audio feature space
 * that their listening pulls toward, and `histories` is what they listened to, newest first.
 * Rep invariant: every Taste Vector has FEATURE_COUNT finite entries in [0, 1]; every history has
 * at most HISTORY_SIZE entries.
 */
import { FEATURE_COUNT, type Feedback, type Song } from './types';

/** Songs remembered per user (stub HISTORY_SIZE). */
export const HISTORY_SIZE = 100;
/** Largest fraction of the distance one listen may move a Taste Vector (stub MAX_STEP). */
export const MAX_STEP = 0.2;
/** An instant skip moves taste by this fraction of MAX_STEP (an instant like moves it by 0.5). */
export const SKIP_STRENGTH = 0.25;
/** How many swipes in a row the undo button can reverse. */
export const UNDO_LIMIT = 10;
/** Every entry of a new user's Taste Vector: the centre of feature space. */
export const NEUTRAL_VALUE = 0.5;

/** A user's 7-number taste, in the same index order as a song's features. */
export type TasteVector = readonly number[];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Stub computeWeight. A like counts for more the longer it was listened to. A skip pushes away
 * hardest when it was immediate, and not at all after a full listen. A skip is deliberately weaker
 * than a like: people skip far more songs than they like, and skipping says less about taste.
 * Requires: durationSeconds > 0.
 * Effects: none.
 * @returns w with -MAX_STEP <= w <= MAX_STEP that increases with the fraction listened; w > 0 for
 *          LIKE, w <= 0 for SKIP
 */
export function computeWeight(feedback: Feedback, secondsListened: number, durationSeconds: number): number {
  const fraction = clamp01(secondsListened / durationSeconds);
  if (feedback === 'LIKE') return MAX_STEP * (0.5 + 0.5 * fraction);
  return fraction === 1 ? 0 : -MAX_STEP * SKIP_STRENGTH * (1 - fraction);
}

/**
 * The bounded update in stub recordListen (OPEN-15): t[i] = clamp(t[i] + w * (f[i] - t[i]), 0, 1).
 * Satisfies: R-HOME-12, R-HOME-17.
 * Requires: taste and features have FEATURE_COUNT entries in [0, 1]; |weight| <= MAX_STEP.
 * Effects: none.
 * @returns the new Taste Vector
 */
export function moveTaste(taste: TasteVector, features: readonly number[], weight: number): TasteVector {
  return taste.map((t, i) => clamp01(t + weight * (features[i] - t)));
}

/**
 * Requires: a and b have the same length.
 * Effects: none.
 * @returns the Euclidean distance between a and b
 */
export function tasteDistance(a: readonly number[], b: readonly number[]): number {
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0));
}

/**
 * Stub MatchModel.compatibility, on two Taste Vectors.
 * Satisfies: R-HOME-18.
 * Requires: a and b have FEATURE_COUNT entries in [0, 1].
 * Effects: none.
 * @returns a percentage in [0, 100]: 100 iff a equals b, decreasing as their Euclidean distance
 *          grows (0 at the largest possible distance), symmetric in a and b
 */
export function compatibilityPercent(a: TasteVector, b: TasteVector): number {
  return 100 * clamp01(1 - tasteDistance(a, b) / Math.sqrt(FEATURE_COUNT));
}

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff taste is still the neutral starting point
 */
export function isNeutralTaste(taste: TasteVector): boolean {
  return taste.every((value) => value === NEUTRAL_VALUE);
}

interface Listen {
  readonly song: Song;
  readonly feedback: Feedback;
}

/** What recordListen changed, so the listen can be undone. */
interface ListenUndo {
  readonly taste: TasteVector;
  /** The oldest history entry, if this listen pushed it out. */
  readonly dropped: Listen | null;
}

export class MockTasteModel {
  private readonly tastes = new Map<string, TasteVector>();
  private readonly histories = new Map<string, Listen[]>();
  private readonly undos = new Map<string, ListenUndo[]>();

  /**
   * Stub recordListen.
   * Satisfies: R-HOME-12, R-HOME-17.
   * Requires: 0 <= secondsListened <= song.durationSeconds.
   * Effects: song becomes the user's most recent history entry (dropping the oldest past
   *          HISTORY_SIZE), and the Taste Vector moves toward a liked song or away from a skip.
   */
  recordListen(userId: string, song: Song, feedback: Feedback, secondsListened: number): void {
    const weight = computeWeight(feedback, secondsListened, song.durationSeconds);
    const before = this.getTasteVector(userId);
    this.tastes.set(userId, moveTaste(before, song.features, weight));
    const history = this.histories.get(userId) ?? [];
    const dropped = history.length === HISTORY_SIZE ? history[HISTORY_SIZE - 1] : null;
    history.unshift({ song, feedback });
    history.length = Math.min(history.length, HISTORY_SIZE);
    this.histories.set(userId, history);
    const undos = this.undos.get(userId) ?? [];
    undos.push({ taste: before, dropped });
    if (undos.length > UNDO_LIMIT) undos.shift();
    this.undos.set(userId, undos);
    this.checkRep();
  }

  /**
   * WEB: reverses the user's latest listen, for the undo button.
   * Requires: none.
   * Effects: if a listen can be undone, the Taste Vector and history return to what they were
   *          before it; otherwise nothing changes.
   * @returns true iff a listen was undone
   */
  undoLastListen(userId: string): boolean {
    const undo = this.undos.get(userId)?.pop();
    if (undo === undefined) return false;
    this.tastes.set(userId, undo.taste);
    const history = this.histories.get(userId)!;
    history.shift();
    if (undo.dropped !== null) history.push(undo.dropped);
    this.checkRep();
    return true;
  }

  /**
   * Stub getTasteVector.
   * Requires: none.
   * Effects: if the user has no Taste Vector yet, creates one with every entry 0.5.
   * @returns the user's current Taste Vector
   */
  getTasteVector(userId: string): TasteVector {
    const existing = this.tastes.get(userId);
    if (existing !== undefined) return existing;
    const neutral: TasteVector = Array.from({ length: FEATURE_COUNT }, () => NEUTRAL_VALUE);
    this.tastes.set(userId, neutral);
    return neutral;
  }

  /**
   * Stub getRecentSongs.
   * Requires: none.
   * Effects: none.
   * @returns the user's listened songs, most recent first, at most HISTORY_SIZE long
   */
  getRecentSongs(userId: string): Song[] {
    return (this.histories.get(userId) ?? []).map((listen) => listen.song);
  }

  /**
   * Requires: none.
   * Effects: none.
   * @returns the songs in the user's history that they liked, most recent first
   */
  getLikedSongs(userId: string): Song[] {
    return (this.histories.get(userId) ?? []).filter((l) => l.feedback === 'LIKE').map((l) => l.song);
  }

  /** Asserts the rep invariant. */
  checkRep(): void {
    for (const taste of this.tastes.values()) {
      if (taste.length !== FEATURE_COUNT || !taste.every((t) => Number.isFinite(t) && t >= 0 && t <= 1)) {
        throw new Error('MockTasteModel rep invariant violated: bad Taste Vector');
      }
    }
    for (const history of this.histories.values()) {
      if (history.length > HISTORY_SIZE) {
        throw new Error('MockTasteModel rep invariant violated: history too long');
      }
    }
  }
}
