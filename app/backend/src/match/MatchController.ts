import type { AccountController } from '../account/AccountController';
import type { ChatController } from '../chat/ChatController';
import { notParticipant } from '../errors';
import { type Match, otherUser, type UserProfile } from '../model/types';
import type { MatchModel } from './MatchModel';

/**
 * MatchController (server half): serves pending matches to MatchView, records
 * confirm/decline, and opens a chat when both users confirm. (Named but not described by the
 * golden architecture; OPEN-14.)
 * Resides on: client and server; this is the server side.
 * Communicates with: MatchModel, MatchView, ChatController, AccountController.
 *
 * Concurrency: holds no state. confirmMatch relies on two guarantees that hold across
 * Lambda instances: MatchModel.recordDecision completes a match at most once, and
 * ChatController.openChat is idempotent per pair. Either alone gives "exactly one chat";
 * together they also cover a request that crashed between the two steps and is retried.
 */
export class MatchController {
  constructor(
    private readonly matchModel: MatchModel,
    private readonly chatController: ChatController,
    private readonly accountController: AccountController,
  ) {}

  /**
   * Used when a user opens the app or HomeView, so the second user of a match sees it too.
   * Satisfies: R-HOME-20.
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: none.
   * @returns MatchModel.getPendingMatches(userId)
   */
  getPendingMatches(userId: string): Promise<Match[]> {
    return this.matchModel.getPendingMatches(userId);
  }

  /**
   * Lets MatchView reload a match from its URL after a refresh. Added to stubs v2
   * (notes-for-felix F-4).
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: none.
   * @returns the match with this ID if it is still waiting for userId's answer, otherwise
   *          undefined, so an old link cannot re-answer a match
   */
  getMatch(matchId: string, userId: string): Promise<Match | undefined> {
    return this.matchModel.getPendingMatch(matchId, userId);
  }

  /**
   * Requires: userId is one of match's users.
   * Effects: none.
   * @returns the other user's username and profile picture
   * @throws AppError 403 if userId is not one of match's users
   */
  async getOtherProfile(match: Match, userId: string): Promise<UserProfile> {
    if (match.userA !== userId && match.userB !== userId) {
      throw notParticipant('You are not part of that match.');
    }
    return this.accountController.getProfile(otherUser(match, userId));
  }

  /**
   * Satisfies: R-HOME-21, R-HOME-23.
   *
   * Requires: matchId names an existing match; userId is one of its users.
   * Effects: records the confirmation in MatchModel (a user's first decision stands); if
   *          both users have now confirmed, makes sure the one chat between them exists.
   * @returns the ID of the chat for this match, or undefined if the two users have not both
   *          confirmed (OPEN-4)
   * @throws AppError 404 if there is no such match; 403 if userId is not one of its users
   */
  async confirmMatch(matchId: string, userId: string): Promise<string | undefined> {
    const completed = await this.matchModel.recordDecision(matchId, userId, true);
    if (!completed && !(await this.matchModel.isMutual(matchId))) {
      return undefined;
    }
    const match = await this.matchModel.getMatch(matchId);
    return this.chatController.openChat(match.userA, match.userB);
  }

  /**
   * Satisfies: R-HOME-21, R-HOME-22.
   *
   * Requires: matchId names an existing match; userId is one of its users.
   * Effects: records the decline in MatchModel; the pair is never proposed again.
   * @throws AppError 404 if there is no such match; 403 if userId is not one of its users
   */
  async declineMatch(matchId: string, userId: string): Promise<void> {
    await this.matchModel.recordDecision(matchId, userId, false);
  }
}
