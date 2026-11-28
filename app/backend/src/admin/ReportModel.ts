import type { Clock } from '../deps';
import { AppError, badRequest } from '../errors';
import { attributesOf, type Item, type Key, type Table, updateItem } from '../store/Table';

/** Why a profile was reported. REPORTED_IN_CHAT is filed by the chat screen's report button. */
export const REPORT_REASONS = ['FAKE_ACCOUNT', 'HARASSMENT', 'INAPPROPRIATE', 'SPAM', 'OTHER', 'REPORTED_IN_CHAT'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** What a user submits. */
export interface NewReport {
  readonly reporterId: string;
  readonly reportedId: string;
  /** Where the report was made: the match screen or a chat. */
  readonly source: 'MATCH' | 'CHAT';
  readonly reason: ReportReason;
  /** The reporter's own words, optional. */
  readonly details?: string;
  /** The match or chat the report was made from. */
  readonly contextId: string;
}

/** A stored report. */
export interface Report extends Required<NewReport> {
  /** "<reportedId>.<reporterId>": there is at most one report per reporter per reported user. */
  readonly reportId: string;
  readonly createdAt: number;
  /** Set once an admin has handled the report. */
  readonly resolved: { readonly by: string; readonly at: number; readonly note: string } | null;
}

const REPORTS = 'REPORT';
const reportKey = (reportId: string): Key => ({ pk: REPORTS, sk: reportId });

/**
 * ReportModel: stores reports that users file about other users' profiles, for admins.
 * New with the admin panel (OPEN-18); owner Felix.
 * Resides on: server. Communicates with: ReportController, AdminController.
 *
 * Stored state: REPORT / <reportedId>.<reporterId> with the Report's fields.
 *
 * Abstraction function: AF(table) = the set of reports, each either open or resolved.
 * Rep invariant: at most one report per (reporter, reported) pair, because the pair is the
 *   key; reporterId != reportedId; details has at most MAX_DETAILS characters.
 *
 * Concurrency: file() and resolve() are read-modify-writes of one item through updateItem.
 * Two identical reports sent at once produce one stored report; a report resolved while it
 * is being filed again ends in one of the two serial orders (resolved, or reopened).
 */
export class ReportModel {
  static readonly MAX_DETAILS = 500;
  static readonly MAX_NOTE = 300;

  constructor(
    private readonly table: Table,
    private readonly clock: Clock,
  ) {}

  /**
   * Requires: report.reporterId and report.reportedId are different existing users.
   * Effects: if the reporter has no open report about the reported user, stores this one
   *          (replacing a resolved one, which reopens the case); otherwise changes nothing.
   * @returns true iff a report was stored
   * @throws AppError 400 if the two users are the same or details is too long
   */
  async file(report: NewReport): Promise<boolean> {
    const details = (report.details ?? '').trim();
    if (report.reporterId === report.reportedId) {
      throw badRequest('You cannot report yourself.');
    }
    if (details.length > ReportModel.MAX_DETAILS) {
      throw badRequest(`Keep the details to ${ReportModel.MAX_DETAILS} characters or fewer.`);
    }
    const reportId = `${report.reportedId}.${report.reporterId}`;
    return updateItem(this.table, reportKey(reportId), (current) => {
      if (current !== undefined && current.resolved === null) {
        return { result: false };
      }
      return { attrs: { ...report, details, createdAt: this.clock(), resolved: null }, result: true };
    });
  }

  /**
   * Effects: none.
   * @returns every report: open ones first, then resolved ones; newest first within each
   */
  async list(): Promise<Report[]> {
    return (await this.table.query(REPORTS))
      .map(reportOf)
      .sort((a, b) => Number(a.resolved !== null) - Number(b.resolved !== null) || b.createdAt - a.createdAt || (a.reportId < b.reportId ? -1 : 1));
  }

  /**
   * Requires: reportId names an existing report.
   * Effects: if the report is open, it becomes resolved by adminId now, with the note;
   *          a resolved report is left as it is.
   * @throws AppError 404 if there is no such report; 400 if the note is too long
   */
  async resolve(reportId: string, adminId: string, note = ''): Promise<void> {
    if (note.trim().length > ReportModel.MAX_NOTE) {
      throw badRequest(`Keep the note to ${ReportModel.MAX_NOTE} characters or fewer.`);
    }
    await updateItem(this.table, reportKey(reportId), (current) => {
      if (current === undefined) {
        throw new AppError(404, 'REPORT_NOT_FOUND', 'That report does not exist.');
      }
      if (current.resolved !== null) {
        return { result: undefined };
      }
      const resolved = { by: adminId, at: this.clock(), note: note.trim() };
      return { attrs: { ...attributesOf(current), resolved }, result: undefined };
    });
  }
}

function reportOf(item: Item): Report {
  return {
    reportId: item.sk,
    reporterId: item.reporterId as string,
    reportedId: item.reportedId as string,
    source: item.source as Report['source'],
    reason: item.reason as ReportReason,
    details: item.details as string,
    contextId: item.contextId as string,
    createdAt: item.createdAt as number,
    resolved: item.resolved as Report['resolved'],
  };
}
