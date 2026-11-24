/**
 * The demo's fake users. Each bot has liked real songs from the mock library, so its Taste Vector
 * comes from the same update as a person's and matches arise from shared taste. When someone says
 * yes to a bot, the bot answers a few seconds later: yes if the match is good enough, otherwise no.
 * An online bot greets its new match and replies to messages.
 *
 * There are no timers: actions wait in a queue with a due time, and the mock runs whatever is due
 * on every API call. The app's polling therefore delivers them, and tests control the clock.
 *
 * Abstraction function: `personas` are the bots; `queue` is what they will do, and when.
 * Rep invariant: every queued action has a finite due time; `replying` holds the chats with a
 * reply in the queue.
 */
import type { SeedBot } from './mockSeed';
import type { Song } from './types';

/** How long a bot takes to do something, in milliseconds. */
export const BOT_DECISION_MS = { min: 2000, max: 6000 };
export const BOT_GREETING_MS = { min: 1000, max: 2500 };
export const BOT_REPLY_MS = { min: 1500, max: 4000 };

export interface MockBotDeps {
  now(): number;
  /** Source of randomness in [0, 1). */
  random(): number;
  /** Records the bot's answer to a match. */
  decide(matchId: string, botId: string, accepted: boolean): void;
  /** Sends a chat message from the bot. */
  say(chatId: string, botId: string, text: string): void;
  /** @returns a song both users liked, or null if there is none */
  sharedLike(userId: string, botId: string): Song | null;
}

interface BotAction {
  readonly dueAt: number;
  readonly run: () => void;
}

export class MockBots {
  private readonly deps: MockBotDeps;
  private readonly personas = new Map<string, SeedBot>();
  private queue: BotAction[] = [];
  private readonly deciding = new Set<string>();
  private readonly replying = new Set<string>();
  private readonly repliesSent = new Map<string, number>();

  /**
   * Requires: none.
   * Effects: creates a group of bots with none in it yet.
   */
  constructor(deps: MockBotDeps) {
    this.deps = deps;
  }

  /**
   * Requires: bot.userId is not already added.
   * Effects: bot takes part from now on.
   */
  add(bot: SeedBot): void {
    this.personas.set(bot.userId, bot);
  }

  /**
   * Requires: none.
   * Effects: none.
   * @returns true iff userId is a bot
   */
  isBot(userId: string): boolean {
    return this.personas.has(userId);
  }

  /**
   * Requires: botId is a bot in this match.
   * Effects: the first time for this match, the bot will accept after a short wait if
   *          compatibilityPercent reaches its threshold, and decline otherwise.
   */
  onUserConfirmed(matchId: string, botId: string, compatibilityPercent: number): void {
    if (this.deciding.has(matchId)) return;
    this.deciding.add(matchId);
    const accepted = compatibilityPercent >= this.personas.get(botId)!.acceptAtPercent;
    this.schedule(BOT_DECISION_MS, () => this.deps.decide(matchId, botId, accepted));
  }

  /**
   * Requires: botId is a bot in this chat, and userId is the other participant.
   * Effects: if the bot is online, it will send a greeting that names a song you both liked.
   */
  onChatOpened(chatId: string, botId: string, userId: string): void {
    if (!this.personas.get(botId)!.online) return;
    this.schedule(BOT_GREETING_MS, () => {
      const shared = this.deps.sharedLike(userId, botId);
      const text = shared === null ? 'Hey! Looks like we have similar taste.' : `Hey! We both liked "${shared.title}".`;
      this.deps.say(chatId, botId, text);
    });
  }

  /**
   * Requires: botId is a bot in this chat.
   * Effects: if the bot is online and no reply is already on its way, it will send its next line.
   */
  onUserMessage(chatId: string, botId: string): void {
    const bot = this.personas.get(botId)!;
    if (!bot.online || this.replying.has(chatId)) return;
    this.replying.add(chatId);
    this.schedule(BOT_REPLY_MS, () => {
      this.replying.delete(chatId);
      const sent = this.repliesSent.get(chatId) ?? 0;
      this.repliesSent.set(chatId, sent + 1);
      this.deps.say(chatId, botId, bot.replies[sent % bot.replies.length]);
    });
  }

  /**
   * Requires: none.
   * Effects: runs every queued action that is due, earliest first.
   */
  tick(): void {
    const now = this.deps.now();
    const due = this.queue.filter((action) => action.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
    this.queue = this.queue.filter((action) => action.dueAt > now);
    for (const action of due) action.run();
  }

  private schedule(range: { min: number; max: number }, run: () => void): void {
    const wait = range.min + this.deps.random() * (range.max - range.min);
    this.queue.push({ dueAt: this.deps.now() + wait, run });
  }
}
