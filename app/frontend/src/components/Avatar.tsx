/**
 * A round profile picture. Without a picture it shows the username's first letter.
 * Used by MatchView and ProfileView.
 */
import { displayName } from '../api/profile';
import type { UserProfile } from '../api/types';

export interface AvatarProps {
  readonly profile: UserProfile;
  /** Who this is, for the accessible name, e.g. "You" or the username. */
  readonly label: string;
  /** Diameter: "md" on MatchView, "lg" on ProfileView. Default "md". */
  readonly size?: 'md' | 'lg';
}

/**
 * Requires: none.
 * Effects: renders the picture (alt "Profile picture of <label>") or the initial
 *          (labelled "No profile picture for <label>").
 */
export function Avatar({ profile, label, size = 'md' }: AvatarProps) {
  const className = `avatar avatar--${size}`;
  if (profile.profilePictureUrl !== null) {
    return <img className={className} src={profile.profilePictureUrl} alt={`Profile picture of ${label}`} />;
  }
  return (
    <div className={`${className} avatar--empty`} role="img" aria-label={`No profile picture for ${label}`}>
      {displayName(profile).charAt(0).toUpperCase()}
    </div>
  );
}
