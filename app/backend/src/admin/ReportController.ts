import { pairId } from '../deps';
import { notParticipant } from '../errors';
import type { MatchModel } from '../match/MatchModel';
import type { ReportModel, ReportReason } from './ReportModel';

/**
 * ReportController (server half): lets a user report another user's profile from the match
 * screen. New with the admin panel (OPEN-18). The chat screen's report button goes through
 * ChatController.reportChat, which files its report with ReportModel directly.
 * Resides on: client and server; this is the server side.
 * Communicates with: MatchView, ReportModel, MatchModel.
 *
 * Concurrency: holds no state; ReportModel.file and MatchModel.recordDecision are each atomic
 * and idempotent, so a repeated or concurrent report leaves one report and one decline.
 */
export class ReportController {
  constructor(
    private readonly reportModel: ReportModel,
    private readonly matchModel: MatchModel,
  ) {}

  /**
   * Requires: reporterId belongs to a logged-in user who has been matched with reportedId
   *           (a proposed match is enough), which is the only way to have seen their profile.
   * Effects: files a report about reportedId (see ReportModel.file) and declines the match
   *          between the two if the reporter has not answered it, so the pair is not
   *          proposed again.
   * @throws AppError 403 if the two users were never matched; 400 if details is too long
   */
  async reportProfile(reporterId: string, reportedId: string, reason: ReportReason, details?: string): Promise<void> {
    if (!(await this.matchModel.hasMatch(reporterId, reportedId))) {
      throw notParticipant('You can only report someone you were matched with.');
    }
    const matchId = pairId(reporterId, reportedId);
    await this.reportModel.file({ reporterId, reportedId, source: 'MATCH', reason, details, contextId: matchId });
    await this.matchModel.recordDecision(matchId, reporterId, false);
  }
}
