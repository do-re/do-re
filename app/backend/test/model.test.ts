import { describe, expect, it } from 'vitest';
import { pairId, sha256Hex, systemRandom } from '../src/deps';
import { makeSong, otherUser } from '../src/model/types';
import { AudioFeatures, Feature, FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { parseCsv, parseSongLibrary, SongLibrary } from '../src/song/SongLibrary';
import { song } from './helpers';

const seven = (v: number) => new Array<number>(FEATURE_COUNT).fill(v);

describe('AudioFeatures and TasteVector', () => {
  it('R_HOME_11_audioFeaturesHoldSevenNumbersBetween0And1', () => {
    expect(new AudioFeatures([0, 1, 0.5, 0.25, 0.75, 0.1, 0.9]).values()).toEqual([0, 1, 0.5, 0.25, 0.75, 0.1, 0.9]);
    expect(Feature.VALENCE).toBe(0);
    expect(Feature.SPEECHINESS).toBe(FEATURE_COUNT - 1);
  });

  // spec: the constructor rejects anything that breaks the rep invariant (each partition)
  it.each([
    ['too short', seven(0.5).slice(1)],
    ['too long', [...seven(0.5), 0.5]],
    ['below 0', [-0.001, ...seven(0.5).slice(1)]],
    ['above 1', [1.001, ...seven(0.5).slice(1)]],
    ['NaN', [NaN, ...seven(0.5).slice(1)]],
    ['infinite', [Infinity, ...seven(0.5).slice(1)]],
    ['not a number', ['0.5' as unknown as number, ...seven(0.5).slice(1)]],
  ])('rejects a vector that is %s', (_name, values) => {
    expect(() => new AudioFeatures(values)).toThrow(RangeError);
    expect(() => new TasteVector(values)).toThrow(RangeError);
  });

  // spec: immutable; values() returns a copy and the constructor copies its argument
  it('is immutable and preserves its rep invariant', () => {
    const input = seven(0.2);
    const vector = new TasteVector(input);
    input[0] = 9;
    vector.values()[1] = 9;
    expect(vector.values()).toEqual(seven(0.2));
    expect(() => vector.checkRep()).not.toThrow();
  });

  it('measures distance and equality', () => {
    const zero = new TasteVector(seven(0));
    expect(zero.distanceTo(new AudioFeatures(seven(1)))).toBeCloseTo(Math.sqrt(7));
    expect(zero.distanceTo(zero)).toBe(0);
    expect(zero.equals(new TasteVector(seven(0)))).toBe(true);
    expect(zero.equals(new TasteVector([0.1, ...seven(0).slice(1)]))).toBe(false);
    expect(TasteVector.neutral().values()).toEqual(seven(0.5));
  });
});

describe('Song', () => {
  it('R_HOME_12_aSongCarriesItsAudioFeatures', () => {
    const s = song('abc', 0.3);
    expect(s.features.values()).toEqual(seven(0.3));
    expect(Object.isFrozen(s)).toBe(true);
  });

  // spec: makeSong throws naming the field that breaks the rep invariant
  it.each([
    ['id', { id: '' }],
    ['title', { title: '' }],
    ['artist', { artist: '' }],
    ['albumCoverUrl', { albumCoverUrl: '' }],
    ['durationSeconds', { durationSeconds: 0 }],
    ['durationSeconds', { durationSeconds: NaN }],
    ['spotifyUri', { spotifyUri: 'spotify:track:other' }],
    ['features', { features: undefined }],
  ])('R_HOME_11_rejectsASongWithABad_%s', (field, change) => {
    expect(() => makeSong({ ...song('abc'), ...change } as never)).toThrow(field);
  });
});

describe('SongLibrary and the song file', () => {
  const header = 'Song,Artist,Time,Dance,Energy,Acoustic,Instrumental,Happy,Speech,Live,Spotify Track Id,Spotify Track Img';
  const row = (id: string, more = '') => `"Hello, ""World""",Some Artist,3:25,10,20,30,40,50,60,70,${id},https://img/${id}${more}`;

  it('R_HOME_01_loadsTheLibraryFromTheSongFile', () => {
    const songs = parseSongLibrary(`﻿${header}\r\n${row('a1')}\r\n\r\n${row('b2')}\n`);
    expect(songs.map((s) => s.id)).toEqual(['a1', 'b2']);
    expect(songs[0]).toMatchObject({
      title: 'Hello, "World"',
      artist: 'Some Artist',
      durationSeconds: 205,
      albumCoverUrl: 'https://img/a1',
      spotifyUri: 'spotify:track:a1',
    });
    const library = new SongLibrary(songs);
    expect(library.all()).toHaveLength(2);
    expect(library.get('b2')!.id).toBe('b2');
    expect(library.get('zz')).toBeUndefined();
  });

  it('R_HOME_11_everySongGetsItsSevenFeaturesAsScoreOver100InFeatureOrder', () => {
    const [s] = parseSongLibrary(`${header}\n${row('a1')}`);
    // valence(Happy)=50, dance=10, energy=20, acoustic=30, instrumental=40, live=70, speech=60
    expect(s!.features.values()).toEqual([0.5, 0.1, 0.2, 0.3, 0.4, 0.7, 0.6]);
  });

  it('accepts alternative column names, any column order and other duration formats', () => {
    const csv = [
      'id,valence,danceability,energy,acousticness,instrumentalness,liveness,speechiness,title,artists,duration,cover,extra',
      'x1,0,100,50,50,50,50,50,T,A,1:02:03,http://c,ignored',
      'x2,0,100,50,50,50,50,50,T,A,187.5,http://c,ignored',
      'x3,0,100,50,50,50,50,50,T,A,42,http://c,ignored',
    ].join('\n');
    expect(parseSongLibrary(csv).map((s) => s.durationSeconds)).toEqual([3723, 187.5, 42]);
  });

  // spec: throws RangeError naming the missing column, or the row and problem
  it('R_HOME_11_rejectsAFileWithAMissingColumnOrABadRow', () => {
    expect(() => parseSongLibrary('')).toThrow('spotify track id');
    expect(() => parseSongLibrary(header.replace('Happy', 'Mood'))).toThrow('"happy" column');
    const bad = (line: string) => () => parseSongLibrary(`${header}\n${row('ok')}\n${line}`);
    expect(bad('T,A,3:25,10,20,30,40,,60,70,id,http://c')).toThrow('row 3'); // feature missing
    expect(bad('T,A,3:25,10,20,30,40,150,60,70,id,http://c')).toThrow('row 3'); // feature over 100
    expect(bad('T,A,soon,10,20,30,40,50,60,70,id,http://c')).toThrow('durationSeconds');
    expect(bad('T,A,3:25,10,20,30,40,50,60,70,id')).toThrow('albumCoverUrl'); // short row
  });

  it('rejects duplicate song IDs', () => {
    expect(() => new SongLibrary([song('a'), song('a')])).toThrow('unique');
  });

  it('parseCsv handles quotes, embedded newlines and blank lines', () => {
    expect(parseCsv('a,"b\nc",d\n\n"",\ne')).toEqual([['a', 'b\nc', 'd'], ['e']]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('small helpers', () => {
  it('pairId is the same for both orders and otherUser picks the other side', () => {
    expect(pairId('b', 'a')).toBe('a_b');
    expect(pairId('a', 'b')).toBe('a_b');
    const pair = { userA: 'a', userB: 'b' };
    expect(otherUser(pair, 'a')).toBe('b');
    expect(otherUser(pair, 'b')).toBe('a');
  });

  it('sha256Hex and systemRandom behave as specified', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(systemRandom.id()).toMatch(/^[0-9a-f-]{36}$/);
    expect(systemRandom.id()).not.toBe(systemRandom.id());
    expect(systemRandom.token()).toMatch(/^[\w-]{43}$/);
    expect(systemRandom.bytes(16)).toHaveLength(16);
    for (let i = 0; i < 50; i++) {
      expect([3, 4, 5]).toContain(systemRandom.int(3, 5));
    }
  });
});
