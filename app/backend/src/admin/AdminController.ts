import { type AccountModel, type AccountRecord, normalizeEmail } from '../account/AccountModel';
import type { SessionModel } from '../account/SessionModel';
import type { Clock, RandomSource } from '../deps';
import { AppError, badRequest } from '../errors';
import type { MatchModel } from '../match/MatchModel';
import type { PushSubscriptionModel } from '../notify/PushSubscriptionModel';
import type { Table } from '../store/Table';
import type { Report, ReportModel } from './ReportModel';

/** A user as the admin panel lists them. */
export interface AdminUser extends AccountRecord {
  /** Named in the server's configuration: always an admin, cannot be demoted or suspended. */
  readonly rootAdmin: boolean;
  /** Time of the user's last swipe, or null if they have never swiped (or are suspended). */
  readonly lastActiveAt: number | null;
  /** How many different users have an open report about this user. */
  readonly openReports: number;
}

/** A report with the two people in it, as the admin panel shows it. */
export interface AdminReport extends Report {
  readonly reporter: PersonSummary;
  readonly reported: PersonSummary;
}

export interface PersonSummary {
  readonly userId: string;
  readonly username: string;
  /** Empty if the account no longer exists. */
  readonly email: string;
}

export type AdminAction = 'SUSPEND' | 'UNSUSPEND' | 'VERIFY' | 'GRANT_ADMIN' | 'REVOKE_ADMIN' | 'RESOLVE_REPORT';

/** One line of the audit log. */
export interface AuditEntry {
  readonly at: number;
  readonly adminId: string;
  readonly action: AdminAction;
  /** A user ID, or a report ID for RESOLVE_REPORT. */
  readonly targetId: string;
  /** The reason or note given, if any. */
  readonly detail: string;
}

const AUDIT = 'AUDIT';
const notAdmin = () => new AppError(403, 'NOT_ADMIN', 'This page is for admins.');

/**
 * AdminController (server half): everything the admin panel does. New with the admin panel
 * (OPEN-18); owner Felix.
 * Resides on: client and server; this is the server side.
 * Communicates with: AdminView, AccountModel, SessionModel, MatchModel, PushSubscriptionModel,
 * ReportModel.
 *
 * Who is an admin: an account whose email is in rootAdminEmails (set in the server's
 * configuration), or one an admin has granted admin rights; in both cases only while the
 * account is not suspended. Every method takes the acting admin's ID and checks it first, on
 * the server, whatever the client shows.
 *
 * Safety rules, so the app cannot be left without an admin or an admin lock out its owner:
 * root admins cannot be suspended or demoted, and no admin can suspend or demote themselves.
 *
 * Stored state: AUDIT / <15-digit time>#<id> with at, adminId, action, targetId, detail:
 * one item per admin action, never changed or deleted.
 *
 * Concurrency: holds no state of its own beyond the append-only audit log (each entry is a
 * new item under a unique key, so entries cannot collide). Account changes go through
 * AccountModel's atomic updates; suspending twice at once leaves one suspension. The steps
 * of a suspension (flag, sessions, matching, subscriptions) are each idempotent and the flag
 * is written first, so a request that dies midway leaves the user unable to log in, and
 * repeating the suspension finishes the rest.
 */
export class AdminController {
  static readonly MAX_REASON = 300;
  /** How many audit entries the panel shows. */
  static readonly AUDIT_SHOWN = 100;

  private readonly roots: ReadonlySet<string>;

  /**
   * @param rootAdminEmails emails of the accounts that are always admins
   */
  constructor(
    private readonly accountModel: AccountModel,
    private readonly sessions: SessionModel,
    private readonly matchModel: MatchModel,
    private readonly subscriptions: PushSubscriptionModel,
    private readonly reportModel: ReportModel,
    private readonly table: Table,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    rootAdminEmails: readonly string[],
  ) {
    this.roots = new Set(rootAdminEmails.map(normalizeEmail).filter((email) => email !== ''));
  }

  /**
   * Effects: none.
   * @returns true iff userId is an existing, unsuspended account that is a root admin or
   *          has been granted admin rights
   */
  async isAdmin(userId: string): Promise<boolean> {
    const account = await this.accountModel.getAccount(userId).catch(() => undefined);
    return account !== undefined && account.suspended === null && (account.admin || this.roots.has(account.email));
  }

  /**
   * Requires: adminId is an admin.
   * Effects: none.
   * @returns every account, oldest first, with its last-active time and open report count
   * @throws AppError 403 NOT_ADMIN if adminId is not an admin
   */
  async listUsers(adminId: string): Promise<AdminUser[]> {
    await this.requireAdmin(adminId);
    const [accounts, lastActive, reports] = await Promise.all([
      this.accountModel.listUsers(),
      this.matchModel.lastActiveTimes(),
      this.reportModel.list(),
    ]);
    const open = new Map<string, number>();
    for (const report of reports.filter((r) => r.resolved === null)) {
      open.set(report.reportedId, (open.get(report.reportedId) ?? 0) + 1);
    }
    return accounts.map((account) => ({
      ...account,
      rootAdmin: this.roots.has(account.email),
      lastActiveAt: lastActive.get(account.userId) ?? null,
      openReports: open.get(account.userId) ?? 0,
    }));
  }

  /**
   * Requires: adminId is an admin; userId is another existing account that is not a root
   *           admin; reason, once trimmed, has 1 to MAX_REASON characters.
   * Effects: the account is suspended: it cannot log in, every session it has ends, it is
   *          taken out of matching and its push subscriptions are removed. Its chats and
   *          matches stay as they are for the other users. The action is logged.
   * @throws AppError 403 NOT_ADMIN; 400 if a requirement about the target or reason does not
   *         hold; 404 if there is no such account
   */
  async suspend(adminId: string, userId: string, reason: string): Promise<void> {
    await this.requireAdmin(adminId);
    const why = reason.trim();
    if (why === '' || why.length > AdminController.MAX_REASON) {
      throw badRequest(`Give a reason of 1 to ${AdminController.MAX_REASON} characters.`);
    }
    await this.requireOther(adminId, userId, 'suspend');
    await this.accountModel.suspend(userId, { at: this.clock(), by: adminId, reason: why });
    await this.sessions.endAllSessions(userId);
    await this.matchModel.removeUser(userId);
    await this.subscriptions.removeAll(userId);
    await this.record(adminId, 'SUSPEND', userId, why);
  }

  /**
   * Requires: adminId is an admin; userId is an existing account.
   * Effects: the account is not suspended afterwards and can log in again; it rejoins
   *          matching the next time it swipes. The action is logged.
   * @throws AppError 403 NOT_ADMIN; 404 if there is no such account
   */
  async unsuspend(adminId: string, userId: string): Promise<void> {
    await this.requireAdmin(adminId);
    await this.accountModel.unsuspend(userId);
    await this.record(adminId, 'UNSUSPEND', userId);
  }

  /**
   * Marks an account's email as verified without the emailed link (OPEN-7).
   *
   * Requires: adminId is an admin; userId is an existing account.
   * Effects: the account is active afterwards. The action is logged.
   * @throws AppError 403 NOT_ADMIN; 404 if there is no such account
   */
  async verify(adminId: string, userId: string): Promise<void> {
    await this.requireAdmin(adminId);
    await this.accountModel.activateAccount(userId);
    await this.record(adminId, 'VERIFY', userId);
  }

  /**
   * Requires: adminId is an admin; userId is another existing account that is not a root
   *           admin.
   * Effects: the account has admin rights iff admin is true. The action is logged.
   * @throws AppError 403 NOT_ADMIN; 400 if userId is adminId or a root admin; 404 if there
   *         is no such account
   */
  async setAdmin(adminId: string, userId: string, admin: boolean): Promise<void> {
    await this.requireAdmin(adminId);
    await this.requireOther(adminId, userId, admin ? 'change the admin rights of' : 'remove admin rights from');
    await this.accountModel.setAdmin(userId, admin);
    await this.record(adminId, admin ? 'GRANT_ADMIN' : 'REVOKE_ADMIN', userId);
  }

  /**
   * Requires: adminId is an admin.
   * Effects: none.
   * @returns every report, open ones first, each with its reporter and reported user
   * @throws AppError 403 NOT_ADMIN
   */
  async listReports(adminId: string): Promise<AdminReport[]> {
    await this.requireAdmin(adminId);
    const reports = await this.reportModel.list();
    const people = new Map<string, PersonSummary>();
    for (const id of new Set(reports.flatMap((report) => [report.reporterId, report.reportedId]))) {
      const account = await this.accountModel.getAccount(id).catch(() => undefined);
      people.set(id, { userId: id, username: account?.username ?? '', email: account?.email ?? '' });
    }
    return reports.map((report) => ({
      ...report,
      reporter: people.get(report.reporterId)!,
      reported: people.get(report.reportedId)!,
    }));
  }

  /**
   * Requires: adminId is an admin; reportId names an existing report.
   * Effects: the report is resolved (see ReportModel.resolve). The action is logged.
   * @throws AppError 403 NOT_ADMIN; 404 if there is no such report; 400 if the note is too long
   */
  async resolveReport(adminId: string, reportId: string, note = ''): Promise<void> {
    await this.requireAdmin(adminId);
    await this.reportModel.resolve(reportId, adminId, note);
    await this.record(adminId, 'RESOLVE_REPORT', reportId, note.trim());
  }

  /**
   * Requires: adminId is an admin.
   * Effects: none.
   * @returns the latest AUDIT_SHOWN admin actions, newest first
   * @throws AppError 403 NOT_ADMIN
   */
  async auditLog(adminId: string): Promise<AuditEntry[]> {
    await this.requireAdmin(adminId);
    const items = await this.table.query(AUDIT);
    return items
      .slice(-AdminController.AUDIT_SHOWN)
      .reverse()
      .map((item) => ({
        at: item.at as number,
        adminId: item.adminId as string,
        action: item.action as AdminAction,
        targetId: item.targetId as string,
        detail: item.detail as string,
      }));
  }

  private async requireAdmin(userId: string): Promise<void> {
    if (!(await this.isAdmin(userId))) {
      throw notAdmin();
    }
  }

  /** Enforces the safety rules: the target is someone else and not a root admin. */
  private async requireOther(adminId: string, userId: string, verb: string): Promise<void> {
    if (userId === adminId) {
      throw badRequest(`You cannot ${verb} your own account.`);
    }
    const target = await this.accountModel.getAccount(userId);
    if (this.roots.has(target.email)) {
      throw badRequest(`You cannot ${verb} a root admin. Root admins are set in the server's configuration.`);
    }
  }

  private async record(adminId: string, action: AdminAction, targetId: string, detail = ''): Promise<void> {
    const at = this.clock();
    const key = { pk: AUDIT, sk: `${String(at).padStart(15, '0')}#${this.random.id()}` };
    await this.table.write([{ op: 'put', item: { ...key, version: 1, at, adminId, action, targetId, detail }, expect: 'absent' }]);
  }
}
