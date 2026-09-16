import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

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

export const Review = z.object({
  summary: z.string(),
  wins: z.array(z.string()),
  flags: z.array(z.string()),
  nextWeek: z.array(z.string()),
  nutrition: z.string(),
});

export const FOOD_SYSTEM = `You estimate calories and protein for meals described in plain words, in any language.
Use typical portion sizes for the athlete's region when none are given. Return one item per food, whole numbers,
and a short note only when you had to assume a portion. Be realistic rather than precise.`;

export function buildFoodPrompt(text, athlete = '') {
  return athlete ? `Athlete: ${athlete.trim()}\nMeal: ${text.trim()}` : `Meal: ${text.trim()}`;
}

export const REVIEW_SYSTEM = `You are the strength and conditioning coach of one athlete. Weight progression is
decided by the app's rules, not by you; you comment on trends, effort, adherence, recovery and nutrition.
Write in second person, plain and specific, no cheerleading. Flags are things to watch or fix. Next week:
2 to 4 concrete instructions. Keep the summary under 120 words.`;

function fmtSession(s) {
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

export function buildReviewPrompt(week, program, settings, previousNote = null) {
  const targets = settings.targets ?? {};
  const lines = [];
  if (settings.athlete) lines.push(`Athlete: ${settings.athlete.trim()}`);
  lines.push(`Week ${week.fromDate} to ${week.toDate}.`);
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
    for (const w of workouts) {
      const z = w.analysis?.minutesPerZone;
      lines.push(`  - ${w.date} ${w.type}: ${w.durationMin ?? '?'} min${w.distanceKm ? `, ${w.distanceKm} km` : ''}, avg HR ${w.avgHr ?? '?'}, max ${w.maxHr ?? '?'}, intensity ${w.analysis?.intensity ?? '?'}${z ? ` (zones Z1–Z5 min: ${z.join('/')})` : ''}`);
    }
  }
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
    weeklyReview(week, program, settings, previousNote = null) {
      if (!client) return unavailable();
      return parseOrThrow(
        client,
        {
          model: MODEL,
          max_tokens: 4000,
          system: REVIEW_SYSTEM,
          output_config: { effort: 'high' },
          messages: [{ role: 'user', content: buildReviewPrompt(week, program, settings, previousNote) }],
        },
        Review,
      );
    },
  };
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
