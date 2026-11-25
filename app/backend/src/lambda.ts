/**
 * Lambda entry points: the composition root. This is the only file that reads environment
 * variables or creates AWS clients; everything else receives its dependencies (services.ts).
 *
 * Environment (set by template.yaml; no secrets):
 *   TABLE_NAME      the DynamoDB table
 *   EMAIL_FROM      the SES-verified sender address
 *   APP_BASE_URL    origin of the web app, used in confirmation links and picture URLs
 *   PICTURE_BUCKET  the S3 bucket for profile pictures
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import songsCsv from '../data/songs.csv';
import { SesEmailSender } from './account/EmailSender';
import { S3PictureStore } from './account/PictureStore';
import { systemRandom } from './deps';
import { createApi, type HttpRequest, type HttpResponse } from './http/api';
import { lambdaHandler } from './http/lambdaAdapter';
import { buildServices } from './services';
import { parseSongLibrary, SongLibrary } from './song/SongLibrary';
import { DynamoTable } from './store/DynamoTable';

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`environment variable ${name} is not set`);
  }
  return value;
}

let api: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;

/** Built once per Lambda instance (cold start); holds no per-user state. */
function getApi(): (request: HttpRequest) => Promise<HttpResponse> {
  const appBaseUrl = env('APP_BASE_URL').replace(/\/+$/, '');
  api ??= createApi(
    buildServices({
      table: new DynamoTable(
        DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
        env('TABLE_NAME'),
      ),
      email: new SesEmailSender(new SESv2Client({}), env('EMAIL_FROM')),
      pictures: new S3PictureStore(new S3Client({}), env('PICTURE_BUCKET'), appBaseUrl),
      library: new SongLibrary(parseSongLibrary(songsCsv)),
      clock: Date.now,
      random: systemRandom,
      appBaseUrl,
    }),
  );
  return api;
}

export const account = lambdaHandler('account', getApi);
export const song = lambdaHandler('song', getApi);
export const match = lambdaHandler('match', getApi);
export const chat = lambdaHandler('chat', getApi);
