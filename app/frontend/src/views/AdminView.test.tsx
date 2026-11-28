/**
 * The admin page, the Report dialog on the match screen, and what they change on Login and
 * Profile (OPEN-18; an extra with no requirement ID).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiErrors';
import { MockBackend, MOCK_ROOT_ADMIN_EMAIL } from '../api/mock';
import { renderApp } from '../test/renderApp';

const DEMO = 'u-demo'; // the demo's root admin
const card = (email: string) => screen.findByRole('listitem', { name: email });
const tab = (name: RegExp) => screen.getByRole('tab', { name });

async function openAdmin(userId = DEMO) {
  const rendered = renderApp({ path: '/admin', userId });
  return rendered;
}

describe('AdminView access', () => {
  it('shows the page to an admin, with every user', async () => {
    await openAdmin();
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    const demo = await card(MOCK_ROOT_ADMIN_EMAIL);
    expect(within(demo).getByText('Root admin')).toBeInTheDocument();
    expect(within(demo).getByText('This is you.')).toBeInTheDocument();
    expect(within(demo).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument(); // not on yourself
    expect(within(await card('unverified@do-re.test')).getByText('Not verified')).toBeInTheDocument();
    expect(tab(/^Users \(\d+\)$/)).toHaveAttribute('aria-selected', 'true');
  });

  it('security_sendsSomeoneWhoIsNotAnAdminHome', async () => {
    await openAdmin('u-melody');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('says so and offers a retry when the page cannot be loaded', async () => {
    const { api } = await openAdmin();
    await screen.findByRole('heading', { name: 'Admin' });
    await card(MOCK_ROOT_ADMIN_EMAIL);
    // fail the next load, triggered by an action's reload
    const list = vi.spyOn(api.admin, 'listUsers').mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', 0));
    await userEvent.click(within(await card('unverified@do-re.test')).getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText(/Couldn't load the admin page/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await card(MOCK_ROOT_ADMIN_EMAIL)).toBeInTheDocument();
    expect(list).toHaveBeenCalled();
  });
});

describe('AdminView users', () => {
  it('verifies an unverified account', async () => {
    const { api } = await openAdmin();
    const row = await card('unverified@do-re.test');
    await userEvent.click(within(row).getByRole('button', { name: 'Verify email' }));
    await waitFor(async () => expect(within(await card('unverified@do-re.test')).queryByText('Not verified')).not.toBeInTheDocument());
    expect((await api.account.login('unverified@do-re.test', 'demo-pass-1')).result).toBe('SUCCESS');
  });

  it('suspends a user with a reason, and unsuspends them', async () => {
    const { api } = await openAdmin();
    await userEvent.click(within(await card('melody@do-re.test')).getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suspend melody@do-re.test' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason'); // a reason is required
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'fake account');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const row = await card('melody@do-re.test');
    expect(within(row).getByText('Suspended')).toBeInTheDocument();
    expect(within(row).getByText(/fake account/)).toBeInTheDocument();
    expect((await api.account.login('melody@do-re.test', 'demo-pass-1')).result).toBe('SUSPENDED');

    await userEvent.click(within(row).getByRole('button', { name: 'Unsuspend' }));
    await waitFor(async () => expect(within(await card('melody@do-re.test')).queryByText('Suspended')).not.toBeInTheDocument());
    expect((await api.account.login('melody@do-re.test', 'demo-pass-1')).result).toBe('SUCCESS');
  });

  it('closes the suspend dialog on Cancel without suspending', async () => {
    await openAdmin();
    await userEvent.click(within(await card('melody@do-re.test')).getByRole('button', { name: 'Suspend' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(await card('melody@do-re.test')).queryByText('Suspended')).not.toBeInTheDocument();
  });

  it('gives and removes admin rights', async () => {
    const { api } = await openAdmin();
    await userEvent.click(within(await card('melody@do-re.test')).getByRole('button', { name: 'Make admin' }));
    await waitFor(async () => expect(within(await card('melody@do-re.test')).getByText('Admin')).toBeInTheDocument());
    expect((await api.account.getProfile('u-melody')).isAdmin).toBe(true);
    await userEvent.click(within(await card('melody@do-re.test')).getByRole('button', { name: 'Remove admin' }));
    await waitFor(async () => expect(within(await card('melody@do-re.test')).queryByText('Admin')).not.toBeInTheDocument());
  });

  it('filters users by email or username', async () => {
    await openAdmin();
    await card('melody@do-re.test');
    await userEvent.type(screen.getByLabelText('Search users'), 'MELO');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.clear(screen.getByLabelText('Search users'));
    await userEvent.type(screen.getByLabelText('Search users'), 'zzz');
    expect(screen.getByText('No users match that search.')).toBeInTheDocument();
  });

  it("shows the server's message when it refuses an action", async () => {
    const { api } = await openAdmin();
    vi.spyOn(api.admin, 'verify').mockRejectedValueOnce(new ApiError('BAD_REQUEST', 'That account does not exist.', 404));
    await userEvent.click(within(await card('unverified@do-re.test')).getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That account does not exist.');
    vi.spyOn(api.admin, 'verify').mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(within(await card('unverified@do-re.test')).getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'));
  });
});

describe('AdminView reports and activity', () => {
  async function withReports() {
    const rendered = await openAdmin();
    const backend = rendered.api.backend;
    backend.fileReport('u-melody', 'u-tempo', 'FAKE_ACCOUNT', 'stock photo');
    backend.fileReport('u-harmony', 'u-tempo', 'REPORTED_IN_CHAT', '', 'CHAT');
    await screen.findByRole('heading', { name: 'Admin' });
    await card(MOCK_ROOT_ADMIN_EMAIL);
    return rendered;
  }

  it('says when there is nothing to show', async () => {
    await openAdmin();
    await card(MOCK_ROOT_ADMIN_EMAIL);
    await userEvent.click(tab(/^Reports/));
    expect(screen.getByText('No one has been reported.')).toBeInTheDocument();
    await userEvent.click(tab(/^Activity/));
    expect(screen.getByText('No admin has done anything yet.')).toBeInTheDocument();
  });

  it('lists reports with who, why and where, and resolves one', async () => {
    const { api } = await withReports();
    // reload so the page has the reports filed after it first loaded
    await userEvent.click(within(await card('unverified@do-re.test')).getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(tab(/^Reports \(2 open\)$/)).toBeInTheDocument());
    expect(within(await card('tempo@do-re.test')).getByText('2 open reports')).toBeInTheDocument();

    await userEvent.click(tab(/^Reports/));
    const reports = screen.getAllByRole('listitem', { name: 'Report about tempo@do-re.test' });
    expect(reports).toHaveLength(2);
    const fromMatch = reports.find((item) => within(item).queryByText(/Fake account, from the match screen/))!;
    expect(within(fromMatch).getByText('“stock photo”')).toBeInTheDocument();
    expect(within(fromMatch).getByText('Reported by melody@do-re.test')).toBeInTheDocument();
    expect(reports.some((item) => within(item).queryByText(/Reported from a chat, from the chat/))).toBe(true);

    await userEvent.click(within(fromMatch).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(tab(/^Reports \(1 open\)$/)).toBeInTheDocument());
    expect(screen.getByText(/Resolved by demo@do-re.test/)).toBeInTheDocument();
    expect((await api.admin.listReports(DEMO)).filter((r) => r.resolved !== null)).toHaveLength(1);
  });

  it('suspends the reported user from a report, and logs every action', async () => {
    await withReports();
    await userEvent.click(within(await card('unverified@do-re.test')).getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(tab(/^Reports \(2 open\)$/)).toBeInTheDocument());
    await userEvent.click(tab(/^Reports/));
    await userEvent.click(screen.getAllByRole('button', { name: 'Suspend user' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Suspend tempo@do-re.test' });
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'two reports');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText('This user is suspended.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Suspend user' })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Resolve' })[0]);
    await waitFor(() => expect(tab(/^Reports \(1 open\)$/)).toBeInTheDocument());
    await userEvent.click(tab(/^Activity/));
    const lines = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(lines[0]).toContain('demo@do-re.test resolved the report about tempo@do-re.test');
    expect(lines[1]).toContain('demo@do-re.test suspended tempo@do-re.test: two reports');
    expect(lines[2]).toContain('demo@do-re.test verified unverified@do-re.test');
  });
});

describe('the demo backend follows the admin rules', () => {
  it('security_refusesNonAdminsSelfActionsAndActionsOnTheRootAdmin', async () => {
    const backend = new MockBackend();
    await expect(backend.listUsers('u-melody')).rejects.toMatchObject({ code: 'NOT_ADMIN', status: 403 });
    await expect(backend.listUsers('nobody')).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    await expect(backend.suspend(DEMO, DEMO, 'x')).rejects.toMatchObject({ status: 400 });
    await expect(backend.suspend(DEMO, 'u-melody', '   ')).rejects.toMatchObject({ status: 400 });
    await backend.setAdmin(DEMO, 'u-melody', true);
    await expect(backend.suspend('u-melody', DEMO, 'x')).rejects.toMatchObject({ status: 400 }); // the root admin
    await expect(backend.setAdmin('u-melody', DEMO, false)).rejects.toMatchObject({ status: 400 });
    await backend.suspend(DEMO, 'u-melody', 'abuse');
    await expect(backend.listUsers('u-melody')).rejects.toMatchObject({ code: 'NOT_ADMIN' }); // suspended admins lose their rights
    await expect(backend.resolveReport(DEMO, 'no.such', '')).rejects.toMatchObject({ status: 404 });
    expect((await backend.auditLog(DEMO)).map((e) => e.action)).toEqual(['SUSPEND', 'GRANT_ADMIN']);
  });

  it('keeps one report per reporter per person, and reopens a resolved one', async () => {
    const backend = new MockBackend();
    backend.fileReport('u-melody', 'u-tempo', 'SPAM', ' ads ');
    backend.fileReport('u-melody', 'u-tempo', 'OTHER');
    expect(await backend.listReports(DEMO)).toMatchObject([{ reason: 'SPAM', details: 'ads' }]);
    await backend.resolveReport(DEMO, 'u-tempo.u-melody', ' ok ');
    await backend.resolveReport(DEMO, 'u-tempo.u-melody', 'again'); // stays as first resolved
    expect((await backend.listReports(DEMO))[0].resolved).toMatchObject({ by: DEMO, note: 'ok' });
    backend.fileReport('u-melody', 'u-tempo', 'HARASSMENT');
    expect(await backend.listReports(DEMO)).toMatchObject([{ reason: 'HARASSMENT', resolved: null }]);
    expect((await backend.listUsers(DEMO)).find((u) => u.userId === 'u-tempo')!.openReports).toBe(1);
  });
});

describe('Report dialog on the match screen', () => {
  const MATCH_PATH = '/match/m-seed';
  async function openMatch() {
    const rendered = renderApp({ path: MATCH_PATH, userId: DEMO, mock: { withPendingMatch: true } });
    await screen.findByRole('heading', { name: /You matched with/ });
    return rendered;
  }

  it('R_HOME_22_reportsTheOtherPersonSkipsTheMatchAndGoesHome', async () => {
    const { api } = await openMatch();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    const dialog = await screen.findByRole('dialog', { name: /^Report / });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a reason.');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Fake account/ }));
    await userEvent.type(within(dialog).getByLabelText('Details (optional)'), 'not a real person');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(await screen.findByText(/We'll review your report/)).toBeInTheDocument();
    expect(await api.admin.listReports(DEMO)).toMatchObject([
      { reporter: { userId: DEMO }, reported: { userId: 'u-harmony' }, reason: 'FAKE_ACCOUNT', details: 'not a real person', source: 'MATCH' },
    ]);
    expect(await api.matches.getPendingMatches(DEMO)).toEqual([]); // skipped
  });

  it('can be cancelled, and says what to do when the report cannot be sent', async () => {
    const { api } = await openMatch();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    vi.spyOn(api.matches, 'reportProfile').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Spam/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't send your report");
    expect(within(dialog).getByRole('button', { name: 'Send report' })).toBeEnabled();
  });

  it('the demo refuses a report from someone who is not in the match', async () => {
    const backend = new MockBackend({ withPendingMatch: true });
    const [match] = await backend.getPendingMatches(DEMO);
    await expect(backend.reportProfile(match, 'u-melody', 'SPAM', '')).rejects.toMatchObject({ code: 'NOT_PARTICIPANT' });
  });
});

describe('Login and Profile', () => {
  it('security_aSuspendedUserIsToldSoAtLogin', async () => {
    const { api } = renderApp({ path: '/login', userId: null });
    await api.backend.suspend(DEMO, 'u-melody', 'spam');
    await userEvent.type(screen.getByLabelText('Email'), 'melody@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-pass-1');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Account suspended' });
    expect(dialog).toHaveTextContent('This account has been suspended');
  });

  it('shows the Admin page link to admins only', async () => {
    const admin = renderApp({ path: '/profile', userId: DEMO });
    await userEvent.click(await screen.findByRole('link', { name: 'Admin page' }));
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    admin.unmount();
    renderApp({ path: '/profile', userId: 'u-melody' });
    await screen.findByRole('switch', { name: 'Developer mode' });
    expect(screen.queryByRole('link', { name: 'Admin page' })).not.toBeInTheDocument();
  });
});

describe('security audit 2026-11-27: login and logout', () => {
  it('security_tellsTheUserWhenTheEmailIsLockedAfterTooManyAttempts', async () => {
    const { api } = renderApp({ path: '/login', userId: null });
    vi.spyOn(api.account, 'login').mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'Too many failed attempts.', 429));
    await userEvent.type(screen.getByLabelText('Email'), 'demo@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'guess');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Too many attempts' });
    expect(dialog).toHaveTextContent('Wait 15 minutes, then try again.');
    expect(screen.getByLabelText('Password')).toHaveValue(''); // the password box is cleared
  });

  it('security_loggingOutEndsTheSessionOnTheServerAndStillWorksIfThatFails', async () => {
    const first = renderApp({ path: '/profile', userId: DEMO });
    const ended = vi.spyOn(first.api.account, 'logout');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(ended).toHaveBeenCalledOnce();
    first.unmount();

    const second = renderApp({ path: '/profile', userId: DEMO });
    vi.spyOn(second.api.account, 'logout').mockRejectedValue(new Error('offline'));
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

