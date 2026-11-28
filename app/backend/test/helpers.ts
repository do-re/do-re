import type { EmailMessage, EmailSender } from '../src/account/EmailSender';
import type { PictureStore, PictureType } from '../src/account/PictureStore';
import type { RandomSource } from '../src/deps';
import { AppError } from '../src/errors';
import { createApi, type HttpResponse } from '../src/http/api';
import { makeSong, type Song } from '../src/model/types';
import { AudioFeatures, FEATURE_COUNT } from '../src/model/vectors';
import { buildServices, type Services } from '../src/services';
import type { EventPublisher, NotificationEvent } from '../src/notify/events';
import type { PushSender } from '../src/notify/Notifier';
import type { BrowserSubscription } from '../src/notify/PushSubscriptionModel';
import type { MusicSource, TrackCandidate } from '../src/song/MusicSource';
import { SongCatalog } from '../src/song/SongCatalog';
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

/** A catalog over a starting library, on a fresh table unless one is given. */
export function catalogOf(library: SongLibrary, table: Table = new MemoryTable()): SongCatalog {
  return new SongCatalog(library, table);
}

/**
 * A music platform for tests: recommend() offers `offered` (set it per test), and the fake
 * records what it was asked. Set `failing` to make recommend() throw, `limiting` to make
 * complete() throw as a rate-limited cover service does.
 */
export class FakeSource implements MusicSource {
  offered: Song[] = [];
  failing = false;
  limiting = false;
  readonly requests: { seedIds: readonly string[]; count: number }[] = [];
  /** IDs whose covers were asked for, one entry per complete() call. */
  readonly completed: string[][] = [];
  async recommend(seedIds: readonly string[], count: number): Promise<TrackCandidate[]> {
    this.requests.push({ seedIds, count });
    if (this.failing) {
      throw Object.assign(new Error('platform down for user@example.com'), { name: 'TimeoutError' });
    }
    return this.offered.slice(0, count).map(({ albumCoverUrl: _cover, ...candidate }) => candidate);
  }
  async tracks(trackIds: readonly string[]): Promise<TrackCandidate[]> {
    return this.offered.filter((s) => trackIds.includes(s.id)).map(({ albumCoverUrl: _cover, ...candidate }) => candidate);
  }
  async complete(candidates: readonly TrackCandidate[]): Promise<Song[]> {
    this.completed.push(candidates.map((candidate) => candidate.id));
    if (this.limiting) {
      throw Object.assign(new Error('Spotify answered 429'), { name: 'Error' });
    }
    return candidates.map((candidate) => this.offered.find((s) => s.id === candidate.id)!);
  }
}

/** EventPublisher that keeps the events it was given. */
export class RecordingPublisher implements EventPublisher {
  readonly events: NotificationEvent[] = [];
  async publish(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

/** PushSender that keeps what it was asked to send. `gone` and `broken` hold endpoints that fail. */
export class RecordingSender implements PushSender {
  readonly sent: { endpoint: string; payload: unknown }[] = [];
  readonly gone = new Set<string>();
  readonly broken = new Set<string>();
  async send(subscription: BrowserSubscription, payload: string): Promise<'sent' | 'gone'> {
    if (this.broken.has(subscription.endpoint)) {
      throw Object.assign(new Error(`push to ${subscription.endpoint} failed`), { name: 'WebPushError', statusCode: 500 });
    }
    if (this.gone.has(subscription.endpoint)) {
      return 'gone';
    }
    this.sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    return 'sent';
  }
}

/** A well-formed subscription for browser number n (a Chrome-style endpoint). */
export function browser(n: number): BrowserSubscription {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/browser-${n}`,
    keys: { p256dh: `BP256dh${'k'.repeat(80)}${n}`.slice(0, 87), auth: `auth${'a'.repeat(18)}`.slice(0, 22) },
  };
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
export function makeWorld(
  options: {
    table?: Table;
    librarySize?: number;
    idPrefix?: string;
    source?: MusicSource;
    publisher?: EventPublisher;
    vapidPublicKey?: string;
    adminEmails?: readonly string[];
  } = {},
): World {
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
    musicSource: options.source,
    publisher: options.publisher,
    adminEmails: options.adminEmails ?? ['root@example.com'],
    vapidPublicKey: 'vapidPublicKey' in options ? options.vapidPublicKey : 'BTestVapidPublicKey',
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
