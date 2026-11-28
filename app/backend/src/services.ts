import { AccountController } from './account/AccountController';
import { AdminController } from './admin/AdminController';
import { ReportController } from './admin/ReportController';
import { ReportModel } from './admin/ReportModel';
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
import type { EventPublisher } from './notify/events';
import { Notifier, type PushSender } from './notify/Notifier';
import { PushSubscriptionModel } from './notify/PushSubscriptionModel';
import { MusicTasteModel } from './song/MusicTasteModel';
import { SongController } from './song/SongController';
import type { MusicSource } from './song/MusicSource';
import { SongCatalog } from './song/SongCatalog';
import type { SongLibrary } from './song/SongLibrary';
import { SongSuggestionModel } from './song/SongSuggestionModel';
import type { Table } from './store/Table';

/** Everything the backend needs from outside itself. Tests pass fakes; lambda.ts passes AWS. */
export interface Dependencies {
  readonly table: Table;
  readonly email: EmailSender;
  readonly pictures: PictureStore;
  /** The bundled starting library. */
  readonly library: SongLibrary;
  /** The music platform to pull songs from while users swipe; omit to use only the library. */
  readonly musicSource?: MusicSource;
  readonly clock: Clock;
  readonly random: RandomSource;
  /** Origin of the web app, used in confirmation links. No trailing slash. */
  readonly appBaseUrl: string;
  /** Where match and chat events are announced for push notifications; omit for none. */
  readonly publisher?: EventPublisher;
  /** The app's VAPID public key, given to browsers that subscribe; omit if push is not set up. */
  readonly vapidPublicKey?: string;
  /** Emails of the accounts that are always admins (OPEN-18); omit for none. */
  readonly adminEmails?: readonly string[];
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
  readonly subscriptions: PushSubscriptionModel;
  readonly reportModel: ReportModel;
  readonly reports: ReportController;
  readonly admin: AdminController;
  /** Undefined when push notifications are not set up. */
  readonly vapidPublicKey: string | undefined;
}

/**
 * Requires: deps.library has more than SongSuggestionModel.CACHE_SIZE songs.
 * Effects: none (construction only; nothing is read or written).
 * @returns the models and controllers, each given the components it communicates with
 */
export function buildServices(deps: Dependencies): Services {
  const { table, clock, random } = deps;
  const accountModel = new AccountModel(table, new PasswordHasher(deps.passwordCost, random), random, deps.pictures, clock);
  const accounts = new AccountController(accountModel, table, deps.email, clock, random, deps.appBaseUrl);
  const catalog = new SongCatalog(deps.library, table);
  const tasteModel = new MusicTasteModel(table, catalog);
  const suggestionModel = new SongSuggestionModel(catalog, table, deps.musicSource, clock);
  const matchModel = new MatchModel(table, random);
  const chatModel = new ChatModel(table, clock);
  const reportModel = new ReportModel(table, clock);
  const chats = new ChatController(chatModel, table, clock, deps.publisher, reportModel);
  const sessions = new SessionModel(table, clock, random);
  const subscriptions = new PushSubscriptionModel(table, clock);
  return {
    clock,
    sessions,
    accountModel,
    accounts,
    tasteModel,
    suggestionModel,
    songs: new SongController(tasteModel, suggestionModel, matchModel, table, clock, deps.publisher),
    matchModel,
    matches: new MatchController(matchModel, chats, accounts, deps.publisher),
    chatModel,
    chats,
    subscriptions,
    reportModel,
    reports: new ReportController(reportModel, matchModel),
    admin: new AdminController(accountModel, sessions, matchModel, subscriptions, reportModel, table, clock, random, deps.adminEmails ?? []),
    vapidPublicKey: deps.vapidPublicKey === '' ? undefined : deps.vapidPublicKey,
  };
}

/**
 * Effects: none (construction only).
 * @param sender how pushes reach browsers
 * @param log    where failed deliveries are reported
 * @returns the Notifier that delivers these services' events
 */
export function buildNotifier(services: Services, sender: PushSender, log?: (line: string) => void): Notifier {
  return new Notifier(services.accountModel, services.chatModel, services.subscriptions, sender, log);
}
