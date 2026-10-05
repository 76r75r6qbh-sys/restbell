import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNotifier, preview } from '../src/notify.js';

const recorder = (status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status };
  };
  return { calls, fetchImpl };
};

test('unconfigured notifier does nothing', async () => {
  const n = makeNotifier({});
  assert.equal(n.configured, false);
  assert.deepEqual(n.channels, []);
  assert.equal(await n.send({ title: 't', body: 'b' }), false);
});

test('home assistant: calls the notify service with a deep link', async () => {
  const { calls, fetchImpl } = recorder();
  const n = makeNotifier({ haUrl: 'http://ha:8123/', haToken: 'tok', haService: 'notify.mobile_app_phone', fetchImpl });
  assert.deepEqual(n.channels, ['homeassistant']);
  assert.equal(await n.send({ title: 'Coach', body: 'Nice squats', url: 'restbell://chat', group: 'coach' }), true);
  assert.equal(calls[0].url, 'http://ha:8123/api/services/notify/mobile_app_phone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.title, 'Coach');
  assert.equal(body.message, 'Nice squats');
  assert.equal(body.data.url, 'restbell://chat');
  assert.equal(body.data.group, 'coach');
});

test('ntfy: posts the body with title and click headers, encoding non-ascii titles', async () => {
  const { calls, fetchImpl } = recorder();
  const n = makeNotifier({ ntfyUrl: 'https://ntfy.example/restbell', ntfyToken: 'tk', fetchImpl });
  await n.send({ title: 'Coach — review', body: 'hello', url: 'restbell://chat' });
  assert.equal(calls[0].url, 'https://ntfy.example/restbell');
  assert.equal(calls[0].init.body, 'hello');
  assert.equal(calls[0].init.headers.Click, 'restbell://chat');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tk');
  assert.match(calls[0].init.headers.Title, /^=\?UTF-8\?B\?/);
});

test('a failing channel is logged, not thrown', async () => {
  const errors = [];
  const { fetchImpl } = recorder(500);
  const n = makeNotifier({ ntfyUrl: 'https://ntfy.example/x', fetchImpl, log: { error: (m) => errors.push(m) } });
  assert.equal(await n.send({ title: 't', body: 'b' }), false);
  assert.match(errors[0], /ntfy answered 500/);
});

test('preview collapses whitespace and truncates', () => {
  assert.equal(preview('a\n\n b'), 'a b');
  assert.equal(preview('x'.repeat(300), 10).length, 10);
});
