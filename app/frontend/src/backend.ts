/**
 * Chooses what the app runs on. With VITE_API_BASE_URL set, it uses the real server and the
 * Spotify player. Without it, it uses the in-memory demo with fake users and a silent player. The
 * demo is loaded on demand, so its test accounts aren't part of a production bundle.
 */
import type { Api } from './api/client';
import { createHttpApi } from './api/httpApi';
import { createSpotifyPlayer } from './player/spotifyPlayer';
import type { PlayerFactory } from './player/types';
import { notifySessionExpired, readSessionToken } from './session/sessionStore';

export interface Backend {
  readonly api: Api;
  readonly createPlayer: PlayerFactory;
}

/**
 * Requires: baseUrl, if non-blank, is an absolute URL.
 * Effects: loads the demo's code if baseUrl is blank or undefined.
 * @param baseUrl the value of VITE_API_BASE_URL
 * @returns the real server and player if baseUrl is set, otherwise the demo's
 */
export async function selectBackend(baseUrl: string | undefined): Promise<Backend> {
  const url = baseUrl?.trim() ?? '';
  if (url !== '') {
    return {
      api: createHttpApi({ baseUrl: url, getToken: readSessionToken, onUnauthorized: notifySessionExpired }),
      createPlayer: createSpotifyPlayer,
    };
  }
  const [{ createMockApi }, { createSimulatedPlayer }] = await Promise.all([
    import('./api/mock'),
    import('./player/simulatedPlayer'),
  ]);
  // The latency makes pending states (disabled buttons) visible while developing.
  return { api: createMockApi({ latencyMs: 300 }), createPlayer: createSimulatedPlayer };
}
