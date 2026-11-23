/**
 * SongPlayer backed by the Spotify embed player's iFrame API (OPEN-6):
 * https://developer.spotify.com/documentation/embeds/references/iframe-api
 *
 * The API script calls window.onSpotifyIframeApiReady(IFrameAPI) once loaded;
 * IFrameAPI.createController(element, options, callback) replaces element with an <iframe>
 * and hands back an EmbedController (loadUri, play, togglePlay, seek, destroy, addListener).
 * Its "playback_update" event carries { isPaused, isBuffering, duration, position }, with
 * duration and position in milliseconds.
 *
 * The embed stays visible as a compact strip, which keeps Spotify's attribution on screen.
 *
 * NOT YET CHECKED AGAINST REAL SPOTIFY: the mock songs have placeholder URIs (mockSeed.ts).
 * Check this file by hand once real track URIs exist (notes-for-felix F-8).
 */
import type { PlaybackState, SongPlayer } from './types';

export const SPOTIFY_IFRAME_API_URL = 'https://open.spotify.com/embed/iframe-api/v1';

/** The part of Spotify's EmbedController this app uses. */
export interface SpotifyEmbedController {
  loadUri(uri: string): void;
  play(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  destroy(): void;
  addListener(event: 'ready' | 'playback_update', callback: (event: { data: SpotifyPlaybackData }) => void): void;
}

export interface SpotifyPlaybackData {
  readonly isPaused: boolean;
  readonly isBuffering?: boolean;
  /** Milliseconds. */
  readonly duration: number;
  /** Milliseconds. */
  readonly position: number;
}

export interface SpotifyIframeApi {
  createController(
    element: HTMLElement,
    options: { uri: string; width?: string | number; height?: string | number },
    callback: (controller: SpotifyEmbedController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

let apiPromise: Promise<SpotifyIframeApi> | null = null;

/**
 * Requires: running in a browser.
 * Effects: on the first call, adds Spotify's iFrame API script to the page; later calls share
 *          the same load. If the script fails to load, the next call tries again.
 * @returns the loaded IFrameAPI
 */
export function loadSpotifyIframeApi(): Promise<SpotifyIframeApi> {
  if (apiPromise !== null) return apiPromise;
  apiPromise = new Promise<SpotifyIframeApi>((resolve, reject) => {
    window.onSpotifyIframeApiReady = resolve;
    const script = document.createElement('script');
    script.src = SPOTIFY_IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error('Could not load the Spotify player'));
    };
    document.body.appendChild(script);
  });
  return apiPromise;
}

/** Test hook: forgets a loaded API so the next loadSpotifyIframeApi() starts over. */
export function resetSpotifyIframeApiForTests(): void {
  apiPromise = null;
  delete window.onSpotifyIframeApiReady;
}

/**
 * Creates a SongPlayer that plays through a Spotify embed inside container. The embed is
 * created on the first load() (the API needs a URI to create it).
 * Requires: container is attached to the document.
 * Effects: none until load() is called.
 * @param loadApi how to get the IFrameAPI (tests pass a fake)
 */
export function createSpotifyPlayer(
  container: HTMLElement,
  loadApi: () => Promise<SpotifyIframeApi> = loadSpotifyIframeApi,
): SongPlayer {
  const listeners = new Set<(state: PlaybackState) => void>();
  let controller: SpotifyEmbedController | null = null;
  let creating = false;
  let destroyed = false;
  /** The URI to play once the controller exists (the latest load() wins). */
  let wantedUri: string | null = null;

  function emit(data: SpotifyPlaybackData) {
    const state: PlaybackState = {
      positionSeconds: Math.max(0, data.position / 1000),
      durationSeconds: Math.max(0, data.duration / 1000),
      isPaused: data.isPaused,
    };
    for (const listener of listeners) listener(state);
  }

  function create(uri: string) {
    creating = true;
    const host = document.createElement('div');
    container.appendChild(host);
    loadApi().then(
      (api) => {
        if (destroyed) return;
        api.createController(host, { uri, width: '100%', height: 80 }, (c) => {
          if (destroyed) {
            c.destroy();
            return;
          }
          controller = c;
          creating = false;
          c.addListener('playback_update', (event) => emit(event.data));
          c.addListener('ready', () => c.play());
          if (wantedUri !== null && wantedUri !== uri) {
            c.loadUri(wantedUri);
            c.play();
          }
          wantedUri = null;
        });
      },
      () => {
        // Script failed to load: allow the next load() to try again.
        creating = false;
        host.remove();
      },
    );
  }

  return {
    load(uri) {
      if (destroyed) return;
      if (controller !== null) {
        controller.loadUri(uri);
        controller.play();
        return;
      }
      wantedUri = uri;
      if (!creating) create(uri);
    },
    togglePlay() {
      controller?.togglePlay();
    },
    seek(seconds) {
      controller?.seek(seconds);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      destroyed = true;
      listeners.clear();
      controller?.destroy();
      controller = null;
      container.replaceChildren();
    },
  };
}
