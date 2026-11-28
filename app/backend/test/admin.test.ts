/**
 * Admin panel and profile reports (OPEN-18; an extra with no requirement ID, so tests carry
 * "spec:" comments or the related requirement where there is one).
 */
import { describe, expect, it } from 'vitest';
import { AdminController } from '../src/admin/AdminController';
import { ReportModel } from '../src/admin/ReportModel';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { browser, makeWorld, statusOf, type World } from './helpers';

const taste = new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.5));
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'no error', (error) => error.code as string);

/** A world with a root admin and three ordinary users; amy and bob have a proposed match. */
async function setup() {
  const world = makeWorld();
  const root = await world.join('root@example.com');
  world.clock.advance(1000);
  const amy = await world.join('amy@example.com');
  world.clock.advance(1000);
  const bob = await world.join('bob@example.com');
  world.clock.advance(1000);
  const eve = await world.join('eve@example.com');
  await world.services.matchModel.updateUser(amy.userId, taste, world.clock.now);
  await world.services.matchModel.updateUser(bob.userId, taste, world.clock.now);
  const match = (await world.services.matchModel.findMatch(amy.userId, world.clock.now))!;
  return { world, admin: world.services.admin, root, amy, bob, eve, match };
}

describe('AccountModel for admins', () => {
  // spec: listUsers returns every account, oldest first; a record never carries the hash
  it('lists accounts oldest first without password material', async () => {
    const { world, root, amy, bob, eve } = await setup();
    const users = await world.services.accountModel.listUsers();
    expect(users.map((u) => u.userId)).toEqual([root.userId, amy.userId, bob.userId, eve.userId]);
    expect(users[1]).toEqual({
      userId: amy.userId,
      email: 'amy@example.com',
      username: '',
      active: true,
      admin: false,
      suspended: null,
      createdAt: users[1]!.createdAt,
    });
    expect(users[1]!.createdAt).toBeLessThan(users[2]!.createdAt);
    expect(JSON.stringify(users)).not.toMatch(/salt|hash/);
    expect(await statusOf(world.services.accountModel.getAccount('nobody'))).toBe(404);
  });

  // spec: suspend keeps the first suspension; unsuspend clears it; setAdmin sets the flag
  it('suspends, unsuspends and grants admin rights', async () => {
    const { world, amy } = await setup();
    const model = world.services.accountModel;
    await model.suspend(amy.userId, { at: 1, by: 'x', reason: 'first' });
    await model.suspend(amy.userId, { at: 2, by: 'y', reason: 'second' });
    expect((await model.getAccount(amy.userId)).suspended).toEqual({ at: 1, by: 'x', reason: 'first' });
    await model.unsuspend(amy.userId);
    await model.unsuspend(amy.userId);
    expect((await model.getAccount(amy.userId)).suspended).toBeNull();
    await model.setAdmin(amy.userId, true);
    expect((await model.getAccount(amy.userId)).admin).toBe(true);
    await model.setAdmin(amy.userId, false);
    expect((await model.getAccount(amy.userId)).admin).toBe(false);
    expect(await model.isValidLogin('amy@example.com', 'correct horse')).toBe(true); // nothing else changed
    for (const call of [model.suspend('nobody', { at: 1, by: 'x', reason: 'r' }), model.unsuspend('nobody'), model.setAdmin('nobody', true)]) {
      expect(await statusOf(call)).toBe(404);
    }
  });
});

describe('sessions of a user', () => {
  // spec: endAllSessions ends every session of that user and no one else's
  it('security_endAllSessionsLogsAUserOutEverywhere', async () => {
    const { world, amy, bob } = await setup();
    const sessions = world.services.sessions;
    const second = await sessions.createSession(amy.userId);
    await sessions.endAllSessions(amy.userId);
    expect(await sessions.authenticate(amy.token)).toBeUndefined();
    expect(await sessions.authenticate(second)).toBeUndefined();
    expect(await sessions.authenticate(bob.token)).toBe(bob.userId);
    await sessions.endAllSessions(amy.userId); // nothing left: harmless
    // a session ended one at a time leaves no pointer behind
    const third = await sessions.createSession(amy.userId);
    await sessions.endSession(third);
    expect(await world.table.query(`USER#${amy.userId}`, { prefix: 'SESSION#' })).toEqual([]);
  });
});

describe('ReportModel', () => {
  const report = { reporterId: 'amy', reportedId: 'bob', source: 'MATCH', reason: 'SPAM', contextId: 'amy_bob' } as const;

  // spec: one report per (reporter, reported); a repeat while open changes nothing
  it('stores one report per reporter per reported user', async () => {
    const { services, clock } = makeWorld();
    const model = services.reportModel;
    expect(await model.file({ ...report, details: '  sends ads  ' })).toBe(true);
    clock.advance(1000);
    expect(await model.file({ ...report, reason: 'OTHER' })).toBe(false);
    expect(await model.list()).toEqual([
      { ...report, reportId: 'bob.amy', details: 'sends ads', createdAt: clock.now - 1000, resolved: null },
    ]);
    expect(await model.file({ ...report, reporterId: 'cat' })).toBe(true); // another reporter is another report
    expect(await model.file({ ...report, reportedId: 'cat' })).toBe(true);
    expect(await model.list()).toHaveLength(3);
  });

  // spec: Requires different users and details of at most MAX_DETAILS (boundary)
  it('rejects self-reports and over-long details', async () => {
    const model = makeWorld().services.reportModel;
    expect(await statusOf(model.file({ ...report, reportedId: 'amy' }))).toBe(400);
    expect(await statusOf(model.file({ ...report, details: 'x'.repeat(ReportModel.MAX_DETAILS + 1) }))).toBe(400);
    expect(await model.file({ ...report, details: 'x'.repeat(ReportModel.MAX_DETAILS) })).toBe(true);
  });

  // spec: resolve records who and when; resolved stays resolved; filing again reopens
  it('resolves reports, lists open ones first, and reopens on a new report', async () => {
    const { services, clock } = makeWorld();
    const model = services.reportModel;
    await model.file(report);
    clock.advance(1000);
    await model.file({ ...report, reporterId: 'cat' });
    clock.advance(1000);
    await model.file({ ...report, reporterId: 'dan' });
    expect((await model.list()).map((r) => r.reporterId)).toEqual(['dan', 'cat', 'amy']); // newest first
    await model.resolve('bob.dan', 'admin-1', '  warned  ');
    await model.resolve('bob.dan', 'admin-2', 'again'); // already resolved: unchanged
    const list = await model.list();
    expect(list.map((r) => r.reporterId)).toEqual(['cat', 'amy', 'dan']); // open first
    expect(list[2]!.resolved).toEqual({ by: 'admin-1', at: clock.now, note: 'warned' });
    clock.advance(1000);
    expect(await model.file({ ...report, reporterId: 'dan', reason: 'HARASSMENT' })).toBe(true);
    expect((await model.list())[0]).toMatchObject({ reporterId: 'dan', reason: 'HARASSMENT', resolved: null, createdAt: clock.now });
    expect(await statusOf(model.resolve('no.such', 'admin-1'))).toBe(404);
    expect(await statusOf(model.resolve('bob.cat', 'admin-1', 'x'.repeat(ReportModel.MAX_NOTE + 1)))).toBe(400);
    await model.resolve('bob.cat', 'admin-1'); // the note is optional
    expect((await model.list()).find((r) => r.reporterId === 'cat')!.resolved!.note).toBe('');
  });

  it('concurrency_theSameReportSentManyTimesIsStoredOnce', async () => {
    const model = makeWorld().services.reportModel;
    const results = await Promise.all(Array.from({ length: 12 }, () => model.file(report)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await model.list()).toHaveLength(1);
  });
});

describe('reporting a profile', () => {
  it('R_HOME_22_reportingFromTheMatchScreenFilesAReportAndDeclinesTheMatch', async () => {
    const { world, amy, bob, match } = await setup();
    await world.services.reports.reportProfile(amy.userId, bob.userId, 'FAKE_ACCOUNT', 'stock photo');
    expect(await world.services.reportModel.list()).toMatchObject([
      { reporterId: amy.userId, reportedId: bob.userId, source: 'MATCH', reason: 'FAKE_ACCOUNT', details: 'stock photo', contextId: match.matchId },
    ]);
    expect(await world.services.matches.getPendingMatches(amy.userId)).toEqual([]);
    expect(await world.services.matches.getPendingMatches(bob.userId)).toEqual([]); // declined for both
    expect(await world.services.matchModel.findMatch(amy.userId, world.clock.now)).toBeUndefined(); // never proposed again
    await world.services.reports.reportProfile(amy.userId, bob.userId, 'SPAM'); // again: still one report
    expect(await world.services.reportModel.list()).toHaveLength(1);
    // the reported user can report back
    await world.services.reports.reportProfile(bob.userId, amy.userId, 'OTHER');
    expect(await world.services.reportModel.list()).toHaveLength(2);
  });

  // spec: Requires a match between the two, so arbitrary users cannot be reported
  it('security_onlySomeoneYouWereMatchedWithCanBeReported', async () => {
    const { world, amy, eve } = await setup();
    expect(await statusOf(world.services.reports.reportProfile(eve.userId, amy.userId, 'SPAM'))).toBe(403);
    expect(await statusOf(world.services.reports.reportProfile(amy.userId, 'made-up-id', 'SPAM'))).toBe(403);
    expect(await statusOf(world.services.reports.reportProfile(amy.userId, amy.userId, 'SPAM'))).toBe(403);
    expect(await world.services.reportModel.list()).toEqual([]);
  });

  it('R_CHAT_16_theChatReportButtonAlsoFilesAReportAboutTheOtherPerson', async () => {
    const { world, amy, bob } = await setup();
    const chatId = await world.services.chats.openChat(amy.userId, bob.userId);
    await world.services.chats.reportChat(bob.userId, chatId);
    await world.services.chats.reportChat(bob.userId, chatId); // pressing twice: one report
    expect(await world.services.reportModel.list()).toMatchObject([
      { reporterId: bob.userId, reportedId: amy.userId, source: 'CHAT', reason: 'REPORTED_IN_CHAT', contextId: chatId, details: '' },
    ]);
    expect(await world.services.chatModel.isFlagged(chatId)).toBe(true); // existing behaviour kept
  });
});

describe('AdminController: who is an admin', () => {
  it('security_rootAdminsAndGrantedAdminsAreAdminsUnlessSuspended', async () => {
    const { world, admin, root, amy, bob } = await setup();
    expect(await admin.isAdmin(root.userId)).toBe(true);
    expect(await admin.isAdmin(amy.userId)).toBe(false);
    expect(await admin.isAdmin('nobody')).toBe(false);
    await admin.setAdmin(root.userId, amy.userId, true);
    expect(await admin.isAdmin(amy.userId)).toBe(true);
    await admin.setAdmin(amy.userId, bob.userId, true); // a granted admin can grant too
    await admin.suspend(bob.userId, amy.userId, 'abuse of admin rights');
    expect(await admin.isAdmin(amy.userId)).toBe(false); // suspended: no rights
    await admin.setAdmin(root.userId, bob.userId, false);
    expect(await admin.isAdmin(bob.userId)).toBe(false);
    // the root list is matched on the normalized email
    const other = makeWorld({ adminEmails: ['  Boss@Example.com ', ''] });
    const boss = await other.join('boss@example.com');
    expect(await other.services.admin.isAdmin(boss.userId)).toBe(true);
    expect(await makeWorld({ adminEmails: [] }).services.admin.isAdmin('x')).toBe(false);
  });

  // spec: every method throws 403 NOT_ADMIN for a caller who is not an admin
  it('security_everyAdminActionIsRefusedToNonAdmins', async () => {
    const { world, admin, amy, bob } = await setup();
    await world.services.reportModel.file({ reporterId: bob.userId, reportedId: amy.userId, source: 'MATCH', reason: 'SPAM', contextId: 'x' });
    for (const caller of [amy.userId, 'nobody']) {
      for (const call of [
        admin.listUsers(caller),
        admin.suspend(caller, bob.userId, 'reason'),
        admin.unsuspend(caller, bob.userId),
        admin.verify(caller, bob.userId),
        admin.setAdmin(caller, bob.userId, true),
        admin.listReports(caller),
        admin.resolveReport(caller, `${amy.userId}.${bob.userId}`),
        admin.auditLog(caller),
      ]) {
        expect(await codeOf(call)).toBe('NOT_ADMIN');
      }
    }
    expect((await world.services.accountModel.getAccount(bob.userId)).suspended).toBeNull(); // nothing happened
  });
});

describe('AdminController: managing users', () => {
  it('lists users with role, last active time and open report count', async () => {
    const { world, admin, root, amy, bob, eve } = await setup();
    await world.services.reportModel.file({ reporterId: bob.userId, reportedId: amy.userId, source: 'MATCH', reason: 'SPAM', contextId: 'x' });
    await world.services.reportModel.file({ reporterId: eve.userId, reportedId: amy.userId, source: 'MATCH', reason: 'SPAM', contextId: 'x' });
    await world.services.reportModel.file({ reporterId: amy.userId, reportedId: bob.userId, source: 'MATCH', reason: 'SPAM', contextId: 'x' });
    await world.services.reportModel.resolve(`${bob.userId}.${amy.userId}`, root.userId);
    const users = await admin.listUsers(root.userId);
    const by = (id: string) => users.find((u) => u.userId === id)!;
    expect(users).toHaveLength(4);
    expect(by(root.userId)).toMatchObject({ email: 'root@example.com', rootAdmin: true, admin: false, lastActiveAt: null, openReports: 0 });
    expect(by(amy.userId)).toMatchObject({ rootAdmin: false, lastActiveAt: world.clock.now, openReports: 2, active: true });
    expect(by(bob.userId).openReports).toBe(0); // the report about bob is resolved
  });

  it('security_suspendingLogsTheUserOutBlocksLoginAndRemovesThemFromMatching', async () => {
    const { world, admin, root, amy, bob, eve } = await setup();
    await world.services.matchModel.updateUser(eve.userId, taste, world.clock.now);
    await world.services.subscriptions.save(bob.userId, browser(1));
    await admin.suspend(root.userId, bob.userId, '  fake account  ');

    expect((await world.services.accountModel.getAccount(bob.userId)).suspended).toEqual({ at: world.clock.now, by: root.userId, reason: 'fake account' });
    expect((await world.call('GET', '/api/users/me', { token: bob.token })).status).toBe(401); // logged out at once
    expect(await world.services.accounts.login('bob@example.com', 'correct horse')).toBe('SUSPENDED');
    expect(await world.services.accounts.login('bob@example.com', 'wrong')).toBe('WRONG_PASSWORD'); // only with the password
    expect(await world.services.subscriptions.list(bob.userId)).toEqual([]);
    // R-HOME-19: a suspended user is never offered as a match
    const offered = await world.services.matchModel.findMatch(eve.userId, world.clock.now);
    expect([offered!.userA, offered!.userB]).toContain(amy.userId);
    expect(await world.services.matchModel.findMatch(eve.userId, world.clock.now)).toBeUndefined();
    expect((await admin.listUsers(root.userId)).find((u) => u.userId === bob.userId)!.lastActiveAt).toBeNull();

    await admin.unsuspend(root.userId, bob.userId);
    expect(await world.services.accounts.login('bob@example.com', 'correct horse')).toBe('SUCCESS');
  });

  // spec: the safety rules, and the bounds on the reason (boundaries 1 and MAX_REASON)
  it('security_noOneCanSuspendOrDemoteThemselvesOrARootAdmin', async () => {
    const { world, admin, root, amy, bob } = await setup();
    await admin.setAdmin(root.userId, amy.userId, true);
    expect(await statusOf(admin.suspend(amy.userId, amy.userId, 'r'))).toBe(400);
    expect(await statusOf(admin.setAdmin(amy.userId, amy.userId, false))).toBe(400);
    expect(await statusOf(admin.suspend(amy.userId, root.userId, 'r'))).toBe(400);
    expect(await statusOf(admin.setAdmin(amy.userId, root.userId, false))).toBe(400);
    expect(await statusOf(admin.setAdmin(amy.userId, root.userId, true))).toBe(400);
    expect(await admin.isAdmin(root.userId)).toBe(true);
    expect(await statusOf(admin.suspend(root.userId, bob.userId, '   '))).toBe(400);
    expect(await statusOf(admin.suspend(root.userId, bob.userId, 'x'.repeat(AdminController.MAX_REASON + 1)))).toBe(400);
    expect(await statusOf(admin.suspend(root.userId, 'nobody', 'r'))).toBe(404);
    expect(await statusOf(admin.setAdmin(root.userId, 'nobody', true))).toBe(404);
    expect(await statusOf(admin.verify(root.userId, 'nobody'))).toBe(404);
    expect(await statusOf(admin.unsuspend(root.userId, 'nobody'))).toBe(404);
    expect((await world.services.accountModel.getAccount(bob.userId)).suspended).toBeNull();
    await admin.suspend(root.userId, bob.userId, 'x'.repeat(AdminController.MAX_REASON));
    await admin.suspend(root.userId, bob.userId, 'r'); // one-character reason; already suspended: first stands
    expect((await world.services.accountModel.getAccount(bob.userId)).suspended!.reason).toHaveLength(AdminController.MAX_REASON);
  });

  it('R_SEC_02_anAdminCanVerifyAnAccountWithoutTheEmailedLink', async () => {
    const { world, admin, root } = await setup();
    await world.services.accounts.createAccount('new@example.com', 'pw', 'pw');
    const userId = await world.services.accounts.getUserId('new@example.com');
    expect(await world.services.accounts.login('new@example.com', 'pw')).toBe('NOT_VERIFIED');
    await admin.verify(root.userId, userId);
    expect(await world.services.accounts.login('new@example.com', 'pw')).toBe('SUCCESS');
  });
});

describe('AdminController: reports and the audit log', () => {
  it('shows reports with both people, and resolves them', async () => {
    const { world, admin, root, amy, bob } = await setup();
    await world.services.accounts.updateUsername(bob.userId, 'Bob');
    await world.services.reports.reportProfile(amy.userId, bob.userId, 'HARASSMENT', 'rude');
    await world.services.reportModel.file({ reporterId: 'ghost', reportedId: bob.userId, source: 'CHAT', reason: 'REPORTED_IN_CHAT', contextId: 'c' });
    const reports = await admin.listReports(root.userId);
    expect(reports).toHaveLength(2);
    const fromAmy = reports.find((r) => r.reporterId === amy.userId)!;
    expect(fromAmy).toMatchObject({
      reason: 'HARASSMENT',
      details: 'rude',
      source: 'MATCH',
      reporter: { userId: amy.userId, username: '', email: 'amy@example.com' },
      reported: { userId: bob.userId, username: 'Bob', email: 'bob@example.com' },
    });
    // a reporter whose account no longer exists is still listed, without details
    expect(reports.find((r) => r.reporterId === 'ghost')!.reporter).toEqual({ userId: 'ghost', username: '', email: '' });

    await admin.resolveReport(root.userId, fromAmy.reportId, 'warned Bob');
    expect((await admin.listReports(root.userId)).find((r) => r.reportId === fromAmy.reportId)!.resolved).toMatchObject({ by: root.userId, note: 'warned Bob' });
    expect(await statusOf(admin.resolveReport(root.userId, 'no.such'))).toBe(404);
  });

  // spec: every action is logged; the log is newest first and shows the latest AUDIT_SHOWN
  it('security_everyAdminActionIsInTheAuditLogNewestFirst', async () => {
    const { world, admin, root, amy, bob } = await setup();
    await world.services.reports.reportProfile(amy.userId, bob.userId, 'SPAM');
    const reportId = `${bob.userId}.${amy.userId}`;
    const steps: [string, () => Promise<void>][] = [
      ['GRANT_ADMIN', () => admin.setAdmin(root.userId, amy.userId, true)],
      ['SUSPEND', () => admin.suspend(amy.userId, bob.userId, 'spam')],
      ['RESOLVE_REPORT', () => admin.resolveReport(amy.userId, reportId, 'suspended')],
      ['UNSUSPEND', () => admin.unsuspend(root.userId, bob.userId)],
      ['VERIFY', () => admin.verify(root.userId, bob.userId)],
      ['REVOKE_ADMIN', () => admin.setAdmin(root.userId, amy.userId, false)],
    ];
    for (const [, step] of steps) {
      await step();
      world.clock.advance(1000);
    }
    const log = await admin.auditLog(root.userId);
    expect(log.map((e) => e.action)).toEqual(steps.map(([action]) => action).reverse());
    expect(log.at(-1)).toEqual({ at: log.at(-1)!.at, adminId: root.userId, action: 'GRANT_ADMIN', targetId: amy.userId, detail: '' });
    expect(log.find((e) => e.action === 'SUSPEND')).toMatchObject({ adminId: amy.userId, targetId: bob.userId, detail: 'spam' });
    expect(log.find((e) => e.action === 'RESOLVE_REPORT')).toMatchObject({ targetId: reportId, detail: 'suspended' });
    // a refused action is not logged
    await admin.suspend(root.userId, root.userId, 'x').catch(() => undefined);
    expect(await admin.auditLog(root.userId)).toHaveLength(steps.length);

    for (let i = 0; i < AdminController.AUDIT_SHOWN; i++) {
      await admin.verify(root.userId, bob.userId);
      world.clock.advance(10);
    }
    const capped = await admin.auditLog(root.userId);
    expect(capped).toHaveLength(AdminController.AUDIT_SHOWN);
    expect(capped.every((e) => e.action === 'VERIFY')).toBe(true); // the oldest fell off
  });

  it('concurrency_suspendingTheSameUserManyTimesLeavesOneSuspension', async () => {
    const { world, admin, root, bob } = await setup();
    await Promise.all(Array.from({ length: 8 }, (_, i) => admin.suspend(root.userId, bob.userId, `reason ${i}`)));
    const account = await world.services.accountModel.getAccount(bob.userId);
    expect(account.suspended).toMatchObject({ by: root.userId });
    expect(await world.services.sessions.authenticate(bob.token)).toBeUndefined();
    expect(await world.services.accounts.login('bob@example.com', 'correct horse')).toBe('SUSPENDED');
  });
});

describe('HTTP API: reports and admin routes', () => {
  const call = (world: World, method: string, path: string, token: string, body?: unknown) => world.call(method, `/api${path}`, { token, body });

  it('security_adminRoutesAnswer403ToEveryoneElseAnd401WithoutASession', async () => {
    const { world, amy, bob } = await setup();
    const routes: [string, string, unknown?][] = [
      ['GET', '/admin/users'],
      ['POST', `/admin/users/${bob.userId}/suspend`, { reason: 'x' }],
      ['POST', `/admin/users/${bob.userId}/unsuspend`],
      ['POST', `/admin/users/${bob.userId}/verify`],
      ['POST', `/admin/users/${bob.userId}/admin`, { admin: true }],
      ['GET', '/admin/reports'],
      ['POST', '/admin/reports/a.b/resolve', {}],
      ['GET', '/admin/audit'],
    ];
    for (const [method, path, body] of routes) {
      const refused = await call(world, method, path, amy.token, body);
      expect(refused.status).toBe(403);
      expect((refused.body as { error: { code: string } }).error.code).toBe('NOT_ADMIN');
      expect((await world.call(method, `/api${path}`, { body })).status).toBe(401);
    }
  });

  it('runs the whole moderation flow: report, review, suspend, resolve', async () => {
    const { world, root, amy, bob } = await setup();
    expect((await call(world, 'GET', '/users/me', root.token)).body).toMatchObject({ isAdmin: true });
    // login tells the client too, so it can show the Admin tab without another request
    const rootLogin = await world.call('POST', '/api/auth/login', { body: { email: 'root@example.com', password: 'correct horse' } });
    expect(rootLogin.body).toMatchObject({ result: 'SUCCESS', isAdmin: true });
    const amyLogin = await world.call('POST', '/api/auth/login', { body: { email: 'amy@example.com', password: 'correct horse' } });
    expect(amyLogin.body).toMatchObject({ result: 'SUCCESS', isAdmin: false });
    expect((await call(world, 'GET', '/users/me', amy.token)).body).toMatchObject({ isAdmin: false });
    expect((await call(world, 'GET', `/users/${bob.userId}`, amy.token)).body).not.toHaveProperty('isAdmin');

    const filed = await call(world, 'POST', `/users/${bob.userId}/report`, amy.token, { reason: 'FAKE_ACCOUNT', details: 'not a real person' });
    expect(filed.status).toBe(204);
    expect((await call(world, 'POST', `/users/${bob.userId}/report`, amy.token, { reason: 'REPORTED_IN_CHAT' })).status).toBe(400);
    expect((await call(world, 'POST', `/users/${bob.userId}/report`, amy.token, { reason: 'BORING' })).status).toBe(400);
    expect((await call(world, 'POST', `/users/${bob.userId}/report`, amy.token)).status).toBe(400);

    const { reports } = (await call(world, 'GET', '/admin/reports', root.token)).body as { reports: { reportId: string; reported: { email: string } }[] };
    expect(reports).toHaveLength(1);
    expect(reports[0]!.reported.email).toBe('bob@example.com');
    const { users } = (await call(world, 'GET', '/admin/users', root.token)).body as { users: { userId: string; openReports: number }[] };
    expect(users.find((u) => u.userId === bob.userId)!.openReports).toBe(1);

    expect((await call(world, 'POST', `/admin/users/${bob.userId}/suspend`, root.token, { reason: 'fake account' })).status).toBe(204);
    expect((await call(world, 'POST', `/admin/users/${bob.userId}/suspend`, root.token, {})).status).toBe(400);
    expect((await call(world, 'GET', '/songs/current', bob.token)).status).toBe(401);
    const login = await world.call('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'correct horse' } });
    expect(login.body).toEqual({ result: 'SUSPENDED' });

    const path = `/admin/reports/${encodeURIComponent(reports[0]!.reportId)}/resolve`;
    expect((await call(world, 'POST', path, root.token, { note: 'suspended' })).status).toBe(204);
    expect((await call(world, 'POST', path, root.token)).status).toBe(204); // no body is fine
    expect((await call(world, 'POST', `/admin/users/${bob.userId}/unsuspend`, root.token)).status).toBe(204);
    expect((await call(world, 'POST', `/admin/users/${bob.userId}/verify`, root.token)).status).toBe(204);
    expect((await call(world, 'POST', `/admin/users/${amy.userId}/admin`, root.token, { admin: true })).status).toBe(204);
    expect((await call(world, 'POST', `/admin/users/${amy.userId}/admin`, root.token, { admin: 'yes' })).status).toBe(400);
    expect((await call(world, 'GET', '/users/me', amy.token)).body).toMatchObject({ isAdmin: true });
    const { entries } = (await call(world, 'GET', '/admin/audit', amy.token)).body as { entries: { action: string }[] };
    expect(entries.map((e) => e.action)).toEqual(['GRANT_ADMIN', 'VERIFY', 'UNSUSPEND', 'RESOLVE_REPORT', 'RESOLVE_REPORT', 'SUSPEND']);
  });
});

describe('helpers added for the admin panel', () => {
  it('MatchModel.removeUser, lastActiveTimes and hasMatch; PushSubscriptionModel.removeAll', async () => {
    const { world, amy, bob, eve } = await setup();
    const model = world.services.matchModel;
    expect(await model.hasMatch(amy.userId, bob.userId)).toBe(true);
    expect(await model.hasMatch(bob.userId, amy.userId)).toBe(true);
    expect(await model.hasMatch(amy.userId, eve.userId)).toBe(false);
    expect([...(await model.lastActiveTimes()).keys()].sort()).toEqual([amy.userId, bob.userId].sort());
    await model.removeUser(bob.userId);
    await model.removeUser(bob.userId); // twice is harmless
    expect([...(await model.lastActiveTimes()).keys()]).toEqual([amy.userId]);
    await world.services.subscriptions.save(amy.userId, browser(1));
    await world.services.subscriptions.save(amy.userId, browser(2));
    await world.services.subscriptions.removeAll(amy.userId);
    expect(await world.services.subscriptions.list(amy.userId)).toEqual([]);
  });
});
