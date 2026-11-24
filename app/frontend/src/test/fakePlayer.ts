/**
 * Test double for the Spotify player. Records what HomeView asks for and lets a test play the
 * song forward by emitting playback updates, like the real embed's playback_update events.
 * Wrap emits in act() when they happen outside a user event.
 */
import type { PlaybackState, PlayerFactory, SongPlayer } from '../player/types';

export class FakePlayer implements SongPlayer {
  /** URIs passed to load(), oldest first. */
  readonly loaded: string[] = [];
  /** Positions passed to seek(), oldest first. */
  readonly seeks: number[] = [];
  toggles = 0;
  destroyed = false;
  /** The element HomeView gave the factory. */
  container: HTMLElement | null = null;
  state: PlaybackState = { positionSeconds: 0, durationSeconds: 30, isPaused: true };
  /** When true, load() reports the song as paused, as when the browser blocks autoplay. */
  autoplayBlocked = false;

  private readonly listeners = new Set<(state: PlaybackState) => void>();

  /** A factory that always hands out this player. */
  readonly factory: PlayerFactory = (container) => {
    this.container = container;
    this.destroyed = false;
    return this;
  };

  load(uri: string): void {
    this.loaded.push(uri);
    this.emit({ positionSeconds: 0, durationSeconds: 30, isPaused: this.autoplayBlocked });
  }

  togglePlay(): void {
    this.toggles++;
    this.emit({ ...this.state, isPaused: !this.state.isPaused });
  }

  seek(seconds: number): void {
    this.seeks.push(seconds);
    this.emit({ ...this.state, positionSeconds: seconds });
  }

  subscribe(listener: (state: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  /** Sends one playback update to every subscriber. */
  emit(state: PlaybackState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Plays forward one second at a time, like a running embed. Requires: seconds >= 0. */
  playFor(seconds: number): void {
    for (let i = 0; i < seconds; i++) {
      this.emit({ ...this.state, positionSeconds: this.state.positionSeconds + 1 });
    }
  }
}
