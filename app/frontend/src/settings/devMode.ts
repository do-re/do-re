/**
 * The developer mode setting. It only changes what this browser shows, so it is remembered in
 * localStorage rather than on the account.
 */
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'do-re.devMode';

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff developer mode is on in this browser
 */
export function readDevMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Requires: none.
 * Effects: remembers the setting if storage is available.
 */
export function writeDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'on');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the setting lasts until this page is left.
  }
}

/**
 * Requires: called from a React component.
 * Effects: none until the setter is called.
 * @returns whether developer mode is on, and a function that changes and remembers it
 */
export function useDevMode(): readonly [boolean, (on: boolean) => void] {
  const [devMode, setDevModeState] = useState(readDevMode);
  const setDevMode = useCallback((on: boolean) => {
    writeDevMode(on);
    setDevModeState(on);
  }, []);
  return [devMode, setDevMode];
}
