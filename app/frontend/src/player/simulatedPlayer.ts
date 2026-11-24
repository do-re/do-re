/**
 * A silent stand-in for the Spotify embed, used only with the mock backend because its songs have
 * placeholder track IDs. The time, slider and play/pause all behave as they will with real tracks,
 * and the strip says there's no sound so nobody mistakes it for a bug.
 *
 * Abstraction function: a 30-second track at `position` seconds, paused iff `paused`.
 * Rep invariant: 0 <= position <= DEMO_TRACK_SECONDS; timer is set iff a track is playing.
 */
import type { PlaybackState, SongPlayer } from './types';

export const DEMO_TRACK_SECONDS = 30;
/** How often playback updates are sent. Must stay under homeLogic's MAX_LISTEN_STEP_S. */
export const DEMO_TICK_MS = 500;

/**
 * Requires: container is attached to the document.
 * Effects: shows a strip in container saying the demo has no sound.
 * @returns a player that counts time silently
 */
export function createSimulatedPlayer(container: HTMLElement): SongPlayer {
  const listeners = new Set<(state: PlaybackState) => void>();
  let position = 0;
  let paused = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const strip = document.createElement('p');
  strip.className = 'home__demo-player';
  strip.textContent = 'Demo player: no sound until real Spotify tracks are added.';
  container.appendChild(strip);

  function emit() {
    const state: PlaybackState = { positionSeconds: position, durationSeconds: DEMO_TRACK_SECONDS, isPaused: paused };
    for (const listener of listeners) listener(state);
  }

  function stopTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      position = Math.min(DEMO_TRACK_SECONDS, position + DEMO_TICK_MS / 1000);
      if (position === DEMO_TRACK_SECONDS) {
        paused = true;
        stopTimer();
      }
      emit();
    }, DEMO_TICK_MS);
  }

  return {
    load() {
      position = 0;
      paused = false;
      startTimer();
      emit();
    },
    togglePlay() {
      paused = !paused;
      if (paused) {
        stopTimer();
      } else {
        if (position === DEMO_TRACK_SECONDS) position = 0;
        startTimer();
      }
      emit();
    },
    seek(seconds) {
      position = Math.min(DEMO_TRACK_SECONDS, Math.max(0, seconds));
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      stopTimer();
      listeners.clear();
      strip.remove();
    },
  };
}
