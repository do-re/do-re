import { describe, expect, it } from 'vitest';
import { buildLibrary, extractTrackId, LIBRARY_HEADER, songsToCsv, spotifyLookup, spreadOut, toCsv, type TrackLookup } from '../src/song/libraryBuilder';
import { song } from './helpers';
import { parseCsv, parseSongLibrary } from '../src/song/SongLibrary';

const ID = (n: number) => `${n}`.padStart(22, 'a'); // a well-formed 22-character track ID
const found: TrackLookup = async (trackId) => ({ title: `Title ${trackId}`, coverUrl: `https://covers.example/${trackId}` });
const HEADER = 'Song,Artist,Time,Dance,Energy,Acoustic,Instrumental,Happy,Speech,Live,Spotify Track Id';
const row = (id: string, title = 'A Song') => `${title},An Artist,3:25,10,20,30,40,50,60,70,${id}`;

describe('extractTrackId', () => {
  // spec: partitions of the accepted forms
  it('reads an ID from a bare ID, a URI or a link, and nothing else', () => {
    const id = '4cOdK2wGLETKBW3PvgPWqT';
    expect(extractTrackId(id)).toBe(id);
    expect(extractTrackId(`  spotify:track:${id} `)).toBe(id);
    expect(extractTrackId(`https://open.spotify.com/track/${id}`)).toBe(id);
    expect(extractTrackId(`https://open.spotify.com/intl-fr/track/${id}?si=abc123`)).toBe(id);
    expect(extractTrackId(`spotify:album:${id}`)).toBeUndefined();
    expect(extractTrackId(`https://example.com/track/${id}`)).toBeUndefined();
    expect(extractTrackId(id.slice(1))).toBeUndefined(); // too short
    expect(extractTrackId(`${id}x`)).toBeUndefined(); // too long
    expect(extractTrackId('')).toBeUndefined();
  });
});

describe('buildLibrary', () => {
  it('R_HOME_01_R_HOME_11_turnsAnExportIntoALibraryTheBackendLoads', async () => {
    const result = await buildLibrary([HEADER, row(ID(1), '"Hello, World"'), row(ID(2))].join('\r\n'), found);
    expect(result.kept).toBe(2);
    expect(result.dropped).toEqual([]);
    expect(parseCsv(result.csv)[0]).toEqual([...LIBRARY_HEADER]);
    const songs = parseSongLibrary(result.csv);
    expect(songs.map((s) => s.id)).toEqual([ID(1), ID(2)]);
    expect(songs[0]).toMatchObject({ title: 'Hello, World', artist: 'An Artist', durationSeconds: 205 });
    // features keep their meaning: valence(Happy)=50, dance=10, energy=20, acoustic=30, instrumental=40, live=70, speech=60
    expect(songs[0]!.features.values()).toEqual([0.5, 0.1, 0.2, 0.3, 0.4, 0.7, 0.6]);
  });

  it('R_HOME_04_takesTheCoverFromSpotifyWhenTheExportHasNone', async () => {
    const withCovers = [`${HEADER},Spotify Track Img`, `${row(ID(1))},https://chosic.example/own.jpg`, `${row(ID(2))},`].join('\n');
    const songs = parseSongLibrary((await buildLibrary(withCovers, found)).csv);
    expect(songs.map((s) => s.albumCoverUrl)).toEqual(['https://chosic.example/own.jpg', `https://covers.example/${ID(2)}`]);
    const noColumn = parseSongLibrary((await buildLibrary([HEADER, row(ID(3))].join('\n'), found)).csv);
    expect(noColumn[0]!.albumCoverUrl).toBe(`https://covers.example/${ID(3)}`);
  });

  it('accepts other column names and orders, and a link column for the track ID', async () => {
    const csv = [
      'url,valence,danceability,energy,acousticness,instrumentalness,liveness,speechiness,title,artists,duration',
      `https://open.spotify.com/track/${ID(7)},0,100,50,50,50,50,50,T,A,187`,
    ].join('\n');
    const [song] = parseSongLibrary((await buildLibrary(csv, found)).csv);
    expect(song).toMatchObject({ id: ID(7), durationSeconds: 187 });
    expect(song!.features.values()).toEqual([0, 1, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  // spec: each reason a row is dropped, with its line number in the export
  it('R_HOME_11_leavesOutRowsThatCannotBeUsedAndSaysWhy', async () => {
    const lookups: string[] = [];
    const lookup: TrackLookup = async (trackId) => {
      lookups.push(trackId);
      return trackId === ID(4) ? undefined : found(trackId);
    };
    const csv = [
      HEADER,
      row(ID(1)),
      row('not-an-id'),
      row(ID(1)), // repeat
      row(ID(4)), // gone from Spotify
      `A Song,An Artist,3:25,10,20,30,40,,60,70,${ID(5)}`, // a feature is missing
      `A Song,An Artist,soon,10,20,30,40,50,60,70,${ID(6)}`, // bad duration
      row(ID(8)),
    ].join('\n');
    const result = await buildLibrary(csv, lookup);
    expect(parseSongLibrary(result.csv).map((s) => s.id)).toEqual([ID(1), ID(8)]);
    expect(result.kept).toBe(2);
    expect(result.dropped.map((d) => d.line)).toEqual([3, 4, 5, 6, 7]);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      'no Spotify track ID',
      `repeats track ${ID(1)}`,
      `track ${ID(4)} was not found on Spotify`,
      expect.stringContaining('numbers between 0 and 1'),
      expect.stringContaining('durationSeconds'),
    ]);
    expect(lookups).toEqual([ID(1), ID(4), ID(5), ID(6), ID(8)]); // once per distinct ID
  });

  it('names the missing column, and handles an export with no rows', async () => {
    await expect(buildLibrary('', found)).rejects.toThrow(/the export has no ".+" column/);
    await expect(buildLibrary(HEADER.replace('Energy', 'Power'), found)).rejects.toThrow('"energy" column');
    await expect(buildLibrary(HEADER.replace('Spotify Track Id', 'Ref'), found)).rejects.toThrow('"spotify track id" column');
    expect(await buildLibrary(HEADER, found)).toEqual({ csv: `${LIBRARY_HEADER.join(',')}\n`, kept: 0, dropped: [] });
  });

  // spec: toCsv output is read back by parseCsv to the same rows
  it('toCsv round-trips through parseCsv', () => {
    const rows = [['plain', 'with, comma', 'with "quotes"'], ['line\nbreak', 'x', 'y']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('spotifyLookup', () => {
  const respond = (status: number, body: unknown) =>
    (async (url: unknown) => {
      requested.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  const requested: string[] = [];

  // spec: one GET to the oEmbed endpoint; title and cover from the answer
  it('asks the oEmbed endpoint and returns the title and cover', async () => {
    const lookup = spotifyLookup(respond(200, { title: 'Never Gonna Give You Up', thumbnail_url: 'https://i.example/c.jpg' }));
    expect(await lookup('4cOdK2wGLETKBW3PvgPWqT')).toEqual({ title: 'Never Gonna Give You Up', coverUrl: 'https://i.example/c.jpg' });
    expect(requested.at(-1)).toBe('https://open.spotify.com/oembed?url=spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  });

  // spec: undefined only when Spotify says the track does not exist; any other failure rejects
  it('tells a missing track from a failure', async () => {
    expect(await spotifyLookup(respond(404, {}))('x')).toBeUndefined();
    expect(await spotifyLookup(respond(400, {}))('x')).toBeUndefined();
    await expect(spotifyLookup(respond(429, {}))('x')).rejects.toThrow('429');
    await expect(spotifyLookup(respond(500, {}))('x')).rejects.toThrow('500');
    await expect(spotifyLookup(respond(200, { title: 'No cover' }))('x')).rejects.toThrow('no title or cover');
    await expect(spotifyLookup(respond(200, { thumbnail_url: 'https://i.example/c.jpg' }))('x')).rejects.toThrow();
  });

  it('uses the global fetch by default', () => {
    expect(spotifyLookup()).toBeTypeOf('function');
  });
});

describe('writing a pulled library', () => {
  // spec: the first song, then repeatedly the song farthest from everything picked
  it('spreadOut picks songs that cover feature space', () => {
    const songs = [0.5, 0.52, 0.48, 0, 1, 0.25, 0.51].map((level, i) => song(`x${i}`, level));
    expect(spreadOut(songs, 3).map((s) => s.features.values()[0])).toEqual([0.5, 0, 1]);
    expect(spreadOut(songs, 4).map((s) => s.features.values()[0])).toEqual([0.5, 0, 1, 0.25]);
    expect(spreadOut(songs, 99)).toHaveLength(7); // never more than there are
    expect(new Set(spreadOut(songs, 99).map((s) => s.id)).size).toBe(7);
    expect(spreadOut(songs, 1)).toEqual([songs[0]]);
    expect(spreadOut([], 5)).toEqual([]);
  });

  it('R_HOME_11_songsToCsvWritesALibraryTheBackendReadsBack', () => {
    const original = [
      song('abc', [0.334, 0.513, 0.73, 0.00143, 9.54e-5, 0.0897, 0.0598], 200.04),
      song('def', [0, 1, 0.5, 0.25, 0.75, 0.1, 0.9], 59.6),
      { ...song('ghi', 0.5, 0.2), title: 'Comma, "quoted"', artist: 'A, B' },
    ];
    const read = parseSongLibrary(songsToCsv(original));
    expect(read.map((s) => [s.id, s.title, s.artist, s.albumCoverUrl])).toEqual(original.map((s) => [s.id, s.title, s.artist, s.albumCoverUrl]));
    expect(read.map((s) => s.durationSeconds)).toEqual([200, 60, 1]); // whole seconds, at least 1
    read.forEach((s, i) => s.features.values().forEach((value, j) => expect(value).toBeCloseTo(original[i]!.features.values()[j]!, 5)));
  });

  it('the bundled starting library loads and has enough songs', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    if (!existsSync('data/songs.csv')) {
      return; // not built yet on this checkout
    }
    const songs = parseSongLibrary(readFileSync('data/songs.csv', 'utf8'));
    expect(songs.length).toBeGreaterThan(5);
    expect(new Set(songs.map((s) => s.id)).size).toBe(songs.length);
    expect(songs.every((s) => /^https:\/\//.test(s.albumCoverUrl) && /^[0-9A-Za-z]{22}$/.test(s.id))).toBe(true);
  });
});
