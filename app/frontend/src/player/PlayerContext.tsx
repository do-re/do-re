/**
 * Supplies the PlayerFactory to HomeView: the Spotify embed in the app, a fake in tests.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { createSpotifyPlayer } from './spotifyPlayer';
import type { PlayerFactory } from './types';

const PlayerContext = createContext<PlayerFactory>(createSpotifyPlayer);

/**
 * Requires: factory is stable (the same function on every render), or players are recreated.
 * Effects: makes factory available to usePlayerFactory() in children.
 */
export function PlayerProvider({ factory, children }: { factory: PlayerFactory; children: ReactNode }) {
  return <PlayerContext.Provider value={factory}>{children}</PlayerContext.Provider>;
}

/**
 * Requires: none.
 * Effects: none.
 * @returns the provided PlayerFactory, or the Spotify one if none was provided
 */
export function usePlayerFactory(): PlayerFactory {
  return useContext(PlayerContext);
}
