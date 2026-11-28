/**
 * Lambda entry points: the composition root. This is the only file that reads environment
 * variables or creates AWS clients; everything else receives its dependencies (services.ts).
 *
 * Environment (set by template.yaml; no secrets):
 *   TABLE_NAME      the DynamoDB table
 *   EMAIL_FROM      the SES-verified sender address
 *   APP_BASE_URL    origin of the web app, used in confirmation links and picture URLs
 *   PICTURE_BUCKET  the S3 bucket for profile pictures
 *   LIVE_MUSIC      "off" to stop pulling songs from the music platform (default: on)
 *   ADMIN_EMAILS    comma-separated emails of the accounts that are always admins
 *   EVENT_TOPIC_ARN the SNS topic match and chat events are published to (empty: no notifications)
 *   VAPID_PUBLIC_KEY             the app's Web Push public key (empty: notifications not set up)
 *   VAPID_PRIVATE_KEY_PARAMETER  name of the SSM SecureString holding the private key (notifier only)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import * as webPush from 'web-push';
import songsCsv from '../data/songs.csv';
import { SesEmailSender } from './account/EmailSender';
import { S3PictureStore } from './account/PictureStore';
import { systemRandom } from './deps';
import { createApi, type HttpRequest, type HttpResponse } from './http/api';
import { lambdaHandler } from './http/lambdaAdapter';
import type { Notifier } from './notify/Notifier';
import { WebPushSender } from './notify/Notifier';
import { snsHandler, SnsPublisher } from './notify/publishers';
import { buildNotifier, buildServices, type Services } from './services';
import { ReccoBeatsSource } from './song/MusicSource';
import { parseSongLibrary, SongLibrary } from './song/SongLibrary';
import { DynamoTable } from './store/DynamoTable';

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`environment variable ${name} is not set`);
  }
  return value;
}

let services: Services | undefined;
let api: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
let notifierPromise: Promise<Notifier> | undefined;

/** Built once per Lambda instance (cold start); holds no per-user state. */
function getServices(): Services {
  const appBaseUrl = env('APP_BASE_URL').replace(/\/+$/, '');
  const topicArn = process.env.EVENT_TOPIC_ARN ?? '';
  services ??= buildServices({
    table: new DynamoTable(
      DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
      env('TABLE_NAME'),
    ),
    email: new SesEmailSender(new SESv2Client({}), env('EMAIL_FROM')),
    pictures: new S3PictureStore(new S3Client({}), env('PICTURE_BUCKET'), appBaseUrl),
    library: new SongLibrary(parseSongLibrary(songsCsv)),
    // LIVE_MUSIC=off keeps the app on the bundled library only.
    musicSource: process.env.LIVE_MUSIC === 'off' ? undefined : new ReccoBeatsSource(),
    // Match and chat events go to the SNS topic the notifier function listens to.
    publisher: topicArn === '' ? undefined : new SnsPublisher(new SNSClient({}), topicArn),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    adminEmails: (process.env.ADMIN_EMAILS ?? '').split(','),
    clock: Date.now,
    random: systemRandom,
    appBaseUrl,
  });
  return services;
}

function getApi(): (request: HttpRequest) => Promise<HttpResponse> {
  api ??= createApi(getServices());
  return api;
}

/** Reads the VAPID private key from SSM Parameter Store once per instance. */
function getNotifier(): Promise<Notifier> {
  notifierPromise ??= (async () => {
    const parameter = await new SSMClient({}).send(
      new GetParameterCommand({ Name: env('VAPID_PRIVATE_KEY_PARAMETER'), WithDecryption: true }),
    );
    const vapid = {
      subject: `mailto:${env('EMAIL_FROM')}`,
      publicKey: env('VAPID_PUBLIC_KEY'),
      privateKey: parameter.Parameter?.Value ?? '',
    };
    return buildNotifier(getServices(), new WebPushSender(webPush, vapid));
  })();
  // A failed read must not be remembered, or the instance could never recover.
  notifierPromise.catch(() => (notifierPromise = undefined));
  return notifierPromise;
}

export const account = lambdaHandler('account', getApi);
export const song = lambdaHandler('song', getApi);
export const match = lambdaHandler('match', getApi);
export const chat = lambdaHandler('chat', getApi);
/** Subscribed to the event topic: delivers browser push notifications. */
export const notifier = snsHandler(getNotifier);
