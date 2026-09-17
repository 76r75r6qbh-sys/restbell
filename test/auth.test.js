import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuth } from '../src/auth.js';
import { makeAnnouncer } from '../src/ha.js';

test('auth is disabled without a password', () => {
  const auth = makeAuth({ password: '' });
  assert.equal(auth.enabled, false);
  assert.equal(auth.verify(undefined), true);
});

test('auth issues a cookie for the right password only', () => {
  const auth = makeAuth({ password: 'hunter2', secret: 's' });
  assert.equal(auth.cookieFor('wrong'), null);
  const c = auth.cookieFor('hunter2');
  assert.ok(c);
  assert.equal(auth.verify(`foo=1; trainer_auth=${c}`), true);
  assert.equal(auth.verify('trainer_auth=deadbeef'), false);
  assert.equal(auth.verify(''), false);
});

test('login locks a client out after too many wrong passwords, per client', () => {
  let t = 0;
  const auth = makeAuth({ password: 'hunter2', secret: 's', maxFailures: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) assert.equal(auth.login('nope', 'a').ok, false);
  const locked = auth.login('hunter2', 'a');
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true, 'even the right password is refused while locked');
  assert.ok(locked.retryAfterSec > 0);
  assert.equal(auth.login('hunter2', 'b').ok, true, 'another client is unaffected');
  t = 1001;
  const again = auth.login('hunter2', 'a');
  assert.equal(again.ok, true, 'the lock expires after the window');
  assert.ok(again.cookie);
});

test('cookie is marked Secure only when served over https', () => {
  const auth = makeAuth({ password: 'p', secret: 's' });
  assert.doesNotMatch(auth.setCookieHeader('x'), /Secure/);
  assert.match(auth.setCookieHeader('x', { secure: true }), /; Secure/);
});

test('announcer reports unconfigured and posts tts.speak when configured', async () => {
  assert.equal(makeAnnouncer({}).configured, false);
  assert.deepEqual(await makeAnnouncer({}).announce('hi'), { configured: false });
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization }); return { ok: true, status: 200 }; };
  const a = makeAnnouncer({ url: 'http://ha:8123/', token: 't', ttsEntity: 'tts.google', mediaPlayer: 'media_player.woonkamer', fetchImpl });
  await a.announce('Rest over');
  assert.equal(calls[0].url, 'http://ha:8123/api/services/tts/speak');
  assert.equal(calls[0].body.message, 'Rest over');
  assert.equal(calls[0].auth, 'Bearer t');
});
