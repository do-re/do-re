import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { AppError } from '../errors';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends email. An interface so tests record messages and another provider can replace SES (OPEN-7). */
export interface EmailSender {
  /**
   * Requires: message.to is a well-formed email address.
   * Effects: one email with this subject and text is handed to the mail service.
   * @throws AppError 502 EMAIL_SEND_FAILED if the mail service refuses or cannot be reached
   */
  send(message: EmailMessage): Promise<void>;
}

/** The part of SESv2Client this class uses. */
export interface SesClient {
  send(command: SendEmailCommand): Promise<unknown>;
}

/**
 * EmailSender on Amazon SES.
 * While the SES account is in sandbox mode it delivers only to verified addresses (OPEN-7).
 */
export class SesEmailSender implements EmailSender {
  /**
   * @param client an SES v2 client for the region the sender identity is verified in
   * @param from   the verified From address
   * @param log    where failures are reported; receives the error's name only, never the
   *               address or the message (which can contain the address)
   */
  constructor(
    private readonly client: SesClient,
    private readonly from: string,
    private readonly log: (line: string) => void = console.error,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const command = new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: { Simple: { Subject: { Data: message.subject }, Body: { Text: { Data: message.text } } } },
    });
    try {
      await this.client.send(command);
    } catch (error) {
      this.log(`SES send failed: ${(error as Error).name}`);
      throw new AppError(
        502,
        'EMAIL_SEND_FAILED',
        'We could not send the confirmation email. Log in with this email and password to send it again.',
      );
    }
  }
}
