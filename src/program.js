import { readFileSync } from 'node:fs';
import { nextState } from './progression.js';

/** Make sure an active program exists; seed from seedPath when the table is empty. */
export function ensureProgram(repo, seedPath) {
  const active = repo.activeProgram();
  if (active) return active;
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  return repo.saveProgram(seed);
}

/** Find a program day (including the travel day) by key. */
export function dayByKey(program, key) {
  if (program.travel && program.travel.key === key) return program.travel;
  return program.days.find((d) => d.key === key) ?? null;
}

/** Exercises of a day with the current target weight merged in from exercise_state. */
export function targetsFor(repo, day) {
  if (!day) return [];
  const state = repo.allExerciseState();
  return day.exercises.map((ex) => {
    const s = state[ex.id];
    const last = repo.lastSetsFor ? repo.lastSetsFor(ex.id) : null;
    return { ...ex, weight: s && s.weight != null ? s.weight : ex.weight, lastSets: last };
  });
}

/** Apply progression rules to a finished session. Returns the list of changes. */
export function applyProgression(repo, program, sessionId) {
  const session = repo.session(sessionId);
  if (!session) return [];
  const day = dayByKey(program, session.dayKey);
  if (!day) return [];
  const changes = [];
  for (const ex of day.exercises) {
    if (!ex.increment) continue; // bodyweight or fixed-load exercises don't auto-progress
    const sets = session.sets.filter((s) => s.exerciseId === ex.id);
    if (sets.length === 0) continue;
    const state = repo.exerciseState(ex.id) ?? { weight: ex.weight ?? null, belowMinStreak: 0 };
    const next = nextState(ex, state, sets);
    repo.setExerciseState(ex.id, next.weight, next.belowMinStreak);
    changes.push({ exerciseId: ex.id, name: ex.name, change: next.change, from: state.weight, weight: next.weight });
  }
  return changes;
}
