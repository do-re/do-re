import { AccountController } from './account/AccountController';
import { AccountModel } from './account/AccountModel';
import type { EmailSender } from './account/EmailSender';
import { PasswordHasher } from './account/PasswordHasher';
import type { PictureStore } from './account/PictureStore';
import { SessionModel } from './account/SessionModel';
import { ChatController } from './chat/ChatController';
import { ChatModel } from './chat/ChatModel';
import type { Clock, RandomSource } from './deps';
import { MatchController } from './match/MatchController';
import { MatchModel } from './match/MatchModel';
import { MusicTasteModel } from './song/MusicTasteModel';
import { SongController } from './song/SongController';
import type { SongLibrary } from './song/SongLibrary';
import { SongSuggestionModel } from './song/SongSuggestionModel';
import type { Table } from './store/Table';

/** Everything the backend needs from outside itself. Tests pass fakes; lambda.ts passes AWS. */
export interface Dependencies {
  readonly table: Table;
  readonly email: EmailSender;
  readonly pictures: PictureStore;
  readonly library: SongLibrary;
  readonly clock: Clock;
  readonly random: RandomSource;
  /** Origin of the web app, used in confirmation links. No trailing slash. */
  readonly appBaseUrl: string;
  /** scrypt cost for new password hashes; defaults to PasswordHasher.DEFAULT_COST. */
  readonly passwordCost?: number;
}

/** Every server-side component, wired together as in docs/project/architecture.md. */
export interface Services {
  readonly clock: Clock;
  readonly sessions: SessionModel;
  readonly accountModel: AccountModel;
  readonly accounts: AccountController;
  readonly tasteModel: MusicTasteModel;
  readonly suggestionModel: SongSuggestionModel;
  readonly songs: SongController;
  readonly matchModel: MatchModel;
  readonly matches: MatchController;
  readonly chatModel: ChatModel;
  readonly chats: ChatController;
}

/**
 * Requires: deps.library has more than SongSuggestionModel.CACHE_SIZE songs.
 * Effects: none (construction only; nothing is read or written).
 * @returns the models and controllers, each given the components it communicates with
 */
export function buildServices(deps: Dependencies): Services {
  const { table, clock, random } = deps;
  const accountModel = new AccountModel(table, new PasswordHasher(deps.passwordCost, random), random, deps.pictures);
  const accounts = new AccountController(accountModel, table, deps.email, clock, random, deps.appBaseUrl);
  const tasteModel = new MusicTasteModel(table, deps.library);
  const suggestionModel = new SongSuggestionModel(deps.library, table);
  const matchModel = new MatchModel(table, random);
  const chatModel = new ChatModel(table, clock);
  const chats = new ChatController(chatModel, table, clock);
  return {
    clock,
    sessions: new SessionModel(table, clock, random),
    accountModel,
    accounts,
    tasteModel,
    suggestionModel,
    songs: new SongController(tasteModel, suggestionModel, matchModel, table, clock),
    matchModel,
    matches: new MatchController(matchModel, chats, accounts),
    chatModel,
    chats,
  };
}
