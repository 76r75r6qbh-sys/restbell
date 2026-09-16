import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCoach } from '../src/server.js';

test('an oauth token in the api key slot selects the cli backend', async () => {
  const coach = await pickCoach({ ANTHROPIC_API_KEY: 'sk-ant-oat01-xyz' });
  assert.equal(coach.backend, 'cli');
});

test('a real api key selects the sdk backend and nothing selects none', async () => {
  assert.equal((await pickCoach({ ANTHROPIC_API_KEY: 'sk-ant-api03-xyz' })).backend, 'sdk');
  assert.equal((await pickCoach({})).backend, 'none');
  assert.equal((await pickCoach({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-xyz' })).backend, 'cli');
});
