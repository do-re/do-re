import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';

/** The current time in milliseconds since the Unix epoch. Injected so tests control time. */
export type Clock = () => number;

/** Source of randomness. Injected so tests are deterministic. */
export interface RandomSource {
  /** @returns a new unique ID that contains only letters, digits and hyphens */
  id(): string;
  /** @returns a URL-safe secret with at least 256 bits of entropy */
  token(): string;
  /** @returns n random bytes */
  bytes(n: number): Uint8Array;
  /**
   * Requires: min and max are integers with min <= max.
   * @returns an integer chosen uniformly from [min, max]
   */
  int(min: number, max: number): number;
}

/** Cryptographically secure RandomSource used in production. */
export const systemRandom: RandomSource = {
  id: () => randomUUID(),
  token: () => randomBytes(32).toString('base64url'),
  bytes: (n) => randomBytes(n),
  int: (min, max) => randomInt(min, max + 1),
};

/**
 * @param text any string
 * @returns the SHA-256 digest of text as lowercase hex. Used so session and verification
 *          tokens are never stored as issued.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * @param a one user ID
 * @param b another user ID
 * @returns the same string for (a, b) and (b, a): the two IDs in ascending order joined by
 *          "_". User IDs never contain "_", so the pair can be recovered from it.
 */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
