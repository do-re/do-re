/**
 * HomeView: the /home page (architecture-stubs-v2.java HomeView; layout from the UI sketch with
 * the tag bubbles removed, OPEN-1). Song name and artist at the top; the album cover in the
 * middle with a left arrow button on its left and a right arrow button on its right; the like
 * and play/pause buttons directly under the cover; the time slider and elapsed time at the
 * bottom; a full-page background coloured from the song. Playback is the Spotify embed (OPEN-6),
 * shown as a compact strip under the controls.
 *
 * Team decision OPEN-2: swipe left or the left arrow → next song; swipe right or the right arrow
 * → like + next song; the like button → like, and the same song keeps playing.
 *
 * Satisfies: R-HOME-03, 04, 05, 06, 07, 08, 09, 10, 13, 14, 15, 16, 20, 24, 25.
 * Communicates with: SongController and MatchController (via useApi()), ViewController (via the
 * router), the player (via usePlayerFactory()).
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import type { Feedback, Song } from '../api/types';
import { PATHS } from '../paths';
import { usePlayerFactory } from '../player/PlayerContext';
import type { PlaybackState, SongPlayer } from '../player/types';
import { useSession } from '../session/SessionContext';
import './home.css';
import { backgroundFor, formatTime, markMatchShown, nextListened, swipeDirection, wasMatchShown } from './homeLogic';

const STOPPED: PlaybackState = { positionSeconds: 0, durationSeconds: 0, isPaused: true };

/**
 * The /home page.
 * Requires: rendered inside ApiProvider, SessionProvider (with a logged-in user) and a router.
 * Effects: on opening, shows the user's active song and starts playing it; if a pending match
 *          has not been shown in this tab yet, opens it instead (R-HOME-20).
 */
export function HomeView() {
  const api = useApi();
  const userId = useSession().userId!;
  const navigate = useNavigate();
  // A one-line message from the previous page, e.g. MatchView after a confirm (OPEN-4).
  const locationState: unknown = useLocation().state;
  const notice =
    typeof locationState === 'object' && locationState !== null && 'notice' in locationState &&
    typeof locationState.notice === 'string' ? locationState.notice : null;
  const createPlayer = usePlayerFactory();

  const [song, setSong] = useState<Song | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(STOPPED);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SongPlayer | null>(null);
  const listenedRef = useRef(0);
  const lastPlaybackRef = useRef<PlaybackState | null>(null);
  const likeRequestRef = useRef<Promise<void> | null>(null);
  const dragStartRef = useRef<number | null>(null);

  // One player for the life of the page. Its updates drive the slider, the elapsed time, the
  // play/pause button and the listened-time count.
  useEffect(() => {
    const player = createPlayer(playerHostRef.current!);
    playerRef.current = player;
    const unsubscribe = player.subscribe((state) => {
      listenedRef.current = nextListened(listenedRef.current, lastPlaybackRef.current, state);
      lastPlaybackRef.current = state;
      setPlayback(state);
    });
    return () => {
      unsubscribe();
      player.destroy();
      playerRef.current = null;
    };
  }, [createPlayer]);

  /**
   * Stub displaySong.
   * Satisfies: R-HOME-03, R-HOME-04, R-HOME-05, R-HOME-09, R-HOME-13.
   * Requires: none.
   * Effects: shows song's title, artist, cover and background; resets the slider, elapsed time
   *          and listened time to 0; shows the like button as not liked; starts playing song.
   */
  const displaySong = useCallback((next: Song) => {
    setSong(next);
    setLiked(false);
    likeRequestRef.current = null;
    listenedRef.current = 0;
    lastPlaybackRef.current = null;
    setPlayback({ positionSeconds: 0, durationSeconds: next.durationSeconds, isPaused: false });
    playerRef.current?.load(next.spotifyUri);
  }, []);

  // Opening the page: show a pending match first if there is one (R-HOME-20), else the song.
  useEffect(() => {
    let cancelled = false;

    api.matches.getPendingMatches(userId).then(
      (pending) => {
        const unseen = pending.find((m) => !wasMatchShown(m.matchId));
        if (cancelled || unseen === undefined) return;
        markMatchShown(unseen.matchId);
        navigate(PATHS.match(unseen.matchId));
      },
      () => {
        // Not critical: the match is offered again next time the page opens.
      },
    );

    api.songs.getCurrentSong(userId).then(
      (current) => {
        if (!cancelled) displaySong(current);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api, userId, navigate, displaySong, attempt]);

  /**
   * Leaves the current song (stub onSwipeLeft / onSwipeRight).
   * Satisfies: R-HOME-14, R-HOME-15, R-HOME-16, R-HOME-24.
   * Requires: none.
   * Effects: if a song is shown and nothing is in progress, waits for any like still being
   *          saved, then sends feedback and the time listened to SongController (which counts
   *          a liked song as LIKE however it is left); then opens the offered match if there
   *          is one, otherwise displays the returned song. On failure, keeps the song and says
   *          what went wrong.
   */
  async function leaveSong(feedback: Feedback) {
    if (song === null || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await likeRequestRef.current?.catch(() => undefined);
      const seconds = Math.min(listenedRef.current, song.durationSeconds);
      const result = await api.songs.submitFeedback(userId, song.id, feedback, seconds);
      if (result.offeredMatch !== null) {
        markMatchShown(result.offeredMatch.matchId);
        navigate(PATHS.match(result.offeredMatch.matchId));
        return;
      }
      displaySong(result.nextSong);
    } catch {
      setActionError("Couldn't load the next song. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Stub onLikePressed.
   * Satisfies: R-HOME-10, R-HOME-25.
   * Requires: none.
   * Effects: if a song is shown and not yet liked, shows the like button as liked at once and
   *          asks SongController to mark the song liked; playback is not touched. If saving
   *          fails, the button goes back to not liked and an error says to try again.
   */
  function onLikePressed() {
    if (song === null || liked) return;
    setLiked(true);
    setActionError(null);
    const request = api.songs.markLiked(userId, song.id);
    likeRequestRef.current = request;
    request.catch(() => {
      if (likeRequestRef.current !== request) return; // song already changed
      setLiked(false);
      setActionError("Couldn't save your like. Try again.");
    });
  }

  /**
   * Stub onPauseToggled.
   * Satisfies: R-HOME-06, R-HOME-07, R-HOME-08.
   * Effects: pauses if playing, otherwise resumes from the paused position. The button changes
   *          when the player reports the new state.
   */
  function onPauseToggled() {
    playerRef.current?.togglePlay();
  }

  /** Stub onSliderMoved. Effects: playback position becomes seconds. */
  function onSliderMoved(seconds: number) {
    playerRef.current?.seek(seconds);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStartRef.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current !== null) setDragX(event.clientX - dragStartRef.current);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current === null) return;
    const direction = swipeDirection(event.clientX - dragStartRef.current);
    dragStartRef.current = null;
    setDragX(0);
    if (direction === 'left') void leaveSong('SKIP');
    if (direction === 'right') void leaveSong('LIKE');
  }

  function onPointerCancel() {
    dragStartRef.current = null;
    setDragX(0);
  }

  const duration = playback.durationSeconds > 0 ? playback.durationSeconds : (song?.durationSeconds ?? 0);
  const position = Math.min(playback.positionSeconds, duration);
  const disabled = song === null || busy;

  return (
    <main className="home">
      <div
        className="home__background"
        aria-hidden="true"
        style={song !== null ? { background: backgroundFor(song.features) } : undefined}
      />
      <h1 className="visually-hidden">Home</h1>

      {notice !== null && (
        <p className="home__notice" role="status">
          {notice}
        </p>
      )}

      <header className="home__header" aria-live="polite">
        {song !== null && (
          <>
            <h2 className="home__title">{song.title}</h2>
            <p className="home__artist">{song.artist}</p>
          </>
        )}
        {song === null && !loadFailed && <p role="status">Loading your next song…</p>}
      </header>

      {loadFailed && (
        <div className="home__problem" role="alert">
          <p>Couldn't load a song. Check your connection and try again.</p>
          <button
            type="button"
            className="home__pill"
            onClick={() => {
              setLoadFailed(false);
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      <div className="home__stage">
        <button
          type="button"
          className="home__arrow"
          aria-label="Skip song"
          onClick={() => void leaveSong('SKIP')}
          disabled={disabled}
        >
          <span aria-hidden="true">←</span>
        </button>

        <div
          className="home__card"
          data-testid="song-card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={dragX !== 0 ? { transform: `translateX(${dragX}px) rotate(${dragX / 25}deg)` } : undefined}
        >
          {song !== null ? (
            <img
              className="home__cover"
              src={song.albumCoverUrl}
              alt={`Album cover of ${song.title} by ${song.artist}`}
              draggable={false}
            />
          ) : (
            <div className="home__cover home__cover--empty" />
          )}
        </div>

        <button
          type="button"
          className="home__arrow"
          aria-label="Like and next song"
          onClick={() => void leaveSong('LIKE')}
          disabled={disabled}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="home__controls">
        <button
          type="button"
          className="home__round"
          aria-label="Like"
          aria-pressed={liked}
          onClick={onLikePressed}
          disabled={song === null}
        >
          <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
        </button>
        <button
          type="button"
          className="home__round home__round--main"
          aria-label={playback.isPaused ? 'Play' : 'Pause'}
          onClick={onPauseToggled}
          disabled={song === null}
        >
          <span aria-hidden="true">{playback.isPaused ? '▶' : '❚❚'}</span>
        </button>
      </div>

      {actionError !== null && (
        <p className="home__problem" role="alert">
          {actionError}
        </p>
      )}

      <div className="home__progress">
        <input
          type="range"
          className="home__slider"
          aria-label="Playback position"
          aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={position}
          onChange={(event) => onSliderMoved(Number(event.target.value))}
          disabled={song === null}
        />
        <p className="home__time">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </p>
      </div>

      <div className="home__player" ref={playerHostRef} />
    </main>
  );
}
