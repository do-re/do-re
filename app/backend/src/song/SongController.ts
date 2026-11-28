import type { Clock } from '../deps';
import { badRequest, songNotActive } from '../errors';
import type { MatchModel } from '../match/MatchModel';
import { type Feedback, otherUser, type Song, type SwipeResult, type UndoResult } from '../model/types';
import type { EventPublisher } from '../notify/events';
import type { TasteVector } from '../model/vectors';
import { type Item, type Key, type Table, updateItem } from '../store/Table';
import type { MusicTasteModel } from './MusicTasteModel';
import type { SongSuggestionModel } from './SongSuggestionModel';

const stateKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'SONGSTATE' });

interface SongState {
  readonly active: string | undefined;
  readonly liked: boolean;
  readonly swipeCount: number;
  /** The user's latest swipes that can still be undone, oldest first. */
  readonly undo: { songId: string; liked: boolean }[];
}

/**
 * SongController (server half): serves songs to HomeView, forwards like/skip and listen time
 * to MusicTasteModel, and passes Taste Vectors to SongSuggestionModel and MatchModel.
 * Resides on: client and server; this is the server side.
 * Communicates with: HomeView, MusicTasteModel, SongSuggestionModel, MatchModel.
 *
 * Stored state: USER#<id> / SONGSTATE with active (ID of the song on the user's HomeView),
 * liked (whether the like button was pressed on it), swipeCount (swipes so far, less undone
 * ones) and undo (the song and like-button state of each of the last UNDO_LIMIT swipes).
 *
 * Concurrency: a swipe must count once even if the request is retried or sent from two
 * tabs. submitFeedback first "claims" the swipe: one conditional write (through updateItem)
 * that replaces the active song, and applies only if the active song is still the one
 * swiped. Of concurrent requests for the same song exactly one claim applies; the others
 * re-read, see a different active song and fail with NOT_ACTIVE_SONG. Only the winner goes
 * on to update the Taste Vector and leaderboards, so a song reaches the Taste Vector at most
 * once. (If the instance dies right after the claim, that one listen is not recorded; the
 * stored data stays consistent.) undoLastSwipe claims in the same way: one conditional write
 * pops the swipe, so each stored swipe is undone at most once.
 */
export class SongController {
  /** How many swipes in a row the undo button can reverse. */
  static readonly UNDO_LIMIT = 10;

  constructor(
    private readonly tasteModel: MusicTasteModel,
    private readonly suggestionModel: SongSuggestionModel,
    private readonly matchModel: MatchModel,
    private readonly table: Table,
    private readonly clock: Clock,
    private readonly publisher?: EventPublisher,
  ) {}

  /**
   * Prepares suggestions when the user opens the app.
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: pulls the user's Taste Vector and asks SongSuggestionModel to preload its cache.
   */
  async onAppOpened(userId: string): Promise<void> {
    await this.suggestionModel.preloadCache(userId, await this.tasteModel.getTasteVector(userId));
  }

  /**
   * Satisfies: R-HOME-03.
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: if no song is active, pulls new songs from the music platform if the user is
   *          running low (SongSuggestionModel.pullSuggestions) and makes the next suggestion
   *          the active song.
   * @returns the song currently active for this user
   */
  async getCurrentSong(userId: string): Promise<Song> {
    return updateItem(this.table, stateKey(userId), async (current) => {
      const state = stateOf(current);
      const active = state.active === undefined ? undefined : await this.suggestionModel.getSong(state.active);
      if (active !== undefined) {
        return { result: active };
      }
      const taste = await this.tasteModel.getTasteVector(userId);
      await this.suggestionModel.pullSuggestions(userId, taste);
      const next = await this.suggestionModel.nextSuggestion(userId, taste);
      return { attrs: { ...state, active: next.id, liked: false }, result: next };
    });
  }

  /**
   * Handles the like button: records that the user likes the active song without leaving
   * it. The like reaches the Taste Vector once, when the user leaves the song.
   * Satisfies: R-HOME-25.
   *
   * Requires: userId belongs to a logged-in user; songId is the user's active song.
   * Effects: the active song is marked liked for this user (idempotent).
   * @throws AppError 409 NOT_ACTIVE_SONG if songId is not the user's active song
   */
  async markLiked(userId: string, songId: string): Promise<void> {
    await updateItem(this.table, stateKey(userId), (current) => {
      const state = stateOf(current);
      if (state.active !== songId) {
        throw songNotActive();
      }
      return state.liked ? { result: undefined } : { attrs: { ...state, liked: true }, result: undefined };
    });
  }

  /**
   * Records the user's reaction to the active song and advances to the next one.
   * Satisfies: R-HOME-15, R-HOME-16, R-HOME-17, R-HOME-19, R-HOME-24.
   *
   * Requires: userId belongs to a logged-in user; songId is the user's active song;
   *           secondsListened is finite and >= 0 (values above the song's duration count as
   *           the whole song).
   * Effects: pulls new songs from the music platform if the user is running low
   *          (SongSuggestionModel.pullSuggestions); makes the next suggestion the active
   *          song, increments the user's swipe count
   *          and remembers the swipe for undo (atomically, see the class comment; only the
   *          last UNDO_LIMIT swipes are kept); sends the listen to MusicTasteModel
   *          with feedback LIKE if swipe is LIKE or the song was marked liked, SKIP otherwise
   *          (so a song counts once); sends the updated Taste Vector and the current time to
   *          MatchModel.updateUser.
   * @param swipe LIKE (swipe right or right arrow) or SKIP (swipe left or left arrow)
   *          If a match is offered and a publisher was given, announces it so the other
   *          user of the match can be notified.
   * @returns the new active song, and MatchModel.findMatch(userId, now) if
   *          MatchModel.shouldOfferMatch(userId, swipe count) is true (otherwise undefined)
   * @throws AppError 400 if secondsListened is invalid; 409 SONG_NOT_ACTIVE if songId is not
   *         the user's active song (for example because this swipe was already recorded)
   */
  async submitFeedback(userId: string, songId: string, swipe: Feedback, secondsListened: number): Promise<SwipeResult> {
    if (!Number.isFinite(secondsListened) || secondsListened < 0) {
      throw badRequest('secondsListened must be a number of seconds, 0 or more.');
    }
    // Top up from the music platform first, outside the atomic claim below, so a slow or
    // failed platform request can never repeat or block the claim.
    await this.suggestionModel.pullSuggestions(userId, await this.tasteModel.getTasteVector(userId));
    const claimed = await updateItem(this.table, stateKey(userId), async (current) => {
      const state = stateOf(current);
      const song = state.active === songId ? await this.suggestionModel.getSong(songId) : undefined;
      if (song === undefined) {
        throw songNotActive();
      }
      const next = await this.suggestionModel.nextSuggestion(userId, await this.tasteModel.getTasteVector(userId));
      const swipeCount = state.swipeCount + 1;
      const undo = [...state.undo, { songId, liked: state.liked }].slice(-SongController.UNDO_LIMIT);
      return {
        attrs: { active: next.id, liked: false, swipeCount, undo },
        result: { song, next, liked: state.liked, swipeCount },
      };
    });
    const now = this.clock();
    await this.tasteModel.recordListen(userId, {
      song: claimed.song,
      feedback: swipe === 'LIKE' || claimed.liked ? 'LIKE' : 'SKIP',
      secondsListened: Math.min(secondsListened, claimed.song.durationSeconds),
      time: now,
    });
    await this.matchModel.updateUser(userId, await this.tasteModel.getTasteVector(userId), now);
    const offer = await this.matchModel.shouldOfferMatch(userId, claimed.swipeCount);
    const offeredMatch = offer ? await this.matchModel.findMatch(userId, now) : undefined;
    if (offeredMatch !== undefined) {
      // The swiper sees the match in this response; the other user is told by notification.
      await this.publisher?.publish({
        type: 'MATCH_OFFERED',
        toUserId: otherUser(offeredMatch, userId),
        fromUserId: userId,
        matchId: offeredMatch.matchId,
      });
    }
    return { nextSong: claimed.next, offeredMatch };
  }

  /**
   * Tells the undo button whether it can be used. Added to stubs v2 (api.md Q-14).
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: none.
   * @returns true iff undoLastSwipe would go back to a song
   */
  async canUndo(userId: string): Promise<boolean> {
    return stateOf(await this.table.get(stateKey(userId))).undo.length > 0;
  }

  /**
   * The undo button: reverses the user's latest swipe, so a song swiped again counts once.
   * A match that swipe already offered stays. Added to stubs v2 (api.md Q-14).
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: if there is a swipe to undo: its song becomes the active song again with its
   *          like button as it was, and the swipe count drops by one (atomically); the
   *          listen leaves the history and Taste Vector; the song that was active returns to
   *          the front of the suggestions; the leaderboards get the restored Taste Vector.
   *          Otherwise nothing changes.
   * @returns the restored song, or undefined if there is nothing to undo
   */
  async undoLastSwipe(userId: string): Promise<UndoResult | undefined> {
    const undone = await updateItem(this.table, stateKey(userId), async (current) => {
      const state = stateOf(current);
      const last = state.undo.at(-1);
      const song = last === undefined ? undefined : await this.suggestionModel.getSong(last.songId);
      if (last === undefined || song === undefined) {
        return { result: undefined };
      }
      const undo = state.undo.slice(0, -1);
      return {
        attrs: { active: song.id, liked: last.liked, swipeCount: Math.max(0, state.swipeCount - 1), undo },
        result: { song, liked: last.liked, canUndo: undo.length > 0, left: state.active },
      };
    });
    if (undone === undefined) {
      return undefined;
    }
    await this.tasteModel.undoLastListen(userId);
    const left = undone.left === undefined ? undefined : await this.suggestionModel.getSong(undone.left);
    if (left !== undefined) {
      await this.suggestionModel.returnSuggestion(userId, left);
    }
    await this.matchModel.updateUser(userId, await this.tasteModel.getTasteVector(userId), this.clock());
    return { song: undone.song, liked: undone.liked, canUndo: undone.canUndo };
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns the user's current Taste Vector, pulled from MusicTasteModel
   */
  getTasteVector(userId: string): Promise<TasteVector> {
    return this.tasteModel.getTasteVector(userId);
  }
}

function stateOf(item: Item | undefined): SongState {
  return {
    active: item?.active as string | undefined,
    liked: item?.liked === true,
    swipeCount: (item?.swipeCount ?? 0) as number,
    undo: (item?.undo ?? []) as SongState['undo'],
  };
}
