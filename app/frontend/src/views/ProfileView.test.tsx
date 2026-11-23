import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../api/mock';
import { renderApp } from '../test/renderApp';
import { MAX_PICTURE_BYTES, validatePicture, validateUsername } from './profileLogic';

async function openProfile() {
  const rendered = renderApp({ path: '/profile', userId: 'u-demo' });
  await screen.findByText('demo', { selector: '.profile__name' });
  return rendered;
}

const usernameBox = () => screen.getByLabelText('Username');
const saveButton = () => screen.getByRole('button', { name: /save username|saving/i });
const png = (bytes = 10, name = 'me.png') => new File(['x'.repeat(bytes)], name, { type: 'image/png' });

async function openPicturePopup() {
  await userEvent.click(screen.getByRole('button', { name: 'Change profile picture' }));
  return screen.getByRole('dialog', { name: 'Change profile picture' });
}

describe('ProfileView display', () => {
  it('shows the username and profile picture (initial when none), with the bottom bar', async () => {
    await openProfile();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'No profile picture for you' })).toHaveTextContent('D');
    expect(usernameBox()).toHaveValue('demo');
    expect(usernameBox()).toHaveAttribute('autocomplete', 'nickname');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('shows a loading message first', () => {
    renderApp({ path: '/profile', userId: 'u-demo' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading your profile…');
  });

  it('if loading fails, says so and offers to try again', async () => {
    const get = vi.spyOn(MockBackend.prototype, 'getProfile').mockRejectedValueOnce(new Error('offline'));
    try {
      renderApp({ path: '/profile', userId: 'u-demo' });
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your profile");
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('demo', { selector: '.profile__name' })).toBeInTheDocument();
    } finally {
      get.mockRestore();
    }
  });
});

describe('ProfileView username', () => {
  it('saves a new username (trimmed), shows it and says it was saved', async () => {
    const { api } = await openProfile();
    await userEvent.clear(usernameBox());
    await userEvent.type(usernameBox(), '  dj-demo  {Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent('Username saved.');
    expect(screen.getByText('dj-demo', { selector: '.profile__name' })).toBeInTheDocument();
    expect(usernameBox()).toHaveValue('dj-demo');
    expect((await api.account.getProfile('u-demo')).username).toBe('dj-demo');
  });

  it('an empty username says what to fix, focuses the box and sends nothing', async () => {
    const { api } = await openProfile();
    const update = vi.spyOn(api.account, 'updateUsername');
    await userEvent.clear(usernameBox());
    await userEvent.type(usernameBox(), '   ');
    await userEvent.click(saveButton());
    expect(usernameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(usernameBox()).toHaveAccessibleDescription('Enter a username.');
    expect(usernameBox()).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
    await userEvent.type(usernameBox(), 'x');
    expect(usernameBox()).toHaveAttribute('aria-invalid', 'false');
  });

  it('an unchanged username says so and sends nothing', async () => {
    const { api } = await openProfile();
    const update = vi.spyOn(api.account, 'updateUsername');
    await userEvent.type(usernameBox(), ' ');
    await userEvent.click(saveButton());
    expect(screen.getByRole('status')).toHaveTextContent("That's already your username.");
    expect(usernameBox()).toHaveValue('demo');
    expect(update).not.toHaveBeenCalled();
  });

  it('disables the button while saving, so it is sent once', async () => {
    const { api } = await openProfile();
    let finish!: () => void;
    const update = vi
      .spyOn(api.account, 'updateUsername')
      .mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await userEvent.type(usernameBox(), '2{Enter}');
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent('Saving…');
    await userEvent.type(usernameBox(), '{Enter}');
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByText('demo2', { selector: '.profile__name' })).toBeInTheDocument();
  });

  it('if saving fails, keeps the typed name and says what to do', async () => {
    const { api } = await openProfile();
    vi.spyOn(api.account, 'updateUsername').mockRejectedValueOnce(new Error('offline'));
    await userEvent.type(usernameBox(), '2{Enter}');
    expect(await screen.findByText(/couldn't save your username/i)).toBeInTheDocument();
    expect(usernameBox()).toHaveValue('demo2');
    expect(screen.getByText('demo', { selector: '.profile__name' })).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });
});

describe('ProfileView picture popup', () => {
  it('opens an accessible upload popup with an image file input', async () => {
    await openProfile();
    const dialog = await openPicturePopup();
    const input = within(dialog).getByLabelText('Choose an image');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription(/up to 5 MB/);
  });

  it('uploads an image, closes the popup, shows the new picture and returns focus', async () => {
    const { api } = await openProfile();
    const upload = vi.spyOn(api.account, 'updateProfilePicture');
    const dialog = await openPicturePopup();
    const file = png();
    await userEvent.upload(within(dialog).getByLabelText('Choose an image'), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('img', { name: 'Profile picture of you' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,/),
    );
    expect(upload).toHaveBeenCalledWith('u-demo', file);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Profile picture updated.');
    expect(screen.getByRole('button', { name: 'Change profile picture' })).toHaveFocus();
  });

  it.each([
    ['no file chosen', null, 'Choose an image file.'],
    ['a non-image file', new File(['hi'], 'notes.txt', { type: 'text/plain' }), /not an image/],
    ['an empty image', png(0), /empty/],
  ])('%s says what to fix and uploads nothing', async (_, file, message) => {
    const { api } = await openProfile();
    const upload = vi.spyOn(api.account, 'updateProfilePicture');
    const dialog = await openPicturePopup();
    const input = within(dialog).getByLabelText('Choose an image');
    if (file !== null) await userEvent.setup({ applyAccept: false }).upload(input, file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(message);
    expect(upload).not.toHaveBeenCalled();
    await userEvent.upload(input, png()); // choosing again clears the error
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('clearing a chosen file counts as no file chosen', async () => {
    const { api } = await openProfile();
    const upload = vi.spyOn(api.account, 'updateProfilePicture');
    const dialog = await openPicturePopup();
    const input = within(dialog).getByLabelText('Choose an image');
    await userEvent.upload(input, png());
    await userEvent.upload(input, []);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(input).toHaveAccessibleDescription('Choose an image file.');
    expect(upload).not.toHaveBeenCalled();
  });

  it('disables the popup buttons while uploading; Escape and Cancel do nothing until it finishes', async () => {
    const { api } = await openProfile();
    let finish!: () => void;
    vi.spyOn(api.account, 'updateProfilePicture').mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const dialog = await openPicturePopup();
    await userEvent.upload(within(dialog).getByLabelText('Choose an image'), png());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(within(dialog).getByRole('button', { name: 'Uploading…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('if the upload fails, keeps the popup open and says what to do', async () => {
    const { api } = await openProfile();
    vi.spyOn(api.account, 'updateProfilePicture').mockRejectedValueOnce(new Error('offline'));
    const dialog = await openPicturePopup();
    await userEvent.upload(within(dialog).getByLabelText('Choose an image'), png());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await within(dialog).findByText(/couldn't upload your picture/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it.each([
    ['Cancel', async () => userEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', async () => userEvent.keyboard('{Escape}')],
  ])('%s closes the popup without uploading', async (_, close) => {
    const { api } = await openProfile();
    const upload = vi.spyOn(api.account, 'updateProfilePicture');
    await openPicturePopup();
    await close();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change profile picture' })).toHaveFocus();
  });
});

describe('ProfileView log out', () => {
  it('logs out and returns to the login page', async () => {
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('do-re.userId')).toBeNull();
  });
});

describe('profileLogic', () => {
  it.each([
    ['', 'Enter a username.'],
    ['   ', 'Enter a username.'],
    ['a', undefined],
  ])('validateUsername(%j)', (name, expected) => {
    expect(validateUsername(name)).toBe(expected);
  });

  it('validatePicture: size boundary at MAX_PICTURE_BYTES', () => {
    const sized = (size: number) => {
      const file = png(1);
      Object.defineProperty(file, 'size', { value: size });
      return file;
    };
    expect(validatePicture(sized(MAX_PICTURE_BYTES))).toBeUndefined();
    expect(validatePicture(sized(MAX_PICTURE_BYTES + 1))).toMatch(/too big/);
    expect(validatePicture(sized(1))).toBeUndefined();
  });
});
