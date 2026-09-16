// Structured coach proposals: validated when the review comes in, applied only when the user taps Apply.
import { z } from 'zod';

const Exercise = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().min(2).max(60),
  sets: z.number().int().min(1).max(8),
  repMin: z.number().int().min(1).max(600),
  repMax: z.number().int().min(1).max(600),
  weight: z.number().min(0).max(1000).nullable(),
  increment: z.number().min(0).max(50),
  restSec: z.number().int().min(15).max(600),
  cue: z.string().max(200),
});

export const Proposal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('targets'), reason: z.string().max(300), kcal: z.number().min(800).max(8000).nullable(), proteinG: z.number().min(20).max(400).nullable() }),
  z.object({ kind: z.literal('set_weight'), reason: z.string().max(300), exerciseId: z.string(), weight: z.number().min(0).max(1000) }),
  z.object({ kind: z.literal('swap_exercise'), reason: z.string().max(300), dayKey: z.string(), exerciseId: z.string(), replacement: Exercise }),
  z.object({ kind: z.literal('move_day'), reason: z.string().max(300), dayKey: z.string(), weekday: z.number().int().min(1).max(7).nullable() }),
  z.object({ kind: z.literal('add_day'), reason: z.string().max(300), key: z.string().regex(/^[A-Z][A-Z0-9]?$/), weekday: z.number().int().min(1).max(7), cloneOf: z.string(), title: z.string().min(2).max(60) }),
]);

export const PROPOSAL_GUIDE = `You may add up to 3 "proposals" when the evidence clearly supports a change; otherwise leave the
list empty. Each proposal is one of:
- {"kind":"targets","kcal":2700|null,"proteinG":150|null,"reason":...} — change daily nutrition targets.
- {"kind":"set_weight","exerciseId":"squat","weight":55,"reason":...} — override one exercise's target weight (deload, or the athlete found a working weight).
- {"kind":"swap_exercise","dayKey":"A","exerciseId":"rdl","replacement":{id,name,sets,repMin,repMax,weight,increment,restSec,cue},"reason":...} — replace an exercise on a day.
- {"kind":"move_day","dayKey":"H","weekday":3|null,"reason":...} — move a day to another weekday (1=Monday..7=Sunday) or remove it with null.
- {"kind":"add_day","key":"R2","weekday":3,"cloneOf":"R","title":"Second easy run","reason":...} — add a day that copies an existing day's exercises.
The athlete approves each proposal by hand, so be specific and give a one-sentence reason.`;

const findDay = (program, key) => (program.travel?.key === key ? program.travel : program.days.find((d) => d.key === key));

/** Validate raw proposals from the model; invalid ones are dropped, not fatal. */
export function sanitizeProposals(raw, program) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 3) : []) {
    const r = Proposal.safeParse(item);
    if (!r.success) continue;
    const p = r.data;
    if (p.kind === 'set_weight' && !program.days.concat(program.travel ?? []).some((d) => d.exercises.some((e) => e.id === p.exerciseId))) continue;
    if (p.kind === 'swap_exercise' && !findDay(program, p.dayKey)?.exercises.some((e) => e.id === p.exerciseId)) continue;
    if (p.kind === 'move_day' && !program.days.some((d) => d.key === p.dayKey)) continue;
    if (p.kind === 'add_day' && (!findDay(program, p.cloneOf) || program.days.some((d) => d.key === p.key))) continue;
    if (p.kind === 'targets' && p.kcal == null && p.proteinG == null) continue;
    out.push(p);
  }
  return out;
}

/** Human sentence for a proposal. */
export function describeProposal(p, program) {
  const ex = (id) => program.days.concat(program.travel ?? []).flatMap((d) => d.exercises).find((e) => e.id === id)?.name ?? id;
  const day = (k) => findDay(program, k)?.title ?? k;
  const wd = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  switch (p.kind) {
    case 'targets': return `Set targets to ${p.kcal != null ? `${p.kcal} kcal` : 'same calories'} and ${p.proteinG != null ? `${p.proteinG} g protein` : 'same protein'}.`;
    case 'set_weight': return `Set ${ex(p.exerciseId)} to ${p.weight} kg.`;
    case 'swap_exercise': return `On ${day(p.dayKey)}, replace ${ex(p.exerciseId)} with ${p.replacement.name} (${p.replacement.sets}×${p.replacement.repMin}–${p.replacement.repMax}).`;
    case 'move_day': return p.weekday == null ? `Remove ${day(p.dayKey)} from the week.` : `Move ${day(p.dayKey)} to ${wd[p.weekday]}.`;
    case 'add_day': return `Add "${p.title}" on ${wd[p.weekday]}, a copy of ${day(p.cloneOf)}.`;
    default: return 'Unknown proposal';
  }
}

/**
 * Apply a proposal. Returns { program, settings, exerciseWeights } with the new program (or null when unchanged),
 * changed settings keys, and exercise weight overrides. Pure: does not touch the repo.
 */
export function applyProposal(p, program, settings) {
  const result = { program: null, settings: {}, exerciseWeights: {} };
  const clone = () => JSON.parse(JSON.stringify(program));
  switch (p.kind) {
    case 'targets': {
      const t = { ...(settings.targets ?? {}) };
      if (p.kcal != null) t.kcal = p.kcal;
      if (p.proteinG != null) t.proteinG = p.proteinG;
      result.settings.targets = t;
      break;
    }
    case 'set_weight':
      result.exerciseWeights[p.exerciseId] = p.weight;
      break;
    case 'swap_exercise': {
      const next = clone();
      const day = findDay(next, p.dayKey);
      const i = day.exercises.findIndex((e) => e.id === p.exerciseId);
      day.exercises[i] = { ...p.replacement };
      result.program = next;
      break;
    }
    case 'move_day': {
      const next = clone();
      if (p.weekday == null) next.days = next.days.filter((d) => d.key !== p.dayKey);
      else {
        next.days = next.days.filter((d) => d.weekday !== p.weekday || d.key === p.dayKey);
        findDay(next, p.dayKey).weekday = p.weekday;
      }
      result.program = next;
      break;
    }
    case 'add_day': {
      const next = clone();
      const src = findDay(next, p.cloneOf);
      next.days = next.days.filter((d) => d.weekday !== p.weekday);
      next.days.push({ ...JSON.parse(JSON.stringify(src)), key: p.key, weekday: p.weekday, title: p.title });
      next.days.sort((a, b) => a.weekday - b.weekday);
      result.program = next;
      break;
    }
    default:
      throw new Error(`unknown proposal kind ${p.kind}`);
  }
  return result;
}
