/**
 * HomeView: the /home page (architecture-stubs-v2.java HomeView; layout from the UI sketch with
 * the tag bubbles removed, OPEN-1). Song name and artist at the top; the album cover in the
 * middle with a left arrow button on its left and a right arrow button on its right; the undo,
 * like and play/pause buttons directly under the cover; the time slider and elapsed time at the
 * bottom; a full-page background coloured from the song. Playback is the Spotify embed (OPEN-6),
 * shown as a compact strip under the controls.
 *
 * Team decision OPEN-2: swipe left or the left arrow → next song; swipe right or the right arrow
 * → like + next song; the like button → like, and the same song keeps playing. The undo button
 * goes back to the previous song. In developer mode, the song's stats appear under the player.
 *
 * Satisfies: R-HOME-03, 04, 05, 06, 07, 08, 09, 10, 13, 14, 15, 16, 20, 24, 25.
 * Communicates with: SongController and MatchController (via useApi()), ViewController (via the
 * router), the player (via usePlayerFactory()).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import type { Feedback, Song } from '../api/types';
import { SongStatsPanel } from '../components/DevPanels';
import { PATHS } from '../paths';
import { usePlayerFactory } from '../player/PlayerContext';
import type { PlaybackState, SongPlayer } from '../player/types';
import { useSession } from '../session/SessionContext';
import { useDevMode } from '../settings/devMode';
import './home.css';
import {
  backgroundFor,
  markMatchShown,
  nextListened,
  readNotice,
  stampOpacity,
  swipeDirection,
  wasMatchShown,
} from './homeLogic';
import { LikeBurst } from './LikeBurst';
import { SongProgress } from './SongProgress';

const STOPPED: PlaybackState = { positionSeconds: 0, durationSeconds: 0, isPaused: true };

/** The old card, flying off screen after a swipe. */
interface FlyingCard {
  readonly id: number;
  readonly song: Song;
  readonly direction: 'left' | 'right';
  /** Where the drag left it, so the flight continues from there. */
  readonly fromX: number;
}

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
  const location = useLocation();
  // A one-line message from the previous page, e.g. MatchView after a confirm (OPEN-4). It lasts
  // until the next song, and is cleared from the history so a refresh doesn't bring it back.
  const [notice, setNotice] = useState(() => readNotice(location.state));
  const createPlayer = usePlayerFactory();
  const [devMode] = useDevMode();

  useEffect(() => {
    if (readNotice(location.state) !== null) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const [song, setSong] = useState<Song | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(STOPPED);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [attempt, setAttempt] = useState(0);

  // Animation state.
  const [cardEntrance, setCardEntrance] = useState<{ id: number; kind: 'next' | 'back' }>({ id: 0, kind: 'next' });
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [bursts, setBursts] = useState<readonly number[]>([]);
  const effectId = useRef(0);

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
   * Effects: shows song's title, artist, cover and background, with the card arriving forward or
   *          back; resets the slider, elapsed time and listened time to 0; sets the like button
   *          to isLiked; starts playing song.
   */
  const displaySong = useCallback((next: Song, entrance: 'next' | 'back' = 'next', isLiked = false) => {
    setSong(next);
    setLiked(isLiked);
    setCardEntrance((previous) => ({ id: previous.id + 1, kind: entrance }));
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

    api.songs.canUndo(userId).then(
      (available) => {
        if (!cancelled) setCanUndo(available);
      },
      () => {
        // Not critical: the undo button stays off until the next swipe.
      },
    );

    return () => {
      cancelled = true;
    };
  }, [api, userId, navigate, displaySong, attempt]);

  function playBurst() {
    effectId.current += 1;
    const id = effectId.current;
    setBursts((current) => [...current.slice(-2), id]);
  }

  /**
   * Leaves the current song (stub onSwipeLeft / onSwipeRight).
   * Satisfies: R-HOME-14, R-HOME-15, R-HOME-16, R-HOME-24.
   * Requires: none.
   * Effects: if a song is shown and nothing is in progress, flies the card off that way, waits
   *          for any like still being saved, then sends feedback and the time listened to
   *          SongController (which counts a liked song as LIKE however it is left); then opens
   *          the offered match if there is one, otherwise displays the returned song. On
   *          failure, puts the card back and says what went wrong.
   * @param feedback SKIP or LIKE
   * @param fromX how far the card was dragged, so its flight continues from there
   */
  async function leaveSong(feedback: Feedback, fromX = 0) {
    if (song === null || busy) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    effectId.current += 1;
    setFlyingCard({ id: effectId.current, song, direction: feedback === 'LIKE' ? 'right' : 'left', fromX });
    setIsLeaving(true);
    if (feedback === 'LIKE') playBurst();
    try {
      await likeRequestRef.current?.catch(() => undefined);
      const seconds = Math.min(listenedRef.current, song.durationSeconds);
      const result = await api.songs.submitFeedback(userId, song.id, feedback, seconds);
      setCanUndo(true);
      if (result.offeredMatch !== null) {
        markMatchShown(result.offeredMatch.matchId);
        navigate(PATHS.match(result.offeredMatch.matchId));
        return;
      }
      displaySong(result.nextSong);
    } catch {
      setFlyingCard(null);
      setActionError("Couldn't load the next song. Check your connection and try again.");
    } finally {
      setIsLeaving(false);
      setBusy(false);
    }
  }

  /**
   * The undo button.
   * Requires: none.
   * Effects: if a swipe can be undone and nothing is in progress, returns to the previous song,
   *          with its like button as it was. On failure, stays and says what went wrong.
   */
  async function undoSwipe() {
    if (song === null || busy || !canUndo) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    setFlyingCard(null);
    try {
      await likeRequestRef.current?.catch(() => undefined);
      const result = await api.songs.undoLastSwipe(userId);
      if (result === null) {
        setCanUndo(false);
        return;
      }
      setCanUndo(result.canUndo);
      displaySong(result.song, 'back', result.liked);
    } catch {
      setActionError("Couldn't go back to the previous song. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Stub onLikePressed.
   * Satisfies: R-HOME-10, R-HOME-25.
   * Requires: none.
   * Effects: if a song is shown and not yet liked, shows the like button as liked at once with a
   *          burst of hearts and asks SongController to mark the song liked; playback is not
   *          touched. If saving fails, the button goes back to not liked and an error says to
   *          try again.
   */
  function onLikePressed() {
    if (song === null || liked) return;
    setLiked(true);
    setActionError(null);
    playBurst();
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
    const dx = event.clientX - dragStartRef.current;
    const direction = swipeDirection(dx);
    dragStartRef.current = null;
    setDragX(0);
    if (direction === 'left') void leaveSong('SKIP', dx);
    if (direction === 'right') void leaveSong('LIKE', dx);
  }

  function onPointerCancel() {
    dragStartRef.current = null;
    setDragX(0);
  }

  const duration = playback.durationSeconds > 0 ? playback.durationSeconds : (song?.durationSeconds ?? 0);
  const position = Math.min(playback.positionSeconds, duration);
  const disabled = song === null || busy;

  const frameClasses = ['home__cover-frame', `home__cover-frame--${cardEntrance.kind}`];
  if (isLeaving) frameClasses.push('home__cover-frame--leaving');

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
          className={`home__card${dragX !== 0 ? ' home__card--dragging' : ''}`}
          data-testid="song-card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={dragX !== 0 ? { transform: `translateX(${dragX}px) rotate(${dragX / 25}deg)` } : undefined}
        >
          <div key={`frame-${cardEntrance.id}`} className={frameClasses.join(' ')}>
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

          <span className="home__stamp home__stamp--like" aria-hidden="true" style={{ opacity: stampOpacity(dragX, 'right') }}>
            ♥
          </span>
          <span className="home__stamp home__stamp--skip" aria-hidden="true" style={{ opacity: stampOpacity(dragX, 'left') }}>
            ✕
          </span>

          {flyingCard !== null && (
            <img
              key={`flying-${flyingCard.id}`}
              className={`home__flying-card home__flying-card--${flyingCard.direction}`}
              src={flyingCard.song.albumCoverUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={
                {
                  '--fly-from-x': `${flyingCard.fromX}px`,
                  '--fly-from-turn': `${flyingCard.fromX / 25}deg`,
                } as CSSProperties
              }
              onAnimationEnd={() => setFlyingCard((current) => (current?.id === flyingCard.id ? null : current))}
            />
          )}

          {bursts.map((id) => (
            <LikeBurst key={`burst-${id}`} onDone={() => setBursts((current) => current.filter((other) => other !== id))} />
          ))}
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
          className="home__round home__round--undo"
          aria-label="Go back to previous song"
          onClick={() => void undoSwipe()}
          disabled={disabled || !canUndo}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.5 17.5C17.6 10 9.6 7.6 5 15" />
            <path d="M4.5 8.7l.5 6.3 6.3-.6" />
          </svg>
        </button>
        <button
          type="button"
          className="home__round home__round--like"
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

      <SongProgress
        key={cardEntrance.id}
        positionSeconds={position}
        durationSeconds={duration}
        isPaused={playback.isPaused}
        disabled={song === null}
        onSeek={onSliderMoved}
      />

      <div className="home__player" ref={playerHostRef} />

      {devMode && song !== null && <SongStatsPanel song={song} />}
    </main>
  );
}
