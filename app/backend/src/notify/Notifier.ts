import type { AccountModel } from '../account/AccountModel';
import type { ChatModel } from '../chat/ChatModel';
import type { NotificationEvent } from './events';
import type { BrowserSubscription, PushSubscriptionModel } from './PushSubscriptionModel';

/** What the service worker receives and shows (frontend/public/sw.js). */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  /** Path in the app to open when the notification is clicked. */
  readonly url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  readonly tag: string;
}

/** Sends one push to one browser. An interface so tests record instead of sending. */
export interface PushSender {
  /**
   * Effects: asks the browser's push service to deliver payload.
   * @returns 'sent', or 'gone' if the push service says the subscription no longer exists
   * @throws for any other failure
   */
  send(subscription: BrowserSubscription, payload: string): Promise<'sent' | 'gone'>;
}

/** The part of the web-push package WebPushSender uses. */
export interface WebPushLike {
  sendNotification(
    subscription: BrowserSubscription,
    payload: string,
    options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number },
  ): Promise<unknown>;
}

/**
 * PushSender using the W3C Web Push protocol (web-push package): the payload is encrypted
 * for the browser, and the request is signed with the app's VAPID key so the push service
 * knows it comes from this app.
 */
export class WebPushSender implements PushSender {
  /** How long a push service keeps a notification for a browser that is offline: 1 hour. */
  static readonly TTL_SECONDS = 60 * 60;

  /**
   * @param webPush the web-push module
   * @param vapid   the app's key pair, and a mailto: or https: contact the push service can use
   */
  constructor(
    private readonly webPush: WebPushLike,
    private readonly vapid: { readonly subject: string; readonly publicKey: string; readonly privateKey: string },
  ) {}

  async send(subscription: BrowserSubscription, payload: string): Promise<'sent' | 'gone'> {
    try {
      await this.webPush.sendNotification(subscription, payload, { vapidDetails: { ...this.vapid }, TTL: WebPushSender.TTL_SECONDS });
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        return 'gone';
      }
      throw error;
    }
  }
}

/**
 * Notifier: turns a NotificationEvent into pushes to every browser the recipient subscribed
 * in. Runs in the notifier Lambda (subscribed to the event topic), or in-process on the
 * development server.
 * Resides on: server. Communicates with: AccountModel, ChatModel, PushSubscriptionModel,
 * the browsers' push services.
 *
 * Concurrency: holds no state. Delivery is at-least-once (SNS may invoke twice); a repeated
 * push carries the same tag, so the browser shows one notification, not two.
 */
export class Notifier {
  /**
   * @param log where failed deliveries are reported: the error's name and status only, never
   *            the endpoint, the payload or a username
   */
  constructor(
    private readonly accountModel: AccountModel,
    private readonly chatModel: ChatModel,
    private readonly subscriptions: PushSubscriptionModel,
    private readonly sender: PushSender,
    private readonly log: (line: string) => void = console.error,
  ) {}

  /**
   * Requires: event.fromUserId and event.toUserId are different users.
   * Effects: sends the event's notification to each of the recipient's subscribed browsers;
   *          removes subscriptions the push service reports gone; logs any other delivery
   *          failure and carries on with the next browser. A MESSAGE event is not delivered
   *          if the recipient has removed or reported the chat.
   * @returns how many browsers the notification was sent to
   */
  async handle(event: NotificationEvent): Promise<number> {
    if (event.type === 'MESSAGE' && !(await this.chatModel.isVisibleTo(event.chatId, event.toUserId))) {
      return 0;
    }
    const browsers = await this.subscriptions.list(event.toUserId);
    if (browsers.length === 0) {
      return 0;
    }
    const payload = JSON.stringify(await this.payloadFor(event));
    let sent = 0;
    for (const browser of browsers) {
      try {
        if ((await this.sender.send(browser, payload)) === 'gone') {
          await this.subscriptions.remove(event.toUserId, browser.endpoint);
        } else {
          sent++;
        }
      } catch (error) {
        const { name, statusCode } = error as { name?: string; statusCode?: number };
        this.log(`Push failed: ${name} ${statusCode ?? ''}`.trim());
      }
    }
    return sent;
  }

  /**
   * Effects: none.
   * @returns the notification for event, naming the sender by username ("Someone" if they
   *          have none or their account is gone)
   */
  async payloadFor(event: NotificationEvent): Promise<PushPayload> {
    const username = await this.accountModel.getProfile(event.fromUserId).then(
      (profile) => profile.username.trim(),
      () => '',
    );
    const name = username === '' ? 'Someone' : username;
    switch (event.type) {
      case 'MATCH_OFFERED':
        return {
          title: 'You have a new match!',
          body: `You matched with ${name}. Open Do~Re to say yes or no.`,
          url: `/match/${encodeURIComponent(event.matchId)}`,
          tag: `match-${event.matchId}`,
        };
      case 'MATCH_COMPLETED':
        return {
          title: `${name} said yes!`,
          body: 'You can chat now. Say hi.',
          url: `/chats/${encodeURIComponent(event.chatId)}`,
          tag: `chat-${event.chatId}`,
        };
      case 'MESSAGE':
        return {
          title: name,
          body: event.preview,
          url: `/chats/${encodeURIComponent(event.chatId)}`,
          tag: `chat-${event.chatId}`,
        };
    }
  }
}
