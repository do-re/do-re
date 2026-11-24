/**
 * How a profile is named on screen. New accounts start with a blank username (R-ACC-09), and a
 * user's email must never be shown in its place.
 */
import type { UserProfile } from './types';

/** Shown for an account that hasn't chosen a username yet. */
export const BLANK_USERNAME_LABEL = 'New user';

/**
 * Requires: none.
 * Effects: none.
 * @returns the profile's username, or BLANK_USERNAME_LABEL if it is blank
 */
export function displayName(profile: Pick<UserProfile, 'username'>): string {
  const name = profile.username.trim();
  return name === '' ? BLANK_USERNAME_LABEL : name;
}
