/**
 * Root component: wires the backend (Api), the audio player and the session around the routes.
 * main.tsx passes the real browser router; tests pass a MemoryRouter.
 */
import type { Api } from './api/client';
import { ApiProvider } from './api/ApiContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PlayerProvider } from './player/PlayerContext';
import { createSpotifyPlayer } from './player/spotifyPlayer';
import type { PlayerFactory } from './player/types';
import { AppRoutes } from './routes';
import { SessionProvider } from './session/SessionContext';

export interface AppProps {
  readonly api: Api;
  /** Overrides the stored session; tests use it to start logged in or out. */
  readonly initialUserId?: string | null;
  /** The audio player. Defaults to the Spotify embed; tests pass a fake. Requires: stable. */
  readonly createPlayer?: PlayerFactory;
}

export function App({ api, initialUserId, createPlayer = createSpotifyPlayer }: AppProps) {
  return (
    <ApiProvider api={api}>
      <PlayerProvider factory={createPlayer}>
        <SessionProvider initialUserId={initialUserId}>
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
        </SessionProvider>
      </PlayerProvider>
    </ApiProvider>
  );
}
