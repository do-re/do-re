/**
 * Pure helpers for ProfileView, kept out of the component file so React fast refresh works.
 * The server is the authority; these give fast feedback (CLAUDE.md).
 */

/**
 * Largest picture the client will send: the server's limit (api.md Q-11,
 * AccountModel.MAX_PICTURE_BYTES in the backend). Lambda's request limit is 6 MB after base64
 * encoding, which is 4 MB of image.
 */
export const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

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
  if (file.size > MAX_PICTURE_BYTES) return 'That image is too big. Choose one under 4 MB.';
  return undefined;
}
