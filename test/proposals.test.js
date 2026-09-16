import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sanitizeProposals, applyProposal, describeProposal } from '../src/proposals.js';

const program = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'program.json'), 'utf8'));
const settings = { targets: { kcal: 2600, proteinG: 140 } };

test('sanitize drops invalid or unknown-target proposals and caps at 3', () => {
  const raw = [
    { kind: 'targets', kcal: 2700, proteinG: null, reason: 'weight flat' },
    { kind: 'set_weight', exerciseId: 'nope', weight: 50, reason: 'x' },
    { kind: 'move_day', dayKey: 'H', weekday: 9, reason: 'x' },
    { kind: 'targets', kcal: null, proteinG: null, reason: 'empty' },
    { kind: 'add_day', key: 'R2', weekday: 3, cloneOf: 'R', title: 'Second run', reason: 'x' },
    { kind: 'set_weight', exerciseId: 'squat', weight: 55, reason: 'deload' },
  ];
  const ok = sanitizeProposals(raw, program);
  assert.deepEqual(ok.map((p) => p.kind), ['targets']); // only first 3 considered, two of them invalid
  assert.deepEqual(sanitizeProposals(raw.slice(4), program).map((p) => p.kind), ['add_day', 'set_weight']);
});

test('apply targets and set_weight', () => {
  const t = applyProposal({ kind: 'targets', kcal: 2700, proteinG: null, reason: '' }, program, settings);
  assert.deepEqual(t.settings.targets, { kcal: 2700, proteinG: 140 });
  assert.equal(t.program, null);
  const w = applyProposal({ kind: 'set_weight', exerciseId: 'squat', weight: 55, reason: '' }, program, settings);
  assert.deepEqual(w.exerciseWeights, { squat: 55 });
});

test('apply swap, move, remove and add day', () => {
  const rep = { id: 'hip_thrust', name: 'Hip thrust', sets: 3, repMin: 8, repMax: 12, weight: null, increment: 5, restSec: 90, cue: 'Chin tucked, squeeze at the top.' };
  const s = applyProposal({ kind: 'swap_exercise', dayKey: 'A', exerciseId: 'rdl', replacement: rep, reason: '' }, program, settings);
  assert.equal(s.program.days[0].exercises.find((e) => e.id === 'hip_thrust').name, 'Hip thrust');
  assert.equal(s.program.days[0].exercises.some((e) => e.id === 'rdl'), false);
  assert.equal(program.days[0].exercises.some((e) => e.id === 'rdl'), true, 'input not mutated');

  const m = applyProposal({ kind: 'move_day', dayKey: 'H', weekday: 2, reason: '' }, program, settings);
  assert.equal(m.program.days.find((d) => d.key === 'H').weekday, 2);
  const r = applyProposal({ kind: 'move_day', dayKey: 'H', weekday: null, reason: '' }, program, settings);
  assert.equal(r.program.days.some((d) => d.key === 'H'), false);

  const a = applyProposal({ kind: 'add_day', key: 'R2', weekday: 3, cloneOf: 'R', title: 'Second run', reason: '' }, program, settings);
  const added = a.program.days.find((d) => d.key === 'R2');
  assert.equal(added.type, 'run');
  assert.equal(a.program.days.some((d) => d.key === 'H'), false, 'the day that occupied Wednesday is replaced');
  assert.match(describeProposal({ kind: 'add_day', key: 'R2', weekday: 3, cloneOf: 'R', title: 'Second run', reason: '' }, program), /Wednesday/);
});
