/**
 * Pure helpers for ProfileView, kept out of the component file so React fast refresh works.
 * The server is the authority; these give fast feedback (CLAUDE.md).
 */

/**
 * Largest picture the client will send. The stub only says "non-empty image file"; this cap
 * keeps an upload under AWS Lambda's ~6 MB request limit. Confirm with Felix (notes F-3).
 */
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/**
 * Same rule as AccountController.updateUsername: the username must be non-empty.
 * Requires: none.
 * Effects: none.
 * @returns what to fix, or undefined if username (after trimming) is non-empty
 */
export function validateUsername(username: string): string | undefined {
  return username.trim() === '' ? 'Enter a username.' : undefined;
}

/**
 * Same rule as AccountController.updateProfilePicture (a non-empty image file), plus the
 * MAX_PICTURE_BYTES cap.
 * Requires: none.
 * Effects: none.
 * @returns what to fix, or undefined if file is a non-empty image of at most MAX_PICTURE_BYTES
 */
export function validatePicture(file: File | null): string | undefined {
  if (file === null) return 'Choose an image file.';
  if (!file.type.startsWith('image/')) return 'That file is not an image. Choose a JPG, PNG or other image file.';
  if (file.size === 0) return 'That file is empty. Choose another image.';
  if (file.size > MAX_PICTURE_BYTES) return 'That image is too big. Choose one under 5 MB.';
  return undefined;
}
