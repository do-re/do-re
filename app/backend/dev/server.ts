/**
 * Local development server: the real backend code (the same createApi the Lambdas run) on
 * http://localhost:8787, so the frontend can run against it without AWS.
 *
 *   backend/   npm run dev
 *   frontend/  set VITE_API_BASE_URL=http://localhost:8787/api in .env.local, then npm run dev
 *
 * What is replaced, and only here:
 *   DynamoDB -> MemoryTable (same conditional-write semantics; data is lost when this stops)
 *   SES      -> the confirmation link is printed in this terminal instead of emailed
 *   S3       -> pictures are kept in memory and served from /pictures/
 *   SNS      -> match and chat events are delivered in-process; pushes are really sent,
 *               signed with a key pair made at startup (subscriptions end when this stops)
 * It starts with an admin account, two blank demo accounts and six sample users with different music tastes
 * (dev/sampleUsers.ts), printed at startup with their Taste Vectors and compatibilities.
 * DEV ONLY. It prints confirmation links and has fixed demo passwords; never deploy it.
 * It is not part of the Lambda bundle (src/lambda.ts) or of the coverage gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { EmailMessage, EmailSender } from '../src/account/EmailSender';
import { PICTURE_TYPES, type PictureStore, type PictureType } from '../src/account/PictureStore';
import { systemRandom } from '../src/deps';
import { createApi } from '../src/http/api';
import * as webPush from 'web-push';
import { type Notifier, WebPushSender } from '../src/notify/Notifier';
import { InProcessPublisher } from '../src/notify/publishers';
import { buildNotifier, buildServices } from '../src/services';
import { ReccoBeatsSource } from '../src/song/MusicSource';
import { parseSongLibrary, SongLibrary } from '../src/song/SongLibrary';
import { MemoryTable } from '../src/store/MemoryTable';
import { describeSampleUsers, seedSampleUsers } from './sampleUsers';

const PORT = Number(process.env.PORT ?? 8787);
/** Where the frontend runs: confirmation links point here and CORS allows it. */
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const SELF = `http://localhost:${PORT}`;

/** Prints each email instead of sending it, so a developer can open the confirmation link. */
const consoleEmail: EmailSender = {
  async send(message: EmailMessage) {
    const link = /https?:\/\/\S+/.exec(message.text)?.[0];
    console.log(`\n[email to ${message.to}] ${message.subject}\n  ${link}\n`);
  },
};

const pictureFiles = new Map<string, { bytes: Uint8Array; type: PictureType }>();
const memoryPictures: PictureStore = {
  async save(key, bytes, type) {
    const path = `/pictures/${key}.${PICTURE_TYPES[type]}`;
    pictureFiles.set(path, { bytes: Uint8Array.from(bytes), type });
    return `${SELF}${path}`;
  },
};

function loadLibrary(): SongLibrary {
  const real = join(process.cwd(), 'data', 'songs.csv');
  const file = existsSync(real) ? real : join(process.cwd(), 'data', 'songs.sample.csv');
  if (file !== real) {
    console.log('data/songs.csv not found: using the 6 placeholder songs in songs.sample.csv (they will not play).');
  }
  return new SongLibrary(parseSongLibrary(readFileSync(file, 'utf8')));
}

// Push notifications: a key pair for this run, and events delivered in-process (in
// production they go through an SNS topic to the notifier Lambda). Real pushes are sent to
// the browsers' push services, so they work on localhost with an internet connection.
const vapidKeys = webPush.generateVAPIDKeys();
let notifier: Notifier | undefined;

const services = buildServices({
  publisher: new InProcessPublisher(() => notifier!),
  vapidPublicKey: vapidKeys.publicKey,
  // The root admin of the dev server (seeded below). Set ADMIN_EMAILS to use other accounts.
  adminEmails: (process.env.ADMIN_EMAILS ?? 'admin@do-re.test').split(','),
  table: new MemoryTable(),
  email: consoleEmail,
  pictures: memoryPictures,
  library: loadLibrary(),
  // Pulls real songs while you swipe, as in production. LIVE_MUSIC=off uses the library only.
  musicSource: process.env.LIVE_MUSIC === 'off' ? undefined : new ReccoBeatsSource(),
  clock: Date.now,
  random: systemRandom,
  appBaseUrl: APP_ORIGIN,
  passwordCost: 1 << 10, // fast hashing for development
});
notifier = buildNotifier(services, new WebPushSender(webPush, { subject: 'mailto:dev@do-re.test', ...vapidKeys }));
const api = createApi(services);

/** Two verified accounts, so matching and chat can be tried with two browser windows at once. */
async function seedDemoAccounts(): Promise<void> {
  for (const name of ['demo1', 'demo2']) {
    const userId = (await services.accountModel.createAccount(`${name}@do-re.test`, 'demo-pass-1'))!;
    await services.accountModel.activateAccount(userId);
    await services.accountModel.setUsername(userId, name);
  }
  const adminId = (await services.accountModel.createAccount('admin@do-re.test', 'demo-pass-1'))!;
  await services.accountModel.activateAccount(adminId);
  await services.accountModel.setUsername(adminId, 'admin');
  console.log('Demo accounts (already verified): demo1@do-re.test and demo2@do-re.test, password demo-pass-1');
  console.log('Admin account: admin@do-re.test, password demo-pass-1 (open /admin after logging in)');
  // Users with different tastes to be matched with (dev/sampleUsers.ts).
  const samples = await seedSampleUsers(services, Date.now);
  console.log(describeSampleUsers(samples));
  // Two sample reports, so the admin panel's Reports tab has something to show.
  const idOf = (name: string) => samples.find((user) => user.name === name)!.userId;
  await services.reportModel.file({ reporterId: idOf('rhythm'), reportedId: idOf('tempo'), source: 'MATCH', reason: 'FAKE_ACCOUNT', details: 'Profile picture is a stock photo.', contextId: 'sample' });
  await services.reportModel.file({ reporterId: idOf('melody'), reportedId: idOf('tempo'), source: 'CHAT', reason: 'REPORTED_IN_CHAT', contextId: 'sample' });
}

const CORS = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '600',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', SELF);
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS).end();
        return;
      }
      const picture = pictureFiles.get(url.pathname);
      if (req.method === 'GET' && picture !== undefined) {
        res.writeHead(200, { 'content-type': picture.type }).end(picture.bytes);
        return;
      }
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        headers[name] = Array.isArray(value) ? value.join(', ') : value;
      }
      const response = await api({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers,
        body: chunks.length === 0 ? undefined : Uint8Array.from(Buffer.concat(chunks)),
      });
      console.log(`${response.status} ${req.method} ${url.pathname}`);
      res.writeHead(response.status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(response.body === undefined ? undefined : JSON.stringify(response.body));
    })();
  });
});

void seedDemoAccounts().then(() => {
  // Loopback only: this server has published demo passwords and must not be reachable from
  // other machines on the network.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Do~Re dev backend on ${SELF}/api (frontend expected at ${APP_ORIGIN}). Data is in memory.`);
  });
});
