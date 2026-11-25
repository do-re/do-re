import type { EmailMessage, EmailSender } from '../src/account/EmailSender';
import type { PictureStore, PictureType } from '../src/account/PictureStore';
import type { RandomSource } from '../src/deps';
import { AppError } from '../src/errors';
import { createApi, type HttpResponse } from '../src/http/api';
import { makeSong, type Song } from '../src/model/types';
import { AudioFeatures, FEATURE_COUNT } from '../src/model/vectors';
import { buildServices, type Services } from '../src/services';
import { SongLibrary } from '../src/song/SongLibrary';
import { MemoryTable } from '../src/store/MemoryTable';
import type { Table } from '../src/store/Table';

export const HOUR = 60 * 60 * 1000;

/** A clock tests move by hand. */
export class FakeClock {
  now = 1_800_000_000_000;
  readonly read = () => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

/** Deterministic RandomSource: IDs and tokens count up; int() returns queued values, then min. */
export class FakeRandom implements RandomSource {
  private counter = 0;
  readonly ints: number[] = [];
  constructor(private readonly prefix = 'u') {}
  id(): string {
    return `${this.prefix}-${String(++this.counter).padStart(4, '0')}`;
  }
  token(): string {
    return `token-${this.prefix}-${++this.counter}`;
  }
  bytes(n: number): Uint8Array {
    return new Uint8Array(n).fill(++this.counter % 256);
  }
  int(min: number, _max: number): number {
    return this.ints.shift() ?? min;
  }
}

/** EmailSender that keeps what it was asked to send. Set `failing` to simulate SES errors. */
export class RecordingEmail implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failing = false;
  async send(message: EmailMessage): Promise<void> {
    if (this.failing) {
      throw new AppError(502, 'EMAIL_SEND_FAILED', 'could not send');
    }
    this.sent.push(message);
  }
}

/** PictureStore that keeps pictures in memory and serves them from a made-up origin. */
export class MemoryPictures implements PictureStore {
  readonly saved = new Map<string, { bytes: Uint8Array; type: PictureType }>();
  async save(key: string, bytes: Uint8Array, type: PictureType): Promise<string> {
    const url = `https://pictures.example/${key}`;
    this.saved.set(url, { bytes: Uint8Array.from(bytes), type });
    return url;
  }
}

/** A song whose 7 features all equal `level` (or the given features). */
export function song(id: string, level: number | number[] = 0.5, durationSeconds = 200): Song {
  const values = Array.isArray(level) ? level : new Array<number>(FEATURE_COUNT).fill(level);
  return makeSong({
    id,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    durationSeconds,
    albumCoverUrl: `https://img.example/${id}.jpg`,
    spotifyUri: `spotify:track:${id}`,
    features: new AudioFeatures(values),
  });
}

/** `count` songs s00, s01, ... with feature levels spread evenly from 0 to 1. */
export function makeLibrary(count = 12): SongLibrary {
  return new SongLibrary(
    Array.from({ length: count }, (_, i) => song(`s${String(i).padStart(2, '0')}`, i / (count - 1))),
  );
}

export interface World {
  table: Table;
  clock: FakeClock;
  random: FakeRandom;
  email: RecordingEmail;
  pictures: MemoryPictures;
  library: SongLibrary;
  services: Services;
  /** Sends one request through the HTTP layer. `body` is sent as JSON, `raw` as bytes. */
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; raw?: Uint8Array; query?: Record<string, string> },
  ): Promise<HttpResponse>;
  /** Signs up, verifies and logs in a user through the HTTP layer. */
  join(email: string, password?: string): Promise<{ userId: string; token: string }>;
}

/** A whole backend on fakes. Pass a table to run it on DynamoDB Local instead. */
export function makeWorld(options: { table?: Table; librarySize?: number; idPrefix?: string } = {}): World {
  const table = options.table ?? new MemoryTable();
  const clock = new FakeClock();
  const random = new FakeRandom(options.idPrefix);
  const email = new RecordingEmail();
  const pictures = new MemoryPictures();
  const library = makeLibrary(options.librarySize);
  const services = buildServices({
    table,
    email,
    pictures,
    library,
    clock: clock.read,
    random,
    appBaseUrl: 'https://app.example',
    passwordCost: 16,
  });
  const api = createApi(services, () => undefined);
  const call: World['call'] = (method, path, { token, body, raw, query } = {}) =>
    api({
      method,
      path,
      query: query ?? {},
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      body: raw ?? (body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body))),
    });
  const join: World['join'] = async (address, password = 'correct horse') => {
    await call('POST', '/api/accounts', { body: { email: address, password, confirmPassword: password } });
    const link = linkIn(email.sent.findLast((message) => message.to === address.trim().toLowerCase())!);
    await call('POST', '/api/accounts/confirm', { body: link });
    const login = await call('POST', '/api/auth/login', { body: { email: address, password } });
    return login.body as { userId: string; token: string };
  };
  return { table, clock, random, email, pictures, library, services, call, join };
}

/** @returns the userId and token carried by the confirmation link in an email */
export function linkIn(message: EmailMessage): { userId: string; token: string } {
  const url = new URL(/https:\/\/\S+/.exec(message.text)![0]);
  return { userId: url.searchParams.get('userId')!, token: url.searchParams.get('token')! };
}

/** @returns the AppError status a promise rejects with (fails the test if it resolves) */
export async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      return error.status;
    }
    throw error;
  }
  throw new Error('expected the call to fail');
}
