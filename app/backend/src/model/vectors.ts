/** Number of audio features per song, and entries per Taste Vector. */
export const FEATURE_COUNT = 7;

/** Index of each feature. VALENCE is "Happiness" on Chosic. */
export const Feature = {
  VALENCE: 0,
  DANCEABILITY: 1,
  ENERGY: 2,
  ACOUSTICNESS: 3,
  INSTRUMENTALNESS: 4,
  LIVENESS: 5,
  SPEECHINESS: 6,
} as const;

/**
 * An immutable point in the 7-dimensional unit cube. Base of AudioFeatures and TasteVector.
 *
 * Rep invariant: entries.length == FEATURE_COUNT, and every entry is finite with
 *   0 <= entry <= 1. entries is frozen and never shared with a caller.
 */
abstract class UnitVector {
  private readonly entries: readonly number[];

  /**
   * Requires: values has FEATURE_COUNT entries, each finite and in [0, 1].
   * Effects: stores a private copy of values.
   * @throws RangeError if the requirement does not hold
   */
  constructor(values: readonly number[]) {
    this.entries = Object.freeze([...values]);
    this.checkRep();
  }

  /** @returns a fresh copy of the entries, in Feature index order */
  values(): number[] {
    return [...this.entries];
  }

  /**
   * @param other any vector in the same space
   * @returns the Euclidean distance to other, between 0 and sqrt(FEATURE_COUNT)
   */
  distanceTo(other: UnitVector): number {
    return Math.sqrt(this.entries.reduce((sum, v, i) => sum + (v - other.entries[i]!) ** 2, 0));
  }

  /** @returns true iff other has the same entries */
  equals(other: UnitVector): boolean {
    return this.entries.every((v, i) => v === other.entries[i]);
  }

  /** @throws RangeError if the rep invariant does not hold */
  checkRep(): void {
    const ok =
      this.entries.length === FEATURE_COUNT &&
      this.entries.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
    if (!ok) {
      throw new RangeError(`expected ${FEATURE_COUNT} numbers between 0 and 1`);
    }
  }
}

/**
 * The 7 numbers describing a song (Spotify-style audio features from Chosic, which reports
 * each as a score out of 100; stored here as score / 100). Immutable.
 *
 * Abstraction function: AF(entries) = the song's position in audio feature space, one
 *   normalized feature per Feature index.
 * Rep invariant: as UnitVector.
 * Satisfies: R-HOME-11, R-HOME-12 (with Song).
 */
export class AudioFeatures extends UnitVector {
  /** Keeps AudioFeatures and TasteVector from being interchangeable to the type checker. */
  readonly kind = 'audio-features';
}

/**
 * A user's 7-number music taste profile, in the same space as AudioFeatures. Immutable.
 *
 * Abstraction function: AF(entries) = the point in audio feature space this user's listening
 *   history pulls toward.
 * Rep invariant: as UnitVector.
 * Satisfies: R-HOME-17.
 */
export class TasteVector extends UnitVector {
  readonly kind = 'taste-vector';

  /** @returns the Taste Vector of a user with no listening history: 0.5 in every entry */
  static neutral(): TasteVector {
    return new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.5));
  }
}
