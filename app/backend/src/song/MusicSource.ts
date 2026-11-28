import { makeSong, type Song } from '../model/types';
import { AudioFeatures } from '../model/vectors';
import { extractTrackId, spotifyLookup, type TrackLookup } from './libraryBuilder';

/** A track the platform knows, with everything a Song needs except its album cover. */
export type TrackCandidate = Omit<Song, 'albumCoverUrl'>;

/**
 * A music platform the app pulls songs from while users swipe. An interface so tests use a
 * fake and another provider can replace the one below.
 *
 * Pulling is two steps because album covers are the expensive part (one request per track
 * to a rate-limited service): first get candidates, choose among them, then complete only
 * the chosen ones.
 */
export interface MusicSource {
  /**
   * Requires: seedIds has 1 to MAX_SEEDS Spotify track IDs; count > 0.
   * Effects: asks the platform; nothing is stored.
   * @returns up to count tracks the platform recommends for listeners of the seed tracks,
   *          each with its details and 7 Audio Features. May be fewer, or empty, if the
   *          platform knows little about the seeds.
   * @throws if the platform cannot be reached or answers with an error
   */
  recommend(seedIds: readonly string[], count: number): Promise<TrackCandidate[]>;

  /**
   * Requires: trackIds are Spotify track IDs.
   * Effects: asks the platform; nothing is stored.
   * @returns a candidate for each ID the platform knows, in no particular order
   * @throws if the platform cannot be reached or answers with an error
   */
  tracks(trackIds: readonly string[]): Promise<TrackCandidate[]>;

  /**
   * Effects: asks the platform for each candidate's album cover; nothing is stored.
   * @returns a complete Song for each candidate whose cover was found, in the same order.
   *          Candidates whose track no longer exists are left out.
   * @throws if the platform cannot be reached, answers with an error, or is limiting
   *         requests; candidates are then not partly returned
   */
  complete(candidates: readonly TrackCandidate[]): Promise<Song[]>;
}

/** Most seed tracks one recommendation request may name. */
export const MAX_SEEDS = 5;

const RECCOBEATS = 'https://api.reccobeats.com/v1';
/** Most IDs ReccoBeats accepts in one track or audio-features request. */
const BATCH = 40;
/** How many cover lookups are sent to Spotify at once. */
const COVER_BATCH = 10;
/** Most recommendations ReccoBeats returns for one request. */
const MAX_RECOMMENDATIONS = 100;
/** Feature names in Feature index order (model/vectors.ts). */
const FEATURE_NAMES = ['valence', 'danceability', 'energy', 'acousticness', 'instrumentalness', 'liveness', 'speechiness'] as const;

interface ReccoTrack {
  readonly trackTitle?: unknown;
  readonly artists?: unknown;
  readonly durationMs?: unknown;
  readonly href?: unknown;
}

/**
 * MusicSource on two public, key-less services:
 *  - ReccoBeats (reccobeats.com) for recommendations, track details and the 7 audio features
 *    of Spotify tracks, addressed by Spotify track ID;
 *  - Spotify's oEmbed endpoint for each track's album cover, which also confirms the track
 *    exists on Spotify, where the client's embed player will play it.
 * No secret is involved. A track becomes a Song only if every part is available: details,
 * all 7 features and a cover. Spotify limits how often its endpoint may be called (it answers
 * 429 when overrun), which is why covers are looked up only for the tracks actually kept.
 *
 * Abstraction function: AF(fetchFn, cover, timeoutMs) = the catalogue of Spotify tracks that
 *   ReccoBeats has analysed, reached with fetchFn, giving up on a request after timeoutMs.
 * Rep invariant: timeoutMs > 0.
 */
export class ReccoBeatsSource implements MusicSource {
  private readonly cover: TrackLookup;

  /**
   * @param fetchFn   behaves like the global fetch (tests pass a fake)
   * @param timeoutMs how long to wait for each request before failing
   */
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 4000,
  ) {
    this.cover = spotifyLookup((input, init) => this.fetchFn(input, { ...init, signal: AbortSignal.timeout(this.timeoutMs) }));
  }

  async recommend(seedIds: readonly string[], count: number): Promise<TrackCandidate[]> {
    const size = Math.min(MAX_RECOMMENDATIONS, Math.max(1, Math.ceil(count)));
    const seeds = seedIds.slice(0, MAX_SEEDS).join(',');
    return this.withFeatures(await this.getJson(`/track/recommendation?size=${size}&seeds=${seeds}`, [400]));
  }

  async tracks(trackIds: readonly string[]): Promise<TrackCandidate[]> {
    const found: ReccoTrack[] = [];
    for (let i = 0; i < trackIds.length; i += BATCH) {
      found.push(...(await this.getJson(`/track?ids=${trackIds.slice(i, i + BATCH).join(',')}`, [])));
    }
    return this.withFeatures(found);
  }

  async complete(candidates: readonly TrackCandidate[]): Promise<Song[]> {
    const songs: Song[] = [];
    // A few at a time, so one pull never sends Spotify a burst of dozens of requests. A
    // failed lookup (for example 429 Too Many Requests) rejects the whole call at once,
    // without sending the remaining batches.
    for (let i = 0; i < candidates.length; i += COVER_BATCH) {
      const batch = candidates.slice(i, i + COVER_BATCH);
      const covers = await Promise.all(batch.map((candidate) => this.cover(candidate.id)));
      batch.forEach((candidate, j) => {
        const coverUrl = covers[j]?.coverUrl;
        // The cover becomes an <img src> in every client, so only an https URL is accepted.
        if (coverUrl !== undefined && coverUrl.startsWith('https://')) {
          songs.push(makeSong({ ...candidate, albumCoverUrl: coverUrl }));
        }
      });
    }
    return songs;
  }

  /** Adds audio features to track details; drops tracks missing details or any feature. */
  private async withFeatures(found: readonly ReccoTrack[]): Promise<TrackCandidate[]> {
    const details = new Map<string, ReccoTrack>();
    for (const track of found) {
      const id = typeof track.href === 'string' ? extractTrackId(track.href) : undefined;
      if (id !== undefined) {
        details.set(id, track);
      }
    }
    const ids = [...details.keys()];
    const candidates: TrackCandidate[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      for (const entry of await this.getJson(`/audio-features?ids=${ids.slice(i, i + BATCH).join(',')}`, [])) {
        const row = entry as Record<string, unknown>;
        const id = typeof row.href === 'string' ? extractTrackId(row.href) : undefined;
        const track = id === undefined ? undefined : details.get(id);
        if (id === undefined || track === undefined) {
          continue;
        }
        const artists = Array.isArray(track.artists) ? track.artists.map((artist) => String((artist as { name?: unknown }).name ?? '')) : [];
        try {
          // makeSong checks every field; the placeholder cover is removed again below.
          const { albumCoverUrl: _cover, ...candidate } = makeSong({
            id,
            title: String(track.trackTitle ?? ''),
            artist: artists.filter((name) => name !== '').join(', '),
            durationSeconds: Number(track.durationMs) / 1000,
            albumCoverUrl: 'pending',
            spotifyUri: `spotify:track:${id}`,
            features: new AudioFeatures(FEATURE_NAMES.map((name) => row[name] as number)),
          });
          candidates.push(candidate);
        } catch {
          // No title, artist or duration, or a feature missing or out of range (R-HOME-11).
        }
      }
    }
    return candidates;
  }

  /** GETs a ReccoBeats list. Statuses in `empty` mean "nothing found" and give []. */
  private async getJson(path: string, empty: readonly number[]): Promise<ReccoTrack[]> {
    const response = await this.fetchFn(`${RECCOBEATS}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (empty.includes(response.status)) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`ReccoBeats answered ${response.status}`);
    }
    const body = (await response.json()) as { content?: unknown };
    return Array.isArray(body.content) ? (body.content as ReccoTrack[]) : [];
  }
}
