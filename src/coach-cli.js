// Coach backend that shells out to the Claude Code CLI (`claude -p`), so a Claude subscription
// token (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`) can be used instead of an API key.
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { CoachError, FoodEstimate, Review, FOOD_SYSTEM, REVIEW_SYSTEM, buildFoodPrompt, buildReviewPrompt } from './coach.js';

function run(bin, prefixArgs, args, { timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // stdin is closed on purpose: `claude -p` otherwise waits for piped input.
      child = spawn(bin, [...prefixArgs, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new CoachError('cli', `claude failed: ${e.message}`));
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new CoachError('cli', `claude failed: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) return reject(new CoachError('cli', `claude failed (exit ${code}): ${stderr.trim() || 'no output'}`));
      resolve(stdout);
    });
  });
}

/** JSON Schema for the CLI: zod's draft reference is dropped because the CLI validator cannot resolve it. */
export function cliSchema(schema) {
  const { $schema, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/**
 * makeCliCoach({ bin, prefixArgs, models, env, timeoutMs }) → same interface as makeCoach.
 * Uses --json-schema so the CLI returns a validated object in `structured_output`.
 */
export function makeCliCoach({ bin = 'claude', prefixArgs = [], models = {}, env = process.env, timeoutMs = 180_000 } = {}) {
  async function ask(schema, system, prompt, model) {
    const args = [
      '-p', '--no-session-persistence', '--output-format', 'json',
      '--json-schema', JSON.stringify(cliSchema(schema)),
      '--tools', '', '--system-prompt', system,
    ];
    if (model) args.push('--model', model);
    args.push(prompt);
    const out = await run(bin, prefixArgs, args, { timeoutMs, env });
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new CoachError('unparseable', 'claude returned no JSON');
    }
    if (parsed.is_error) throw new CoachError('cli', String(parsed.result ?? 'claude reported an error'));
    const data = parsed.structured_output ?? (() => { try { return JSON.parse(parsed.result); } catch { return null; } })();
    const check = schema.safeParse(data);
    if (!check.success) throw new CoachError('unparseable', 'claude returned an unexpected shape');
    return check.data;
  }
  return {
    enabled: true,
    backend: 'cli',
    estimateFood: (text, athlete = '') => ask(FoodEstimate, FOOD_SYSTEM, buildFoodPrompt(text, athlete), models.food ?? 'sonnet'),
    weeklyReview: (week, program, settings, previousNote = null) =>
      ask(Review, REVIEW_SYSTEM, buildReviewPrompt(week, program, settings, previousNote), models.review ?? 'opus'),
  };
}
