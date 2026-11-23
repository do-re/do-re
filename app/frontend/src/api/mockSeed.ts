/**
 * Seed data for the in-memory mock backend (team plan: "front end done with mock controllers,
 * local mock database").
 *
 * DEV ONLY. These are throwaway test accounts for the mock; they never reach AWS.
 * The Spotify track IDs below are PLACEHOLDERS: replace them with rows from the Chosic CSV
 * export once Felix has it, or the embed player will show "track not found".
 */
import type { Song } from './types';

export interface SeedAccount {
  readonly userId: string;
  readonly email: string;
  /** Plain text is acceptable only because this is a client-side fake with test values. */
  readonly password: string;
  readonly verified: boolean;
  readonly username: string;
}

/** Log in with demo@do-re.test / demo-pass-1. unverified@do-re.test shows the R-SEC-03 popup. */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { userId: 'u-demo', email: 'demo@do-re.test', password: 'demo-pass-1', verified: true, username: 'demo' },
  { userId: 'u-unverified', email: 'unverified@do-re.test', password: 'demo-pass-1', verified: false, username: 'newbie' },
  { userId: 'u-melody', email: 'melody@do-re.test', password: 'demo-pass-1', verified: true, username: 'melody' },
  { userId: 'u-harmony', email: 'harmony@do-re.test', password: 'demo-pass-1', verified: true, username: 'harmony' },
  { userId: 'u-rhythm', email: 'rhythm@do-re.test', password: 'demo-pass-1', verified: true, username: 'rhythm' },
];

/**
 * A pending match that the other user (harmony) has already confirmed, so confirming it in
 * MatchView opens a chat (OPEN-4 path 1). Swipe-triggered matches exercise path 2.
 */
export const SEED_PENDING_MATCH = {
  match: { matchId: 'm-seed', userA: 'u-harmony', userB: 'u-demo', compatibilityPercent: 87.4 },
  confirmedBy: ['u-harmony'],
} as const;

/** A solid-colour square as an SVG data URI, standing in for album art. */
function cover(colour: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${colour}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const SEED_SONGS: readonly Song[] = [
  {
    id: 's1', title: 'Placeholder Song One', artist: 'Mock Artist A', durationSeconds: 30,
    albumCoverUrl: cover('#e4572e'), spotifyUri: 'spotify:track:PLACEHOLDER0000000001',
    features: [0.8, 0.7, 0.9, 0.1, 0.0, 0.2, 0.05],
  },
  {
    id: 's2', title: 'Placeholder Song Two', artist: 'Mock Artist B', durationSeconds: 30,
    albumCoverUrl: cover('#17bebb'), spotifyUri: 'spotify:track:PLACEHOLDER0000000002',
    features: [0.3, 0.4, 0.3, 0.8, 0.6, 0.1, 0.04],
  },
  {
    id: 's3', title: 'Placeholder Song Three', artist: 'Mock Artist C', durationSeconds: 30,
    albumCoverUrl: cover('#ffc914'), spotifyUri: 'spotify:track:PLACEHOLDER0000000003',
    features: [0.6, 0.9, 0.7, 0.2, 0.1, 0.3, 0.2],
  },
  {
    id: 's4', title: 'Placeholder Song Four', artist: 'Mock Artist D', durationSeconds: 30,
    albumCoverUrl: cover('#76b041'), spotifyUri: 'spotify:track:PLACEHOLDER0000000004',
    features: [0.2, 0.3, 0.4, 0.6, 0.9, 0.1, 0.03],
  },
];
