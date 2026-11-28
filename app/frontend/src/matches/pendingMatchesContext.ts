/**
 * The context and hooks behind PendingMatchesProvider (PendingMatches.tsx), kept in their own
 * file so React fast refresh works for the provider.
 */
import { createContext, useContext } from 'react';
import type { Match } from '../api/types';

/** How often the pending matches are re-read while the app is open. */
export const PENDING_POLL_MS = 15_000;

export interface PendingState {
  readonly matches: readonly Match[];
  /** How many times the list has been read successfully; goes up with every fresh read. */
  readonly reads: number;
}

export const NONE: readonly Match[] = [];
export const PendingMatchesContext = createContext<PendingState>({ matches: NONE, reads: 0 });

/**
 * Requires: none (outside a PendingMatchesProvider the list is empty).
 * Effects: none.
 * @returns the matches waiting for the logged-in user's answer, best match first
 */
export function usePendingMatches(): readonly Match[] {
  return useContext(PendingMatchesContext).matches;
}

/**
 * Requires: none.
 * Effects: none.
 * @returns a number that goes up each time the pending matches are read afresh, so a page can
 *          tell a list read since it opened from one left over from the page before
 */
export function usePendingMatchReads(): number {
  return useContext(PendingMatchesContext).reads;
}
