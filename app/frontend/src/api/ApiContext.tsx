/**
 * Makes the Api available to every view, so a test (or main.tsx) chooses the backend:
 * the in-memory mock now, the HTTP client once Felix's Lambdas are up (Nov 22).
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Api } from './client';

const ApiContext = createContext<Api | null>(null);

/**
 * Requires: none.
 * Effects: makes api available to useApi() in children.
 */
export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

/**
 * Requires: called inside an ApiProvider.
 * Effects: none.
 * @returns the provided Api
 */
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi must be used inside an ApiProvider');
  return api;
}
