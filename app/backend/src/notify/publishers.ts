import { PublishCommand } from '@aws-sdk/client-sns';
import { type EventPublisher, type NotificationEvent, parseEvent } from './events';
import type { Notifier } from './Notifier';

/** The part of SNSClient this module uses. */
export interface SnsLike {
  send(command: PublishCommand): Promise<unknown>;
}

/**
 * EventPublisher on an Amazon SNS topic. The notifier Lambda is subscribed to the topic and
 * turns each event into browser pushes (see snsHandler), so publishing costs the request one
 * short AWS call and nothing more.
 */
export class SnsPublisher implements EventPublisher {
  /**
   * @param client   SNS client for the topic's region
   * @param topicArn the topic
   * @param log      where failures are reported (the error's name only)
   */
  constructor(
    private readonly client: SnsLike,
    private readonly topicArn: string,
    private readonly log: (line: string) => void = console.error,
  ) {}

  async publish(event: NotificationEvent): Promise<void> {
    try {
      await this.client.send(new PublishCommand({ TopicArn: this.topicArn, Message: JSON.stringify(event) }));
    } catch (error) {
      this.log(`Could not publish ${event.type}: ${(error as Error).name}`);
    }
  }
}

/**
 * EventPublisher that delivers in the same process, for the local development server, where
 * there is no SNS topic.
 */
export class InProcessPublisher implements EventPublisher {
  constructor(
    private readonly getNotifier: () => Notifier,
    private readonly log: (line: string) => void = console.error,
  ) {}

  async publish(event: NotificationEvent): Promise<void> {
    try {
      await this.getNotifier().handle(event);
    } catch (error) {
      this.log(`Could not deliver ${event.type}: ${(error as Error).name}`);
    }
  }
}

/**
 * The notifier Lambda's handler: delivers every event in an SNS invocation.
 *
 * Effects: none at construction; getNotifier is called on the first event, so a cold start
 *          builds the notifier (and reads the signing key) once.
 * @param getNotifier returns the Notifier to deliver with
 * @param log         where malformed records are reported
 * @returns the handler. Records that are not valid events are logged and skipped. If
 *          delivering an event throws, the handler rejects, and SNS retries the invocation.
 */
export function snsHandler(
  getNotifier: () => Promise<Notifier> | Notifier,
  log: (line: string) => void = console.error,
): (event: { Records?: readonly { Sns?: { Message?: string } }[] }) => Promise<void> {
  return async (invocation) => {
    for (const record of invocation.Records ?? []) {
      const event = parseEvent(record.Sns?.Message ?? '');
      if (event === undefined) {
        log('Skipped a record that is not a notification event');
        continue;
      }
      await (await getNotifier()).handle(event);
    }
  };
}
