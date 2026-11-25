import { describe, expect, it } from 'vitest';
import { AccountController, isWellFormedEmail } from '../src/account/AccountController';
import { AccountModel, normalizeEmail, sniffImageType } from '../src/account/AccountModel';
import { SesEmailSender } from '../src/account/EmailSender';
import { S3PictureStore } from '../src/account/PictureStore';
import { PasswordHasher } from '../src/account/PasswordHasher';
import { SessionModel } from '../src/account/SessionModel';
import { AppError } from '../src/errors';
import { HOUR, linkIn, makeWorld, statusOf } from './helpers';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(16);

  // spec: verify accepts exactly the password the record was made from
  it('verifies the right password and rejects others', async () => {
    const record = await hasher.hash('hunter2!');
    expect(await hasher.verify('hunter2!', record)).toBe(true);
    expect(await hasher.verify('hunter2', record)).toBe(false);
    expect(await hasher.verify('', record)).toBe(false);
  });

  // spec: a new random salt per record; only salt, hash and cost are kept
  it('salts every record differently and never keeps the password', async () => {
    const [a, b] = [await hasher.hash('same'), await hasher.hash('same')];
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain('same');
    expect(Object.keys(a).sort()).toEqual(['cost', 'hash', 'salt']);
  });

  // spec: verify works for a record made at any cost; malformed records are rejected
  it('verifies records made at another cost and rejects a truncated hash', async () => {
    const record = await new PasswordHasher(32).hash('pw');
    expect(await hasher.verify('pw', record)).toBe(true);
    expect(await hasher.verify('pw', { ...record, hash: record.hash.slice(0, 8) })).toBe(false);
    await expect(hasher.verify('pw', { ...record, cost: 3 })).rejects.toThrow(); // not a power of two
  });

  it('uses the production cost by default', async () => {
    const record = await new PasswordHasher().hash('pw');
    expect(record.cost).toBe(PasswordHasher.DEFAULT_COST);
    expect(await new PasswordHasher().verify('pw', record)).toBe(true);
  });
});

describe('account helpers', () => {
  it('normalizeEmail trims and lower-cases', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  // spec: partitions of sniffImageType
  it('sniffImageType recognises PNG, JPEG, GIF and WebP by their contents', () => {
    const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(ascii('GIF89a....'))).toBe('image/gif');
    expect(sniffImageType(ascii('GIF87a....'))).toBe('image/gif');
    expect(sniffImageType(ascii('RIFF1234WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(ascii('RIFF1234WAVEfmt '))).toBeUndefined();
    expect(sniffImageType(ascii('GIF'))).toBeUndefined();
    expect(sniffImageType(ascii('<svg onload=""/>'))).toBeUndefined();
    expect(sniffImageType(new Uint8Array())).toBeUndefined();
  });

  // spec: partitions of isWellFormedEmail
  it.each([
    ['ada@example.com', true],
    [' ada@example.com ', true],
    ['ada', false],
    ['ada@example', false],
    ['@example.com', false],
    ['ada@@example.com', false],
    ['a da@example.com', false],
    ['', false],
    [`${'a'.repeat(250)}@b.co`, false],
  ])('isWellFormedEmail(%j) is %s', (email, expected) => {
    expect(isWellFormedEmail(email)).toBe(expected);
  });
});

describe('AccountModel', () => {
  it('R_ACC_09_createAccountStoresABlankInactiveAccount', async () => {
    const { services } = makeWorld();
    const model = services.accountModel;
    expect(await model.isEmailInUse('ada@example.com')).toBe(false);
    const userId = (await model.createAccount(' Ada@Example.com', 'pw'))!;
    expect(await model.isEmailInUse('ada@example.com')).toBe(true);
    expect(await model.isEmailInUse('ADA@example.com ')).toBe(true);
    expect(await model.isActive(userId)).toBe(false);
    expect(await model.getUserId('ada@example.com')).toBe(userId);
    expect(await model.getProfile(userId)).toEqual({ userId, username: '', profilePictureUrl: null });
  });

  // spec: createAccount changes nothing and returns undefined if the email is in use
  it('refuses a second account for an email, and empty credentials', async () => {
    const { services } = makeWorld();
    const model = services.accountModel;
    const first = await model.createAccount('ada@example.com', 'pw');
    expect(await model.createAccount('ADA@example.com', 'other')).toBeUndefined();
    expect(await model.isValidLogin('ada@example.com', 'pw')).toBe(true);
    expect(await model.getUserId('ada@example.com')).toBe(first);
    expect(await statusOf(model.createAccount('', 'pw'))).toBe(400);
    expect(await statusOf(model.createAccount('ada2@example.com', ''))).toBe(400);
  });

  // proof 1 (testing.md): emails and user IDs are unique, even under concurrent sign-ups
  it('concurrency_createAccountLetsExactlyOneOfManyConcurrentSignupsWin', async () => {
    const { services } = makeWorld();
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => services.accountModel.createAccount('race@example.com', `pw${i}`)),
    );
    const winners = ids.filter((id) => id !== undefined);
    expect(winners).toHaveLength(1);
    expect(await services.accountModel.getUserId('race@example.com')).toBe(winners[0]);
  });

  it('R_ACC_04_isValidLoginComparesAgainstTheStoredAccount', async () => {
    const { services } = makeWorld();
    await services.accountModel.createAccount('ada@example.com', 'right');
    expect(await services.accountModel.isValidLogin('Ada@example.com', 'right')).toBe(true);
    expect(await services.accountModel.isValidLogin('ada@example.com', 'wrong')).toBe(false);
    expect(await services.accountModel.isValidLogin('nobody@example.com', 'right')).toBe(false);
  });

  // inspection item 6 (testing.md): only hashes and salts are stored
  it('security_neverStoresThePassword', async () => {
    const { services, table } = makeWorld();
    const userId = (await services.accountModel.createAccount('ada@example.com', 'PlainSecret123'))!;
    const stored = JSON.stringify([
      await table.query(`USER#${userId}`),
      await table.query('EMAIL#ada@example.com'),
    ]);
    expect(stored).toContain('ada@example.com');
    expect(stored).not.toContain('PlainSecret123');
  });

  // spec: activateAccount makes isActive true and is idempotent
  it('activates accounts', async () => {
    const { services } = makeWorld();
    const model = services.accountModel;
    const userId = (await model.createAccount('ada@example.com', 'pw'))!;
    await model.activateAccount(userId);
    await model.activateAccount(userId);
    expect(await model.isActive(userId)).toBe(true);
  });

  // spec: setUsername replaces the username; rejects empty and too long (boundaries 1, 30, 31)
  it('sets usernames within the length bounds', async () => {
    const { services } = makeWorld();
    const model = services.accountModel;
    const userId = (await model.createAccount('ada@example.com', 'pw'))!;
    await model.setUsername(userId, '  Ada  ');
    expect((await model.getProfile(userId)).username).toBe('Ada');
    await model.setUsername(userId, 'x');
    await model.setUsername(userId, 'y'.repeat(30));
    expect((await model.getProfile(userId)).username).toBe('y'.repeat(30));
    expect(await statusOf(model.setUsername(userId, 'y'.repeat(31)))).toBe(400);
    expect(await statusOf(model.setUsername(userId, '   '))).toBe(400);
    expect(await model.isValidLogin('ada@example.com', 'pw')).toBe(true); // other fields kept
  });

  // spec: setProfilePicture saves the image and the profile carries its URL; size boundary;
  // 413 when too large, 400 when not an image
  it('stores profile pictures and returns their URL', async () => {
    const { services, pictures } = makeWorld();
    const model = services.accountModel;
    const userId = (await model.createAccount('ada@example.com', 'pw'))!;
    await model.setProfilePicture(userId, PNG);
    const first = (await model.getProfile(userId)).profilePictureUrl!;
    expect(first).toContain(userId);
    expect(pictures.saved.get(first)).toEqual({ bytes: PNG, type: 'image/png' });
    await model.setProfilePicture(userId, JPEG);
    const second = (await model.getProfile(userId)).profilePictureUrl!;
    expect(second).not.toBe(first); // a new name each time, so caches never show the old one
    expect(pictures.saved.get(second)!.type).toBe('image/jpeg');
    expect(await model.isValidLogin('ada@example.com', 'pw')).toBe(true); // other fields kept

    const sized = (bytes: number) => {
      const big = new Uint8Array(bytes);
      big.set(JPEG);
      return big;
    };
    await model.setProfilePicture(userId, sized(AccountModel.MAX_PICTURE_BYTES));
    expect(await statusOf(model.setProfilePicture(userId, sized(AccountModel.MAX_PICTURE_BYTES + 1)))).toBe(413);
    expect((await model.getProfile(userId)).profilePictureUrl).not.toBe(second);
    expect(await statusOf(model.setProfilePicture(userId, Uint8Array.from([1, 2, 3])))).toBe(400);
    expect(await statusOf(model.setProfilePicture(userId, new Uint8Array()))).toBe(400);
  });

  // spec: every method that requires an existing account throws 404 without one
  it('answers 404 for accounts that do not exist', async () => {
    const model = makeWorld().services.accountModel;
    expect(await statusOf(model.activateAccount('nobody'))).toBe(404);
    expect(await statusOf(model.isActive('nobody'))).toBe(404);
    expect(await statusOf(model.getUserId('nobody@example.com'))).toBe(404);
    expect(await statusOf(model.setUsername('nobody', 'Name'))).toBe(404);
    expect(await statusOf(model.setProfilePicture('nobody', PNG))).toBe(404);
    expect(await statusOf(model.getProfile('nobody'))).toBe(404);
  });
});

describe('AccountController', () => {
  it('R_ACC_08_createAccountChecksTheEmailAndThatThePasswordsMatch', async () => {
    const { services, email } = makeWorld();
    const accounts = services.accounts;
    expect(await accounts.createAccount('not-an-email', 'pw', 'pw')).toBe('INVALID_EMAIL');
    expect(await accounts.createAccount('not-an-email', 'pw', 'different')).toBe('INVALID_EMAIL'); // checked first
    expect(await accounts.createAccount('ada@example.com', 'pw', 'pW')).toBe('PASSWORDS_DO_NOT_MATCH');
    expect(await accounts.createAccount('ada@example.com', '', '')).toBe('PASSWORDS_DO_NOT_MATCH');
    expect(await accounts.isEmailInUse('ada@example.com')).toBe(false); // nothing changed
    expect(email.sent).toHaveLength(0);
  });

  it('R_ACC_02_R_SEC_01_createAccountMakesAnInactiveAccountAndEmailsALink', async () => {
    const { services, email } = makeWorld();
    const accounts = services.accounts;
    expect(await accounts.createAccount('Ada@Example.com', 'pw', 'pw')).toBe('PENDING_VERIFICATION');
    expect(await accounts.isEmailInUse('ada@example.com')).toBe(true);
    expect(await accounts.isVerified('ada@example.com')).toBe(false);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ada@example.com');
    expect(email.sent[0]!.text).toContain('https://app.example/verify?userId=');
    expect(linkIn(email.sent[0]!).userId).toBe(await accounts.getUserId('ada@example.com'));
    expect(await accounts.createAccount('ada@example.com', 'pw2', 'pw2')).toBe('EMAIL_IN_USE');
    expect(email.sent).toHaveLength(1);
  });

  it('R_SEC_02_confirmEmailActivatesTheAccountOnceWithTheRightToken', async () => {
    const { services, email, table } = makeWorld();
    const accounts = services.accounts;
    await accounts.createAccount('ada@example.com', 'pw', 'pw');
    const { userId, token } = linkIn(email.sent[0]!);
    expect(JSON.stringify(await table.query(`USER#${userId}`))).not.toContain(token); // stored hashed
    expect(await accounts.confirmEmail(userId, 'wrong-token')).toBe(false);
    expect(await accounts.confirmEmail('someone-else', token)).toBe(false);
    expect(await accounts.isVerified('ada@example.com')).toBe(false);
    expect(await accounts.confirmEmail(userId, token)).toBe(true);
    expect(await accounts.isVerified('ada@example.com')).toBe(true);
    expect(await accounts.confirmEmail(userId, token)).toBe(false); // consumed
  });

  // boundary: a link is valid for less than VERIFY_TTL_MS
  it('R_SEC_02_confirmationLinksExpireAfter24Hours', async () => {
    const world = makeWorld();
    const accounts = world.services.accounts;
    await accounts.createAccount('late@example.com', 'pw', 'pw');
    await accounts.createAccount('intime@example.com', 'pw', 'pw');
    world.clock.advance(AccountController.VERIFY_TTL_MS - 1);
    const inTime = linkIn(world.email.sent[1]!);
    expect(await accounts.confirmEmail(inTime.userId, inTime.token)).toBe(true);
    world.clock.advance(1);
    const late = linkIn(world.email.sent[0]!);
    expect(await accounts.confirmEmail(late.userId, late.token)).toBe(false);
    expect(await accounts.isVerified('late@example.com')).toBe(false);
  });

  it('R_ACC_04_R_SEC_03_loginDistinguishesEveryCase', async () => {
    const { services, email } = makeWorld();
    const accounts = services.accounts;
    await accounts.createAccount('ada@example.com', 'right', 'right');
    expect(await accounts.login('nobody@example.com', 'right')).toBe('NO_ACCOUNT');
    expect(await accounts.login('ada@example.com', 'wrong')).toBe('WRONG_PASSWORD');
    expect(await accounts.login('ada@example.com', 'right')).toBe('NOT_VERIFIED');
    const { userId, token } = linkIn(email.sent[0]!);
    await accounts.confirmEmail(userId, token);
    expect(await accounts.login('ADA@example.com', 'right')).toBe('SUCCESS');
    expect(await accounts.login('ada@example.com', 'wrong')).toBe('WRONG_PASSWORD');
    expect(email.sent).toHaveLength(1); // a verified login sends nothing
  });

  // spec: NOT_VERIFIED re-sends the link unless one was sent in the last RESEND_COOLDOWN_MS (boundary)
  it('R_SEC_03_anUnverifiedLoginResendsTheLinkAfterTheCooldown', async () => {
    const world = makeWorld();
    const accounts = world.services.accounts;
    await accounts.createAccount('ada@example.com', 'pw', 'pw');
    world.clock.advance(AccountController.RESEND_COOLDOWN_MS - 1);
    expect(await accounts.login('ada@example.com', 'pw')).toBe('NOT_VERIFIED');
    expect(world.email.sent).toHaveLength(1);
    world.clock.advance(1);
    expect(await accounts.login('ada@example.com', 'pw')).toBe('NOT_VERIFIED');
    expect(world.email.sent).toHaveLength(2);
    expect(await accounts.login('ada@example.com', 'wrong')).toBe('WRONG_PASSWORD'); // no email for a wrong password
    expect(world.email.sent).toHaveLength(2);
    const [oldLink, newLink] = world.email.sent.map(linkIn) as [ReturnType<typeof linkIn>, ReturnType<typeof linkIn>];
    expect(await accounts.confirmEmail(oldLink.userId, oldLink.token)).toBe(false); // replaced
    expect(await accounts.confirmEmail(newLink.userId, newLink.token)).toBe(true);
  });

  // spec: an unverified account with no pending token (email never sent) gets one on login
  it('R_SEC_03_anUnverifiedLoginSendsALinkWhenNoneIsPending', async () => {
    const world = makeWorld();
    world.email.failing = true;
    expect(await statusOf(world.services.accounts.createAccount('ada@example.com', 'pw', 'pw'))).toBe(502);
    expect(await world.services.accounts.isEmailInUse('ada@example.com')).toBe(true);
    world.email.failing = false;
    const userId = await world.services.accounts.getUserId('ada@example.com');
    await world.table.write([{ op: 'delete', key: { pk: `USER#${userId}`, sk: 'VERIFY' }, expect: 'any' }]);
    expect(await world.services.accounts.login('ada@example.com', 'pw')).toBe('NOT_VERIFIED');
    expect(world.email.sent).toHaveLength(1);
  });

  // spec: the remaining methods delegate to AccountModel
  it('updates and returns profiles through AccountModel', async () => {
    const { services } = makeWorld();
    const accounts = services.accounts;
    await accounts.createAccount('ada@example.com', 'pw', 'pw');
    const userId = await accounts.getUserId('ada@example.com');
    await accounts.updateUsername(userId, 'Ada');
    await accounts.updateProfilePicture(userId, PNG);
    const profile = await accounts.getProfile(userId);
    expect(profile.username).toBe('Ada');
    expect(profile.profilePictureUrl).toMatch(/^https:\/\/pictures\.example\//);
  });
});

describe('SessionModel', () => {
  // spec: authenticate returns the user of a live session only; expiry boundary at TTL_MS
  it('issues tokens that authenticate until they expire or are ended', async () => {
    const { services, clock, table } = makeWorld();
    const sessions = services.sessions;
    const token = await sessions.createSession('u-1');
    const other = await sessions.createSession('u-2');
    expect(token).not.toBe(other);
    expect(await sessions.authenticate(token)).toBe('u-1');
    expect(await sessions.authenticate('made-up')).toBeUndefined();
    clock.advance(SessionModel.TTL_MS - 1);
    expect(await sessions.authenticate(token)).toBe('u-1');
    clock.advance(1);
    expect(await sessions.authenticate(token)).toBeUndefined();

    const fresh = await sessions.createSession('u-1');
    await sessions.endSession(fresh);
    expect(await sessions.authenticate(fresh)).toBeUndefined();
    await sessions.endSession(fresh); // ending twice is harmless
    expect(await table.get({ pk: `SESSION#${token}`, sk: 'SESSION' })).toBeUndefined(); // not stored as issued
  });
});

describe('SesEmailSender', () => {
  const message = { to: 'ada@example.com', subject: 'Hello', text: 'Body' };

  // spec: one email with this subject and text is handed to SES
  it('sends the message through SES from the configured address', async () => {
    const commands: { input: unknown }[] = [];
    const sender = new SesEmailSender({ send: async (command) => void commands.push(command) }, 'noreply@dore.example');
    await sender.send(message);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.input).toEqual({
      FromEmailAddress: 'noreply@dore.example',
      Destination: { ToAddresses: ['ada@example.com'] },
      Content: { Simple: { Subject: { Data: 'Hello' }, Body: { Text: { Data: 'Body' } } } },
    });
  });

  // spec: failures become AppError 502, and the log never contains the address
  it('security_turnsSesFailuresInto502WithoutLoggingTheAddress', async () => {
    const lines: string[] = [];
    const failing = {
      send: async () => {
        throw Object.assign(new Error('Email address is not verified: ada@example.com'), { name: 'MessageRejected' });
      },
    };
    const sender = new SesEmailSender(failing, 'noreply@dore.example', (line) => lines.push(line));
    const error = await sender.send(message).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(502);
    expect(lines).toEqual(['SES send failed: MessageRejected']);
    expect(`${lines}${(error as AppError).message}`).not.toContain('ada@example.com');
  });

  it('logs to the console by default', async () => {
    const original = console.error;
    const lines: unknown[] = [];
    console.error = (line: unknown) => void lines.push(line);
    try {
      const sender = new SesEmailSender({ send: async () => Promise.reject(new Error('x')) }, 'noreply@dore.example');
      await sender.send(message).catch(() => undefined);
    } finally {
      console.error = original;
    }
    expect(lines).toEqual(['SES send failed: Error']);
  });
});

describe('S3PictureStore', () => {
  // spec: stores the image under pictures/ with its type and returns its public URL
  it('puts the picture in the bucket and returns the CloudFront URL', async () => {
    const commands: { input: Record<string, unknown> }[] = [];
    const store = new S3PictureStore({ send: async (command) => void commands.push(command as never) }, 'bucket-1', 'https://app.example');
    const url = await store.save('u-1-abc', PNG, 'image/png');
    expect(url).toBe('https://app.example/pictures/u-1-abc.png');
    expect(commands).toHaveLength(1);
    expect(commands[0]!.input).toMatchObject({ Bucket: 'bucket-1', Key: 'pictures/u-1-abc.png', ContentType: 'image/png', Body: PNG });
    expect(await store.save('k', JPEG, 'image/jpeg')).toBe('https://app.example/pictures/k.jpg');
    expect(await store.save('k', JPEG, 'image/gif')).toMatch(/\.gif$/);
    expect(await store.save('k', JPEG, 'image/webp')).toMatch(/\.webp$/);
  });
});

it('HOUR helper is an hour', () => {
  expect(HOUR).toBe(3_600_000);
});
