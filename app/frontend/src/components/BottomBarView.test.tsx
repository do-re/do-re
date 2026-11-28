import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderChatApp, seededApi } from '../test/renderChat';

function bar() {
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('BottomBarView', () => {
  it('R_UI_05 has Home, Messages and Profile, in that order', () => {
    renderChatApp(seededApi(), '/profile');
    expect(bar().getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Messages', 'Profile']);
  });

  it.each([
    ['/home', 'Home'],
    ['/chats', 'Messages'],
    ['/chats/c-seed-tempo', 'Messages'],
    ['/profile', 'Profile'],
  ])('R_UI_04 on %s it highlights only %s', async (path, current) => {
    renderChatApp(seededApi(), path);
    const links = bar().getAllByRole('link');
    expect(links.filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent)).toEqual([current]);
    expect(links.filter((l) => l.classList.contains('active')).map((l) => l.textContent)).toEqual([current]);
    await screen.findByRole('navigation', { name: 'Main' });
  });

  it('highlights nothing on a match page', () => {
    renderChatApp(seededApi(), '/match/m-chat-tempo');
    expect(bar().getAllByRole('link').filter((l) => l.classList.contains('active'))).toEqual([]);
  });

  it('R_UI_05 navigates to the chat list and back to profile', async () => {
    renderChatApp(seededApi(), '/profile');
    await userEvent.click(bar().getByRole('link', { name: 'Messages' }));
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
    await userEvent.click(bar().getByRole('link', { name: 'Profile' }));
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });
});

describe('ViewController chat routes', () => {
  it.each(['/chats', '/chats/c-seed-tempo'])('R_SEC_03 %s redirects to /login when logged out', (path) => {
    renderChatApp(seededApi(), path, null);
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it.each(['/login', '/signup'])('R_ACC_06 a logged-in user on %s is sent home', (path) => {
    renderChatApp(seededApi(), path);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});

describe('BottomBarView admin tab (OPEN-18)', () => {
  it('adds an Admin tab after Profile once an admin logs in, and it opens the admin page', async () => {
    renderChatApp(seededApi(), '/login', null);
    await userEvent.type(screen.getByLabelText('Email'), 'demo@do-re.test'); // the demo backend's admin
    await userEvent.type(screen.getByLabelText('Password'), 'demo-pass-1');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    await screen.findByRole('navigation', { name: 'Main' });
    const admin = await bar().findByRole('link', { name: 'Admin' });
    expect(bar().getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Messages', 'Profile', 'Admin']);
    await userEvent.click(admin);
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    const current = bar().getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual(['Admin']);
  });

  it('keeps the Admin tab after a refresh, and drops it at logout', async () => {
    sessionStorage.setItem('do-re.admin', 'yes'); // what an admin's login stored
    renderChatApp(seededApi(), '/profile');
    expect(bar().getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Messages', 'Profile', 'Admin']);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('do-re.admin')).toBeNull();
  });

  it('security_showsNoAdminTabToOtherUsers', async () => {
    renderChatApp(seededApi(), '/login', null);
    await userEvent.type(screen.getByLabelText('Email'), 'melody@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-pass-1');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    await screen.findByRole('heading', { name: 'Home' });
    expect(bar().getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Messages', 'Profile']);
    expect(sessionStorage.getItem('do-re.admin')).toBeNull();
  });
});
