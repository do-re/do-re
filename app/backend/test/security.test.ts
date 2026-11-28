/**
 * Regression tests for the security audit of 2026-11-27 (docs/project/security.md). Each test
 * names the hole it keeps closed.
 */
import { describe, expect, it } from 'vitest';
import { AccountController } from '../src/account/AccountController';
import { PasswordHasher } from '../src/account/PasswordHasher';
import { MIN_PASSWORD_LENGTH } from '../src/http/api';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { isPushEndpoint } from '../src/notify/PushSubscriptionModel';
import { ReccoBeatsSource } from '../src/song/MusicSource';
import { linkIn, makeWorld, statusOf } from './helpers';

const MINUTE = 60_000;

describe('password guessing', () => {
  // boundary: the 10th failure within the window locks; the 9th does not
  it('security_locksAnEmailAfterTenFailedLoginsAndUnlocksAfterFifteenMinutes', async () => {
    const world = makeWorld();
    await world.join('ada@example.com');
    const accounts = world.services.accounts;
    for (let i = 1; i < AccountController.MAX_FAILED_LOGINS; i++) {
      expect(await accounts.login('ada@example.com', `guess-${i}`)).toBe('WRONG_PASSWORD');
    }
    expect(await accounts.login('ADA@example.com ', 'guess-10')).toBe('WRONG_PASSWORD'); // the 10th, same address
    // locked: even the right password is refused, without being checked
    expect(await statusOf(accounts.login('ada@example.com', 'correct horse'))).toBe(429);
    const refused = await accounts.login('ada@example.com', 'correct horse').catch((e) => e);
    expect(refused).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many failed attempts. Try again in 15 minutes.' });

    world.clock.advance(AccountController.LOGIN_LOCK_MS - 1);
    expect((await accounts.login('ada@example.com', 'correct horse').catch((e) => e)).message).toContain('in 1 minute.');
    world.clock.advance(1);
    expect(await accounts.login('ada@example.com', 'correct horse')).toBe('SUCCESS');
  });

  it('security_aCorrectLoginOrAQuietWindowResetsTheCount', async () => {
    const world = makeWorld();
    await world.join('ada@example.com');
    const accounts = world.services.accounts;
    const fail = async (times: number) => {
      for (let i = 0; i < times; i++) await accounts.login('ada@example.com', 'wrong');
    };
    await fail(9);
    expect(await accounts.login('ada@example.com', 'correct horse')).toBe('SUCCESS'); // clears the count
    await fail(9);
    expect(await accounts.login('ada@example.com', 'correct horse')).toBe('SUCCESS'); // 9 again, not 18
    await fail(9);
    world.clock.advance(AccountController.LOGIN_WINDOW_MS); // the old failures have aged out
    await fail(9);
    expect(await accounts.login('ada@example.com', 'correct horse')).toBe('SUCCESS');
    // after a lock ends, it takes a full run of failures to lock again
    await fail(10);
    world.clock.advance(AccountController.LOGIN_LOCK_MS);
    await fail(9);
    expect(await accounts.login('ada@example.com', 'correct horse')).toBe('SUCCESS');
  });

  // the lock must not reveal which emails have accounts
  it('security_anUnknownEmailIsLockedInTheSameWay', async () => {
    const world = makeWorld();
    const accounts = world.services.accounts;
    for (let i = 0; i < AccountController.MAX_FAILED_LOGINS; i++) {
      expect(await accounts.login('nobody@example.com', 'x')).toBe('NO_ACCOUNT');
    }
    expect(await statusOf(accounts.login('nobody@example.com', 'x'))).toBe(429);
    expect(await accounts.login('someone-else@example.com', 'x')).toBe('NO_ACCOUNT'); // per address
  });

  it('security_concurrentFailuresAreAllCounted', async () => {
    const world = makeWorld();
    await world.join('ada@example.com');
    await Promise.all(Array.from({ length: AccountController.MAX_FAILED_LOGINS }, () => world.services.accounts.login('ada@example.com', 'wrong')));
    expect(await statusOf(world.services.accounts.login('ada@example.com', 'correct horse'))).toBe(429);
  });

  it('security_theLockReachesTheClientAs429', async () => {
    const world = makeWorld();
    const body = { email: 'ada@example.com', password: 'wrong-guess' };
    for (let i = 0; i < AccountController.MAX_FAILED_LOGINS; i++) {
      await world.call('POST', '/api/auth/login', { body });
    }
    const response = await world.call('POST', '/api/auth/login', { body });
    expect(response.status).toBe(429);
    expect((response.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});

describe('finding out which emails have accounts', () => {
  it('security_loginAnswersAnUnknownEmailLikeAWrongPassword', async () => {
    const world = makeWorld();
    await world.join('ada@example.com');
    const login = async (email: string) => (await world.call('POST', '/api/auth/login', { body: { email, password: 'wrong-guess' } })).body;
    expect(await login('nobody@example.com')).toEqual(await login('ada@example.com'));
    expect(await login('nobody@example.com')).toEqual({ result: 'WRONG_PASSWORD' });
  });

  // timing: an unknown email must cost a password hash too
  it('security_anUnknownEmailStillCostsAPasswordHash', async () => {
    let verifications = 0;
    class CountingHasher extends PasswordHasher {
      override async verify(...args: Parameters<PasswordHasher['verify']>) {
        verifications++;
        return super.verify(...args);
      }
    }
    const world = makeWorld();
    const { AccountModel } = await import('../src/account/AccountModel');
    const model = new AccountModel(world.table, new CountingHasher(16), world.random, world.pictures, world.clock.read);
    await model.createAccount('ada@example.com', 'right-password');
    expect(await model.isValidLogin('nobody@example.com', 'right-password')).toBe(false);
    expect(verifications).toBe(1);
    expect(await model.isValidLogin('ada@example.com', 'wrong')).toBe(false);
    expect(await model.isValidLogin('nobody@example.com', 'decoy')).toBe(false); // not even the decoy's own password
    expect(verifications).toBe(3);
  });
});

describe('signing up with an address you do not own', () => {
  async function squatted() {
    const world = makeWorld();
    const accounts = world.services.accounts;
    // an attacker signs up with the victim's address and a password the attacker knows
    expect(await accounts.createAccount('victim@example.com', 'attacker-pw', 'attacker-pw')).toBe('PENDING_VERIFICATION');
    return { world, accounts, attackersLink: linkIn(world.email.sent[0]!) };
  }

  it('security_theRealOwnerCanStillSignUpAndTheAttackersPasswordAndLinkStopWorking', async () => {
    const { world, accounts, attackersLink } = await squatted();
    world.clock.advance(AccountController.RESEND_COOLDOWN_MS);
    expect(await accounts.createAccount('victim@example.com', 'owners-password', 'owners-password')).toBe('PENDING_VERIFICATION');
    expect(world.email.sent).toHaveLength(2);
    expect(await accounts.confirmEmail(attackersLink.userId, attackersLink.token)).toBe(false); // old link is dead
    const ownersLink = linkIn(world.email.sent[1]!);
    expect(ownersLink.userId).toBe(attackersLink.userId); // the same account, now the owner's
    expect(await accounts.confirmEmail(ownersLink.userId, ownersLink.token)).toBe(true);
    expect(await accounts.login('victim@example.com', 'attacker-pw')).toBe('WRONG_PASSWORD');
    expect(await accounts.login('victim@example.com', 'owners-password')).toBe('SUCCESS');
  });

  // boundary: no takeover within RESEND_COOLDOWN_MS of the last email, so a real sign-up can be
  // confirmed and the address cannot be flooded
  it('security_anUnverifiedAccountCannotBeReplacedWithinAMinuteOfItsEmail', async () => {
    const { world, accounts } = await squatted();
    world.clock.advance(AccountController.RESEND_COOLDOWN_MS - 1);
    expect(await accounts.createAccount('victim@example.com', 'second-password', 'second-password')).toBe('EMAIL_IN_USE');
    expect(world.email.sent).toHaveLength(1);
    expect(await world.services.accountModel.isValidLogin('victim@example.com', 'attacker-pw')).toBe(true); // unchanged
  });

  it('security_aVerifiedOrSuspendedAccountIsNeverReplaced', async () => {
    const world = makeWorld();
    const accounts = world.services.accounts;
    const ada = await world.join('ada@example.com');
    world.clock.advance(10 * MINUTE);
    expect(await accounts.createAccount('ada@example.com', 'new-password', 'new-password')).toBe('EMAIL_IN_USE');
    expect(await accounts.login('ada@example.com', 'correct horse')).toBe('SUCCESS');

    await accounts.createAccount('bob@example.com', 'bobs-password', 'bobs-password');
    const bob = await accounts.getUserId('bob@example.com');
    await world.services.accountModel.suspend(bob, { at: 1, by: ada.userId, reason: 'spam' });
    world.clock.advance(10 * MINUTE);
    expect(await accounts.createAccount('bob@example.com', 'new-password', 'new-password')).toBe('EMAIL_IN_USE');
    expect(await world.services.accountModel.isValidLogin('bob@example.com', 'bobs-password')).toBe(true);
    expect(await statusOf(world.services.accountModel.replaceUnverifiedPassword('nobody', 'x'))).toBe(404);
  });
});

describe('weak and misleading account data', () => {
  // boundary: 7 characters refused, 8 accepted
  it('security_newPasswordsNeedAtLeastEightCharacters', async () => {
    const world = makeWorld();
    const signup = (password: string) => world.call('POST', '/api/accounts', { body: { email: 'ada@example.com', password, confirmPassword: password } });
    const short = await signup('x'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(short.status).toBe(400);
    expect((short.body as { error: { message: string } }).error.message).toContain('at least 8 characters');
    expect(await world.services.accounts.isEmailInUse('ada@example.com')).toBe(false);
    expect((await signup('x'.repeat(MIN_PASSWORD_LENGTH))).body).toEqual({ result: 'PENDING_VERIFICATION' });
  });

  it('security_usernamesCannotHideInvisibleOrControlCharacters', async () => {
    const world = makeWorld();
    const { userId } = await world.join('ada@example.com');
    const model = world.services.accountModel;
    for (const name of ['adm​in', 'ad‮min', 'tab\there', 'bell\u0007', 'null\u0000']) {
      expect(await statusOf(model.setUsername(userId, name))).toBe(400);
    }
    await model.setUsername(userId, 'Zoë 音楽 🎵'); // letters of any script and emoji are fine
    expect((await model.getProfile(userId)).username).toBe('Zoë 音楽 🎵');
  });
});

describe('seeing other people', () => {
  it('security_aProfileIsVisibleOnlyToItsOwnerAndTheirMatches', async () => {
    const world = makeWorld();
    const amy = await world.join('amy@example.com');
    const bob = await world.join('bob@example.com');
    const eve = await world.join('eve@example.com');
    const taste = new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.5));
    await world.services.matchModel.updateUser(amy.userId, taste, world.clock.now);
    await world.services.matchModel.updateUser(bob.userId, taste, world.clock.now);
    await world.services.matchModel.findMatch(amy.userId, world.clock.now);

    const get = (token: string, id: string) => world.call('GET', `/api/users/${id}`, { token });
    expect((await get(amy.token, amy.userId)).status).toBe(200);
    expect((await get(amy.token, bob.userId)).status).toBe(200); // matched
    expect((await get(bob.token, amy.userId)).status).toBe(200);
    const stranger = await get(eve.token, amy.userId);
    expect(stranger.status).toBe(404); // the same answer as for an account that does not exist
    expect(stranger.body).toEqual((await get(eve.token, 'no-such-user')).body);
  });
});

describe('requests the server makes to addresses it is given', () => {
  it('security_pushEndpointsOnUserProgrammableGoogleHostsAreRefused', () => {
    expect(isPushEndpoint('https://jmt17.google.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://jmt4.google.com/fcm/send/abc')).toBe(true);
    for (const host of ['script.google.com', 'sites.google.com', 'www.google.com', 'jmt17.google.com.evil.example', 'xjmt17.google.com']) {
      expect(isPushEndpoint(`https://${host}/x`)).toBe(false);
    }
  });

  it('security_onlyHttpsCoverImagesAreAccepted', async () => {
    const candidate = { id: 'b'.repeat(22), title: 'T', artist: 'A', durationSeconds: 100, spotifyUri: `spotify:track:${'b'.repeat(22)}`, features: (await import('./helpers')).song('x').features };
    const sourceReturning = (thumbnail_url: string) =>
      new ReccoBeatsSource((async () => new Response(JSON.stringify({ title: 'T', thumbnail_url }), { status: 200 })) as unknown as typeof fetch, 1000);
    for (const url of ['http://insecure.example/c.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//no-scheme.example/c.jpg']) {
      expect(await sourceReturning(url).complete([candidate])).toEqual([]);
    }
    expect(await sourceReturning('https://image-cdn.example/c.jpg').complete([candidate])).toHaveLength(1);
  });
});

describe('malformed requests', () => {
  it('security_aBrokenPercentEscapeInThePathIs404NotAServerError', async () => {
    const world = makeWorld();
    const { token } = await world.join('ada@example.com');
    const lines: string[] = [];
    const { createApi } = await import('../src/http/api');
    const api = createApi(world.services, (line) => lines.push(line));
    const response = await api({ method: 'GET', path: '/api/users/%E0%A4%A', query: {}, headers: { authorization: `Bearer ${token}` }, body: undefined });
    expect(response.status).toBe(404);
    expect(lines).toEqual([]);
  });
});
