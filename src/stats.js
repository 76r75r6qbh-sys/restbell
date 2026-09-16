// Dashboard statistics for the Today view. Pure: takes data in, returns numbers out.
import { weekStartOf, addDays, weekdayOf, isHoliday } from './schedule.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const round1 = (n) => Math.round(n * 10) / 10;

/** Planned sessions in the week starting weekStart: lift and run days count, optional home days don't. */
export function plannedCount(program, weekStart) {
  return program.days.filter((d) => d.type === 'lift' || d.type === 'run').length + (weekStart ? 0 : 0);
}

function weekIsHoliday(settings, weekStart) {
  // A week counts as holiday when at least 4 of its days fall inside the holiday range.
  let n = 0;
  for (let i = 0; i < 7; i++) if (isHoliday(settings, addDays(weekStart, i))) n += 1;
  return n >= 4;
}

/**
 * @param {object} p
 * @param {string} p.today 'YYYY-MM-DD'
 * @param {object} p.program active program
 * @param {object} p.settings all settings
 * @param {Array} p.sessions finished sessions with sets (any order)
 * @param {Array} p.checkins newest first
 */
export function computeStats({ today, program, settings, sessions, checkins }) {
  const finished = sessions.filter((s) => s.finishedAt);
  const byWeek = new Map();
  for (const s of finished) {
    const w = weekStartOf(s.date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(s);
  }
  const thisWeek = weekStartOf(today);
  const planned = plannedCount(program, thisWeek);
  const weekSessions = (w) => byWeek.get(w) ?? [];
  const doneThisWeek = weekSessions(thisWeek).length;

  // Volume: lifting sessions only, weight × reps.
  const volumeOf = (list) => Math.round(sum(list.filter((s) => s.type !== 'run').flatMap((s) => s.sets.map((st) => st.reps * st.weight))));
  const volume = volumeOf(weekSessions(thisWeek));
  const volumeLast = volumeOf(weekSessions(addDays(thisWeek, -7)));

  // Streak: consecutive complete weeks ending at the last complete week (or this week if already complete).
  const firstDate = finished.length ? finished.map((s) => s.date).sort()[0] : null;
  let streak = 0;
  if (firstDate) {
    let w = doneThisWeek >= planned ? thisWeek : addDays(thisWeek, -7);
    const floor = weekStartOf(firstDate);
    while (w >= floor) {
      if (weekIsHoliday(settings, w)) { w = addDays(w, -7); continue; }
      if (weekSessions(w).length >= planned) { streak += 1; w = addDays(w, -7); } else break;
    }
  }

  // Runs this calendar month.
  const month = today.slice(0, 7);
  const runs = finished.filter((s) => s.type === 'run' && s.date.startsWith(month));
  const runKm = round1(sum(runs.map((s) => s.distanceKm ?? 0)));

  // Bodyweight: latest and change over the last 4 weigh-ins.
  const latest = checkins[0] ?? null;
  const ref = checkins[3] ?? checkins[checkins.length - 1] ?? null;
  const bodyweight = latest ? { kg: latest.weightKg, date: latest.date, delta: ref && ref !== latest ? round1(latest.weightKg - ref.weightKg) : null, over: Math.min(checkins.length, 4) } : null;

  // Bests per exercise (heaviest weight, then most reps); new ones in the last 7 days, else the 3 most recent.
  const best = new Map();
  for (const s of finished) {
    for (const st of s.sets) {
      const cur = best.get(st.exerciseId);
      if (!cur || st.weight > cur.weight || (st.weight === cur.weight && st.reps > cur.reps)) {
        best.set(st.exerciseId, { exerciseId: st.exerciseId, name: st.exerciseName, weight: st.weight, reps: st.reps, date: s.date });
      }
    }
  }
  const allBests = [...best.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const weekAgo = addDays(today, -7);
  const recent = allBests.filter((b) => b.date > weekAgo);
  const bests = { fresh: recent.length > 0, items: (recent.length ? recent : allBests).slice(0, 3) };

  // Last 8 weeks for the bar chart, oldest first.
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const w = addDays(thisWeek, -7 * i);
    weeks.push({ weekStart: w, done: weekSessions(w).length, planned, holiday: weekIsHoliday(settings, w) });
  }
  const programWeek = firstDate ? Math.floor((Date.parse(thisWeek) - Date.parse(weekStartOf(firstDate))) / (7 * 86400000)) + 1 : null;

  return {
    today,
    week: { start: thisWeek, done: doneThisWeek, planned, remaining: Math.max(0, planned - doneThisWeek), holiday: weekIsHoliday(settings, thisWeek) },
    streak,
    volume: { kg: volume, lastWeekKg: volumeLast, changePct: volumeLast > 0 ? Math.round(((volume - volumeLast) / volumeLast) * 100) : null },
    runs: { km: runKm, count: runs.length, avgKm: runs.length ? round1(runKm / runs.length) : null },
    bodyweight,
    bests,
    weeks,
    programWeek,
    totalSessions: finished.length,
  };
}
