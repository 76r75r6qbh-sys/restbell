import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PROPOSAL_GUIDE } from './proposals.js';
import { metricsBlock, energyBalance } from './metrics.js';

export const MODEL = 'claude-opus-5';

export class CoachError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const FoodEstimate = z.object({
  items: z.array(z.object({ name: z.string(), kcal: z.number(), proteinG: z.number() })),
  kcal: z.number(),
  proteinG: z.number(),
  note: z.string(),
});

// Proposals are loosely typed here (the model may return any JSON); src/proposals.js validates each one strictly.
export const Review = z.object({
  summary: z.string(),
  wins: z.array(z.string()),
  flags: z.array(z.string()),
  nextWeek: z.array(z.string()),
  nutrition: z.string(),
  proposals: z.array(z.record(z.string(), z.unknown())),
});

export const ChatReply = z.object({ text: z.string() });

export const FOOD_SYSTEM = `You estimate calories and protein for meals described in plain words, in any language.
Use typical portion sizes for the athlete's region when none are given. Return one item per food, whole numbers,
and a short note only when you had to assume a portion. Be realistic rather than precise.`;

export function buildFoodPrompt(text, athlete = '') {
  return athlete ? `Athlete: ${athlete.trim()}\nMeal: ${text.trim()}` : `Meal: ${text.trim()}`;
}

export const REVIEW_SYSTEM = `You are the strength and conditioning coach of one athlete. Weight progression is
decided by the app's rules, not by you; you comment on trends, effort, adherence, recovery and nutrition.
Write in second person, plain and specific, no cheerleading. Flags are things to watch or fix. Next week:
2 to 4 concrete instructions. Keep the summary under 120 words.

${PROPOSAL_GUIDE}`;

export function fmtSession(s) {
  const head = `${s.date} ${s.dayKey} (${s.type}) feel ${s.feel ?? '-'}/5${s.notes ? ` — "${s.notes}"` : ''}`;
  if (s.type === 'run') return `${head}: ${s.distanceKm ?? '?'} km in ${s.durationMin ?? '?'} min`;
  const byEx = new Map();
  for (const st of s.sets) {
    if (!byEx.has(st.exerciseName)) byEx.set(st.exerciseName, []);
    byEx.get(st.exerciseName).push(`${st.reps}×${st.weight}`);
  }
  const lines = [...byEx].map(([name, sets]) => `  - ${name}: ${sets.join(', ')}`);
  return [head, ...lines].join('\n');
}

const pace = (min, km) => {
  if (!min || !km) return null;
  const secPerKm = Math.round((min * 60) / km);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')}/km`;
};

/** One line per Apple Watch workout, with running dynamics and splits when the app sent them. */
export function fmtWorkout(w) {
  const z = w.analysis?.minutesPerZone;
  const d = w.details ?? {};
  const parts = [`${w.durationMin ?? '?'} min`];
  if (w.distanceKm) parts.push(`${w.distanceKm} km`, pace(w.durationMin, w.distanceKm));
  parts.push(`avg HR ${w.avgHr ?? '?'}, max ${w.maxHr ?? '?'}, intensity ${w.analysis?.intensity ?? '?'}`);
  if (w.effort != null) parts.push(`effort ${w.effort}/10`);
  if (w.hrRecovery != null) parts.push(`HR recovery ${w.hrRecovery} bpm/min`);
  if (w.elevationM) parts.push(`+${Math.round(w.elevationM)} m`);
  if (d.cadenceSpm) parts.push(`cadence ${Math.round(d.cadenceSpm)} spm`);
  if (d.powerW) parts.push(`power ${Math.round(d.powerW)} W`);
  if (d.strideM) parts.push(`stride ${d.strideM} m`);
  if (d.groundContactMs) parts.push(`GCT ${Math.round(d.groundContactMs)} ms`);
  if (d.verticalOscillationCm) parts.push(`VO ${d.verticalOscillationCm} cm`);
  let line = `  - ${w.date} ${w.type}: ${parts.filter(Boolean).join(', ')}${z ? ` (zones Z1–Z5 min: ${z.join('/')})` : ''}`;
  if (Array.isArray(d.splits) && d.splits.length) line += `\n    splits: ${d.splits.slice(0, 50).map((sp) => pace(sp.sec / 60, sp.km ?? 1) ?? '?').join(' ')}`;
  return line;
}

export function buildReviewPrompt(week, program, settings, previousNote = null, today = null) {
  const targets = settings.targets ?? {};
  const lines = [];
  if (settings.athlete) lines.push(`Athlete: ${settings.athlete.trim()}`);
  lines.push(`Week ${week.fromDate} to ${week.toDate}.`);
  if (today) {
    lines.push(`Today is ${today}.${today < week.toDate ? ' The week is not over: sessions planned after today have not happened yet and must not be counted as skipped.' : ''}`);
  }
  lines.push(`Program: ${program.name}. Planned: ${program.days.map((d) => `${d.key}=${d.title}`).join('; ')}.`);
  lines.push(`Targets: ${targets.kcal ?? '?'} kcal, ${targets.proteinG ?? '?'} g protein per day.`);
  if (settings.holiday) lines.push(`Holiday: ${settings.holiday.from} to ${settings.holiday.to}.`);
  lines.push('');
  lines.push(`Sessions (${week.sessions.length}):`);
  for (const s of week.sessions) lines.push(fmtSession(s));
  if (week.sessions.length === 0) lines.push('  none logged');
  lines.push('');
  const workouts = week.workouts ?? [];
  if (workouts.length) {
    lines.push('', `Apple Watch workouts (${workouts.length}):`);
    for (const w of workouts) lines.push(fmtWorkout(w));
  }
  const metrics = metricsBlock(week.metrics, week.previousMetrics);
  if (metrics) lines.push('', metrics);
  const balance = week.metrics ? energyBalance(week.metrics, week.foodDays) : null;
  if (balance?.avgBalance != null) lines.push(`Energy balance (food minus active + resting energy) on ${balance.days.length} days: ${balance.avgBalance > 0 ? '+' : ''}${balance.avgBalance} kcal/day on average`);
  if (week.recovery) lines.push(week.recovery);
  if (week.healthSyncStale) lines.push(week.healthSyncStale);
  lines.push('');
  lines.push(`Weigh-ins: ${week.checkins.length ? week.checkins.map((c) => `${c.date} ${c.weightKg} kg`).join(', ') : 'none'}`);
  lines.push(`Food days logged: ${week.foodDays.length ? week.foodDays.map((f) => `${f.date} ${Math.round(f.kcal)} kcal / ${Math.round(f.proteinG)} g`).join(', ') : 'none'}`);
  if (previousNote) lines.push('', `Last week's note: ${previousNote}`);
  lines.push('', 'Review this week and set up next week.');
  return lines.join('\n');
}

async function parseOrThrow(client, params, schema) {
  const response = await client.messages.parse({ ...params, output_config: { ...params.output_config, format: zodOutputFormat(schema) } });
  if (response.stop_reason === 'refusal') throw new CoachError('refused', 'The model declined this request');
  if (!response.parsed_output) throw new CoachError('unparseable', 'The model returned no structured output');
  return response.parsed_output;
}

/**
 * Coach functions backed by an Anthropic client. Pass client = null when no API key is configured.
 */
export function makeCoach({ client }) {
  const unavailable = () => Promise.reject(new CoachError('unavailable', 'ANTHROPIC_API_KEY is not configured'));
  return {
    enabled: !!client,
    backend: client ? 'sdk' : 'none',
    estimateFood(text, athlete = '') {
      if (!client) return unavailable();
      return parseOrThrow(
        client,
        {
          model: MODEL,
          max_tokens: 2000,
          system: FOOD_SYSTEM,
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: buildFoodPrompt(text, athlete) }],
        },
        FoodEstimate,
      );
    },
    weeklyReview(week, program, settings, previousNote = null, today = null) {
      if (!client) return unavailable();
      return parseOrThrow(
        client,
        {
          model: MODEL,
          max_tokens: 4000,
          system: REVIEW_SYSTEM,
          output_config: { effort: 'high' },
          messages: [{ role: 'user', content: buildReviewPrompt(week, program, settings, previousNote, today) }],
        },
        Review,
      );
    },
    async chat(history, context = '') {
      if (!client) return unavailable();
      const { turns, lead } = toChatTurns(history);
      if (!turns.length) throw new CoachError('empty', 'Nothing to reply to');
      const system = [CHAT_SYSTEM, context && `Current data:\n${context}`, lead.length && `Your earlier messages:\n${lead.join('\n\n')}`].filter(Boolean).join('\n\n');
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system,
        output_config: { effort: 'low' },
        messages: turns,
      });
      if (response.stop_reason === 'refusal') throw new CoachError('refused', 'The model declined this request');
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      if (!text) throw new CoachError('unparseable', 'The model returned no text');
      return { text };
    },
  };
}

export const CHAT_SYSTEM = `You are the strength and conditioning coach of one athlete, chatting in a messaging app.
Answer like a good coach texting back: short (usually 1 to 4 sentences, a few bullets at most), specific to the
data below, in the language the athlete writes in. Weight progression is decided by the app's rules: you can
explain or suggest, but say that program changes come as proposals in the weekly review. When the Watch data
says recovery is low, factor that in. If you don't know, say so; never invent numbers that aren't in the data.`;

/** Plain-text snapshot of the athlete's current state for the chat. */
export function buildChatContext({ settings = {}, program, today, day, openSession, week, latestNote, proposals = [], recovery, healthSyncStale } = {}) {
  const lines = [];
  if (settings.athlete) lines.push(`Athlete: ${settings.athlete.trim()}`);
  if (today) lines.push(`Today is ${today}.`);
  if (program) lines.push(`Program: ${program.name}. Days: ${program.days.map((d) => `${d.key}=${d.title} (weekday ${d.weekday})`).join('; ')}.`);
  if (day) lines.push(`Planned today: ${day.title}${day.exercises?.length ? ` — ${day.exercises.map((e) => `${e.name} ${e.sets}×${e.repMin}${e.repMax !== e.repMin ? `–${e.repMax}` : ''}${e.weight ? ` @ ${e.weight} kg` : ''}`).join(', ')}` : ''}.`);
  else if (today) lines.push('Today is a rest day.');
  if (openSession) lines.push(`A session is in progress with ${openSession.sets?.length ?? 0} sets logged.`);
  const targets = settings.targets ?? {};
  lines.push(`Targets: ${targets.kcal ?? '?'} kcal, ${targets.proteinG ?? '?'} g protein per day.`);
  if (settings.holiday) lines.push(`Holiday: ${settings.holiday.from} to ${settings.holiday.to}.`);
  if (week) {
    lines.push('', `This week (${week.fromDate} to ${week.toDate}):`);
    for (const s of week.sessions) lines.push(fmtSession(s));
    if (!week.sessions.length) lines.push('  no sessions finished yet');
    for (const w of week.workouts ?? []) lines.push(fmtWorkout(w));
    lines.push(`Weigh-ins: ${week.checkins.length ? week.checkins.map((c) => `${c.date} ${c.weightKg} kg`).join(', ') : 'none'}`);
    lines.push(`Food: ${week.foodDays.length ? week.foodDays.map((f) => `${f.date} ${Math.round(f.kcal)} kcal / ${Math.round(f.proteinG)} g`).join(', ') : 'none'}`);
    const metrics = metricsBlock(week.metrics, week.previousMetrics);
    if (metrics) lines.push(metrics);
  }
  if (recovery) lines.push(recovery);
  if (healthSyncStale) lines.push(healthSyncStale);
  if (latestNote) lines.push('', `Latest weekly note (week of ${latestNote.weekStart}): ${latestNote.text}`);
  if (proposals.length) lines.push('', `Open proposals: ${proposals.map((p) => p.text).join('; ')}`);
  return lines.join('\n');
}

/**
 * Chat history (oldest first, { role: 'user'|'coach', text }) → Messages API turns.
 * The API needs the first turn to be the user's, so leading coach messages (a review, a debrief) are folded into the context.
 */
export function toChatTurns(history) {
  const turns = history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  const lead = [];
  while (turns.length && turns[0].role === 'assistant') lead.push(turns.shift().content);
  return { turns, lead };
}

/** Transcript form for the CLI backend, which takes one prompt. */
export function chatTranscript(history) {
  return [
    'Conversation so far (oldest first):',
    ...history.map((m) => `${m.role === 'user' ? 'Athlete' : 'Coach'}: ${m.text}`),
    '',
    "Write the coach's reply to the athlete's last message. Return it as text.",
  ].join('\n');
}

/** Render a structured review as the markdown-ish text stored in coach_notes. */
export function reviewToText(r) {
  const bullets = (arr) => arr.map((x) => `- ${x}`).join('\n');
  return [
    r.summary,
    r.wins.length ? `\nWins\n${bullets(r.wins)}` : '',
    r.flags.length ? `\nWatch\n${bullets(r.flags)}` : '',
    r.nextWeek.length ? `\nNext week\n${bullets(r.nextWeek)}` : '',
    r.nutrition ? `\nNutrition\n${r.nutrition}` : '',
  ].filter(Boolean).join('\n');
}
