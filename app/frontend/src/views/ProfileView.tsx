/**
 * ProfileView: the /profile page (architecture-stubs-v2.java ProfileView). Shows the username
 * and profile picture; a form to change the username; a button that opens a popup to upload a
 * new picture. Also a "Log out" button, since no other page offers one.
 *
 * Satisfies: (no numbered requirement; architecture.md ProfileView) R-UI-04 via the bottom bar.
 * Communicates with: AccountController (via useApi().account), ViewController (via the router
 * and the session).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../api/ApiContext';
import type { UserProfile } from '../api/types';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { TextField } from '../components/TextField';
import { useSession } from '../session/SessionContext';
import './auth.css';
import './profile.css';
import { validatePicture, validateUsername } from './profileLogic';

type LoadState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; profile: UserProfile };

/**
 * The /profile page.
 * Requires: rendered inside ApiProvider, SessionProvider (with a logged-in user) and a router.
 * Effects: loads the user's profile and shows it (stub displayProfile).
 */
export function ProfileView() {
  const api = useApi();
  const session = useSession();
  const userId = session.userId!;

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [savingName, setSavingName] = useState(false);

  const [pictureOpen, setPictureOpen] = useState(false);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [pictureError, setPictureError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const changePictureRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.account.getProfile(userId).then(
      (profile) => {
        if (cancelled) return;
        setLoad({ kind: 'ready', profile });
        setUsername(profile.username);
      },
      () => {
        if (!cancelled) setLoad({ kind: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, userId, attempt]);

  /**
   * Stub onUsernameSubmitted.
   * Requires: none.
   * Effects: if the box is empty, says what to fix and sends nothing; if the name is unchanged,
   *          says so and sends nothing; otherwise disables the button, sends the trimmed name
   *          to AccountController and, on success, shows it as the username and says it was
   *          saved. On failure, keeps the typed name and says what to do.
   */
  async function onUsernameSubmitted(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (load.kind !== 'ready' || savingName) return;
    const error = validateUsername(username);
    setUsernameError(error);
    setNotice(null);
    if (error !== undefined) {
      usernameRef.current?.focus();
      return;
    }
    const trimmed = username.trim();
    if (trimmed === load.profile.username) {
      setUsername(trimmed);
      setNotice("That's already your username.");
      return;
    }
    setSavingName(true);
    try {
      await api.account.updateUsername(userId, trimmed);
      setLoad({ kind: 'ready', profile: { ...load.profile, username: trimmed } });
      setUsername(trimmed);
      setNotice('Username saved.');
    } catch {
      setUsernameError("Couldn't save your username. Check your connection and try again.");
    } finally {
      setSavingName(false);
    }
  }

  /** Stub onChangePicturePressed. Effects: opens the upload popup with nothing chosen. */
  function onChangePicturePressed() {
    setPictureFile(null);
    setPictureError(undefined);
    setNotice(null);
    setPictureOpen(true);
  }

  function closePicturePopup() {
    if (!uploading) setPictureOpen(false);
  }

  /**
   * Stub onImageUploaded.
   * Requires: the popup is open.
   * Effects: if the chosen file isn't a non-empty image under the size cap, says what to fix
   *          and sends nothing; otherwise disables the popup's buttons, sends the image to
   *          AccountController, reloads the profile, closes the popup and shows the new
   *          picture. On failure, keeps the popup open and says what to do.
   */
  async function onImageUploaded(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const error = validatePicture(pictureFile);
    setPictureError(error);
    if (error !== undefined) return;
    setUploading(true);
    try {
      await api.account.updateProfilePicture(userId, pictureFile!);
      const profile = await api.account.getProfile(userId);
      setLoad({ kind: 'ready', profile });
      setPictureOpen(false);
      setNotice('Profile picture updated.');
    } catch {
      setPictureError("Couldn't upload your picture. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="page profile">
      <h1 className="profile__title">Profile</h1>

      {load.kind === 'loading' && <p role="status">Loading your profile…</p>}

      {load.kind === 'failed' && (
        <div role="alert">
          <p>Couldn't load your profile. Check your connection and try again.</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setLoad({ kind: 'loading' });
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {load.kind === 'ready' && (
        <>
          <div className="profile__identity">
            <Avatar profile={load.profile} label="you" size="lg" />
            <p className="profile__name">{load.profile.username}</p>
            <button
              ref={changePictureRef}
              type="button"
              className="button-secondary"
              onClick={onChangePicturePressed}
            >
              Change profile picture
            </button>
          </div>

          {notice !== null && (
            <p className="profile__notice" role="status">
              {notice}
            </p>
          )}

          <form className="auth-form" onSubmit={onUsernameSubmitted} noValidate aria-busy={savingName}>
            <TextField
              id="profile-username"
              label="Username"
              name="username"
              autoComplete="nickname"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onValueChange={(value) => {
                setUsername(value);
                setUsernameError(undefined);
              }}
              error={usernameError}
              inputRef={usernameRef}
            />
            <button type="submit" className="button-primary" disabled={savingName}>
              {savingName ? 'Saving…' : 'Save username'}
            </button>
          </form>

          <button type="button" className="profile__logout" onClick={session.logOut}>
            Log out
          </button>
        </>
      )}

      {pictureOpen && (
        <Modal title="Change profile picture" onClose={closePicturePopup} returnFocusTo={changePictureRef}>
          <form className="auth-form" onSubmit={onImageUploaded} noValidate aria-busy={uploading}>
            <div className="field">
              <label htmlFor="profile-picture">Choose an image</label>
              <input
                id="profile-picture"
                name="picture"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setPictureFile(event.target.files?.[0] ?? null);
                  setPictureError(undefined);
                }}
                aria-invalid={pictureError !== undefined}
                aria-describedby={pictureError !== undefined ? 'profile-picture-error' : 'profile-picture-hint'}
              />
              {pictureError !== undefined ? (
                <p id="profile-picture-error" className="field__error">
                  {pictureError}
                </p>
              ) : (
                <p id="profile-picture-hint" className="profile__hint">
                  JPG, PNG or another image, up to 5 MB.
                </p>
              )}
            </div>
            <div className="modal__actions">
              <button type="submit" className="button-primary" disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
              <button type="button" className="button-secondary" onClick={closePicturePopup} disabled={uploading}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
