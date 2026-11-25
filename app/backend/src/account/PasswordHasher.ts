import { scrypt, timingSafeEqual } from 'node:crypto';
import { type RandomSource, systemRandom } from '../deps';

/** What is stored for a password: the salt, the hash and the scrypt cost used (base64 strings). */
export interface PasswordRecord {
  readonly salt: string;
  readonly hash: string;
  readonly cost: number;
}

const KEY_BYTES = 32;
const SALT_BYTES = 16;

/**
 * Salted password hashing with scrypt (Node's built-in crypto). Passwords are never stored
 * or logged; only PasswordRecords are (CLAUDE.md security rule, testing.md inspection item 6).
 *
 * Abstraction function: AF(cost, random) = a hasher that makes records at scrypt cost `cost`
 *   with salts drawn from `random`.
 * Rep invariant: cost is a power of two greater than 1.
 */
export class PasswordHasher {
  /** scrypt N for production: 2^15 (about 32 MB and a few hundred milliseconds per hash on Lambda). */
  static readonly DEFAULT_COST = 1 << 15;

  /**
   * Requires: cost is a power of two greater than 1.
   * @param cost   scrypt N parameter for new records; tests pass a small value to stay fast
   * @param random source of salts
   */
  constructor(
    private readonly cost: number = PasswordHasher.DEFAULT_COST,
    private readonly random: RandomSource = systemRandom,
  ) {}

  /**
   * Requires: password is non-empty.
   * Effects: none.
   * @returns a record with a new random salt, from which verify accepts exactly this password
   */
  async hash(password: string): Promise<PasswordRecord> {
    const salt = this.random.bytes(SALT_BYTES);
    const hash = await derive(password, salt, this.cost);
    return { salt: Buffer.from(salt).toString('base64'), hash: hash.toString('base64'), cost: this.cost };
  }

  /**
   * Effects: none.
   * @param password the submitted password
   * @param record   a record made by hash (at any cost)
   * @returns true iff password is the one the record was made from; compared in constant time
   */
  async verify(password: string, record: PasswordRecord): Promise<boolean> {
    const expected = Buffer.from(record.hash, 'base64');
    const actual = await derive(password, Buffer.from(record.salt, 'base64'), record.cost);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

function derive(password: string, salt: Uint8Array, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes; allow twice that.
    const options = { N: cost, r: 8, p: 1, maxmem: 256 * cost * 8 };
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, options, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}
