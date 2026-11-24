/**
 * Seed data for the in-memory mock backend (team plan: "front end done with mock controllers,
 * local mock database").
 *
 * DEV ONLY. These are throwaway test accounts for the mock; they never reach AWS.
 * The songs are invented and their Spotify track IDs are PLACEHOLDERS, so the demo uses a silent
 * player. Replace them with rows from the Chosic CSV export once Felix has it (notes F-8).
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

const seedAccount = (name: string, username: string, verified = true): SeedAccount => ({
  userId: `u-${name}`,
  email: `${name}@do-re.test`,
  password: 'demo-pass-1',
  verified,
  username,
});

/** Log in with demo@do-re.test / demo-pass-1. unverified@do-re.test shows the R-SEC-03 popup. */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  seedAccount('demo', 'demo'),
  seedAccount('unverified', 'newbie', false),
  seedAccount('melody', 'melody'),
  seedAccount('harmony', 'harmony'),
  seedAccount('rhythm', 'rhythm'),
  seedAccount('tempo', 'tempo'),
  seedAccount('lyric', 'lyric'),
  seedAccount('echo', 'echo'),
];

/**
 * A pending match that the other user (harmony) has already confirmed. Off by default, so nobody
 * gets a match the moment they log in; tests turn it on to cover OPEN-4's "already confirmed" path.
 */
export const SEED_PENDING_MATCH = {
  match: { matchId: 'm-seed', userA: 'u-harmony', userB: 'u-demo', compatibilityPercent: 87.4 },
  confirmedBy: ['u-harmony'],
} as const;

/** A music style in the mock library. */
export type Genre = 'folk' | 'pop' | 'hiphop' | 'rock' | 'ambient';

interface GenreSeed {
  readonly genre: Genre;
  /**
   * Typical features: valence, danceability, energy, acousticness, instrumentalness, liveness,
   * speechiness. All five styles sit about the same distance from the centre of feature space, so
   * no bot wins matches just by having a less distinctive taste.
   */
  readonly center: readonly number[];
  readonly colour: string;
  readonly tracks: readonly (readonly [title: string, artist: string])[];
}

const GENRES: readonly GenreSeed[] = [
  {
    genre: 'folk',
    center: [0.6, 0.35, 0.25, 0.95, 0.05, 0.12, 0.05],
    colour: '#b7791f',
    tracks: [
      ['Paper Lanterns', 'Wren & Willow'],
      ['Kitchen Table', 'Wren & Willow'],
      ['Slow River Home', 'The Hollow Pines'],
      ['Woodsmoke', 'The Hollow Pines'],
      ['Letters to June', 'Ada Marlowe'],
      ['Porch Light', 'Ada Marlowe'],
    ],
  },
  {
    genre: 'pop',
    center: [0.82, 0.85, 0.75, 0.15, 0.1, 0.2, 0.15],
    colour: '#d53f8c',
    tracks: [
      ['Neon Weekend', 'Kira Vale'],
      ['Sugar Static', 'Kira Vale'],
      ['Call Me Tonight', 'Starlight Avenue'],
      ['Disco Heartbeat', 'Starlight Avenue'],
      ['Golden Hour Crush', 'Mika Sol'],
      ['Up All Night Again', 'Mika Sol'],
    ],
  },
  {
    genre: 'hiphop',
    center: [0.4, 0.9, 0.65, 0.05, 0.02, 0.15, 0.75],
    colour: '#6b46c1',
    tracks: [
      ['Block Party Theory', 'MC Parallax'],
      ['Corner Store Poets', 'MC Parallax'],
      ['Late Bus Freestyle', 'Dee Northside'],
      ['Concrete Garden', 'Dee Northside'],
      ['Hometown Numbers', 'Lyle Cipher'],
      ['Tape Deck Memories', 'Lyle Cipher'],
    ],
  },
  {
    genre: 'rock',
    center: [0.4, 0.35, 0.95, 0.05, 0.15, 0.75, 0.08],
    colour: '#c53030',
    tracks: [
      ['Broken Amplifier', 'Static Crown'],
      ['Live at the Garage', 'Static Crown'],
      ['Thunder Road Motel', 'The Rust Kings'],
      ['Last Encore', 'The Rust Kings'],
      ['Feedback Loop', 'Vera Blaze'],
      ['Burn the Setlist', 'Vera Blaze'],
    ],
  },
  {
    genre: 'ambient',
    center: [0.2, 0.2, 0.2, 0.75, 0.9, 0.12, 0.05],
    colour: '#2b6cb0',
    tracks: [
      ['Tidal Drift', 'Lowlight'],
      ['Glass Horizon', 'Lowlight'],
      ['Snowfall Study', 'Ostara Fields'],
      ['Deep Blue Hours', 'Ostara Fields'],
      ['Quiet Machines', 'Noor Halden'],
      ['Moss and Rain', 'Noor Halden'],
    ],
  },
];

/** A square of album art with a music note, as an SVG data URI. */
function cover(colour: string, seed: number): string {
  const angle = (seed * 47) % 360;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
    `<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">` +
    `<stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="#1a202c"/></linearGradient></defs>` +
    '<rect width="300" height="300" fill="url(#g)"/>' +
    '<text x="150" y="195" font-size="130" text-anchor="middle" fill="#ffffff" fill-opacity=".75">♪</text></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The center nudged by a small fixed amount per song and feature, so songs in a genre differ. */
function featuresFor(center: readonly number[], songIndex: number): number[] {
  return center.map((value, feature) => {
    const nudge = ((((songIndex + 1) * (feature + 3)) % 7) - 3) * 0.02;
    return Math.round(Math.min(1, Math.max(0, value + nudge)) * 100) / 100;
  });
}

const GENRE_OF_SONG = new Map<string, Genre>();

/** The mock's song library: 30 invented songs in five styles, each a 30-second preview. */
export const SEED_SONGS: readonly Song[] = GENRES.flatMap(({ genre, center, colour, tracks }, genreIndex) =>
  tracks.map(([title, artist], trackIndex) => {
    const number = genreIndex * tracks.length + trackIndex + 1;
    const id = `s${number}`;
    GENRE_OF_SONG.set(id, genre);
    return {
      id,
      title,
      artist,
      durationSeconds: 30,
      albumCoverUrl: cover(colour, number),
      spotifyUri: `spotify:track:PLACEHOLDER${String(number).padStart(10, '0')}`,
      features: featuresFor(center, trackIndex),
    };
  }),
);

/**
 * Requires: none.
 * Effects: none.
 * @returns the library's songs in the given style
 */
export function songsInGenre(genre: Genre): readonly Song[] {
  return SEED_SONGS.filter((song) => GENRE_OF_SONG.get(song.id) === genre);
}

/** One fake user: what they like and how they behave. */
export interface SeedBot {
  readonly userId: string;
  /** The bot has liked every song in this style. */
  readonly genre: Genre;
  /** Whether the green dot is on, and the bot greets and replies. */
  readonly online: boolean;
  /** How long ago the bot last swiped. Over 72 hours means it isn't matched (R-HOME-19). */
  readonly hoursSinceActive: number;
  /** The lowest compatibility the bot says yes to. */
  readonly acceptAtPercent: number;
  /** Chat replies, used in turn. */
  readonly replies: readonly string[];
}

export const SEED_BOTS: readonly SeedBot[] = [
  {
    userId: 'u-melody',
    genre: 'folk',
    online: true,
    hoursSinceActive: 2,
    acceptAtPercent: 60,
    replies: ['Do you play any instruments?', 'There is a great open mic near campus.', 'Acoustic sets are the best.'],
  },
  {
    userId: 'u-harmony',
    genre: 'pop',
    online: true,
    hoursSinceActive: 1,
    acceptAtPercent: 55,
    replies: ['This is my favourite kind of playlist!', 'We should go dancing sometime.', 'What is on repeat for you?'],
  },
  {
    userId: 'u-rhythm',
    genre: 'hiphop',
    online: true,
    hoursSinceActive: 6,
    acceptAtPercent: 60,
    replies: ['Who is your favourite lyricist?', 'That beat has been stuck in my head.', 'Any shows coming up?'],
  },
  {
    userId: 'u-tempo',
    genre: 'rock',
    online: true,
    hoursSinceActive: 12,
    acceptAtPercent: 60,
    replies: ['Live shows are the only way to hear it.', 'Have you been to a concert lately?', 'Turn it up!'],
  },
  {
    userId: 'u-lyric',
    genre: 'ambient',
    online: false,
    hoursSinceActive: 30,
    acceptAtPercent: 65,
    replies: ['This is good music to study to.', 'I listen to this on rainy days.'],
  },
  {
    userId: 'u-echo',
    genre: 'pop',
    online: false,
    hoursSinceActive: 120,
    acceptAtPercent: 55,
    replies: ['Sorry, I have been away.'],
  },
];

export interface SeedChat {
  readonly chatId: string;
  readonly matchId: string;
  readonly partnerId: string;
  readonly compatibilityPercent: number;
  /** Whether the partner's green dot stays on. */
  readonly online: boolean;
  /** Oldest first. `fromDemo` is true for messages demo sent. */
  readonly messages: readonly { readonly fromDemo: boolean; readonly text: string; readonly secondsAgo: number }[];
}

/**
 * Example chats for tests and design review (`withSeedChats`). Off in the running app, where chats
 * come only from real matches. The gaps show the 60-second picture grouping (R-CHAT-09) and the
 * list order (R-CHAT-02).
 */
export const SEED_CHATS: readonly SeedChat[] = [
  {
    chatId: 'c-seed-lyric',
    matchId: 'm-chat-lyric',
    partnerId: 'u-lyric',
    compatibilityPercent: 78.2,
    online: false,
    messages: [
      { fromDemo: false, text: 'Good taste in music!', secondsAgo: 86_400 },
      { fromDemo: true, text: 'Thanks, you too', secondsAgo: 86_340 },
    ],
  },
  {
    chatId: 'c-seed-tempo',
    matchId: 'm-chat-tempo',
    partnerId: 'u-tempo',
    compatibilityPercent: 91.6,
    online: true,
    messages: [
      { fromDemo: false, text: 'Hey! We matched on a lot of the same songs', secondsAgo: 1_800 },
      { fromDemo: false, text: 'What have you been listening to lately?', secondsAgo: 1_770 },
      { fromDemo: true, text: 'Mostly acoustic stuff this week', secondsAgo: 1_700 },
      { fromDemo: true, text: 'You?', secondsAgo: 1_680 },
      { fromDemo: false, text: 'Same, plus a lot of jazz', secondsAgo: 1_500 },
      { fromDemo: false, text: 'Any concerts coming up?', secondsAgo: 300 },
    ],
  },
];
