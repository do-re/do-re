/**
 * The audio player HomeView talks to. The real one wraps the Spotify embed (spotifyPlayer.ts);
 * tests use a fake (src/test/fakePlayer.ts), as testing.md asks ("mock the Spotify embed
 * player in component tests").
 */

/** What the player reports while a song is loaded. */
export interface PlaybackState {
  /** Seconds from the start of the track. Rep invariant: 0 <= positionSeconds. */
  readonly positionSeconds: number;
  /**
   * Length of what is playing, in seconds. For listeners not logged in to Spotify this is the
   * preview clip's length, not the full song's (OPEN-6).
   */
  readonly durationSeconds: number;
  readonly isPaused: boolean;
}

export interface SongPlayer {
  /**
   * Requires: uri is a "spotify:track:..." URI.
   * Effects: replaces the current track with uri and starts playing it from 0 (the browser
   *          may block autoplay; subscribers then see isPaused = true).
   */
  load(uri: string): void;

  /**
   * Requires: none.
   * Effects: pauses if playing; otherwise resumes from the paused position.
   */
  togglePlay(): void;

  /**
   * Requires: 0 <= seconds <= the loaded track's duration.
   * Effects: playback position becomes seconds.
   */
  seek(seconds: number): void;

  /**
   * Requires: none.
   * Effects: listener is called with every playback update until the returned function is called.
   * @returns a function that removes listener
   */
  subscribe(listener: (state: PlaybackState) => void): () => void;

  /**
   * Requires: none.
   * Effects: stops playback, removes the player from the page and drops all listeners.
   *          No method may be called afterwards.
   */
  destroy(): void;
}

/**
 * Creates a player inside container (an empty element the caller owns).
 * Requires: container is attached to the document and stays so until destroy().
 */
export type PlayerFactory = (container: HTMLElement) => SongPlayer;
