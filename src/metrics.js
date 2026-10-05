// Daily Apple Health / Apple Watch metrics: allowed names, valid ranges, and the summary text for the coach. Pure.
import { addDays } from './schedule.js';

/** name → [min, max, label, unit]. Values outside the range are rejected. */
export const METRICS = {
  steps: [0, 200000, 'Steps', ''],
  active_kcal: [0, 20000, 'Active energy', 'kcal'],
  basal_kcal: [0, 10000, 'Resting energy', 'kcal'],
  exercise_min: [0, 1440, 'Exercise', 'min'],
  stand_hours: [0, 24, 'Stand', 'h'],
  move_goal_kcal: [0, 20000, 'Move goal', 'kcal'],
  exercise_goal_min: [0, 1440, 'Exercise goal', 'min'],
  stand_goal_hours: [0, 24, 'Stand goal', 'h'],
  distance_km: [0, 500, 'Walk + run distance', 'km'],
  flights: [0, 1000, 'Flights climbed', ''],
  daylight_min: [0, 1440, 'Time in daylight', 'min'],
  resting_hr: [20, 200, 'Resting HR', 'bpm'],
  walking_hr: [30, 220, 'Walking HR', 'bpm'],
  hrv_ms: [1, 400, 'HRV', 'ms'],
  respiratory_rate: [4, 60, 'Respiratory rate', '/min'],
  spo2_pct: [50, 100, 'Blood oxygen', '%'],
  wrist_temp_delta: [-5, 5, 'Wrist temperature', '°C'],
  vo2max: [10, 100, 'VO2 max', 'ml/kg/min'],
  cardio_recovery: [0, 120, 'Cardio recovery', 'bpm'],
  sleep_min: [0, 1440, 'Sleep', 'min'],
  sleep_deep_min: [0, 1440, 'Deep sleep', 'min'],
  sleep_core_min: [0, 1440, 'Core sleep', 'min'],
  sleep_rem_min: [0, 1440, 'REM sleep', 'min'],
  sleep_awake_min: [0, 1440, 'Awake', 'min'],
  in_bed_min: [0, 1440, 'In bed', 'min'],
  bedtime_min: [-720, 1440, 'Bedtime', 'min from midnight'],
  wake_min: [0, 1440, 'Wake time', 'min from midnight'],
};

/** Validate one day's metrics object. Unknown names and bad values throw with a readable message. */
export function cleanMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw new Error('metrics must be an object');
  const out = {};
  for (const [name, raw] of Object.entries(metrics)) {
    const spec = METRICS[name];
    if (!spec) throw new Error(`unknown metric ${name}`);
    if (raw == null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < spec[0] || v > spec[1]) throw new Error(`${name} is out of range`);
    out[name] = Math.round(v * 100) / 100;
  }
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r0 = (n) => (n == null ? null : Math.round(n));
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Average of one metric over the days in byDate that have it. */
export function averageOf(byDate, metric) {
  return avg(Object.values(byDate).map((d) => d[metric]).filter((v) => v != null));
}

/** Days where all three Activity rings were closed. */
export function closedRingDays(byDate) {
  return Object.values(byDate).filter((d) =>
    d.move_goal_kcal && d.exercise_goal_min && d.stand_goal_hours
    && d.active_kcal >= d.move_goal_kcal && d.exercise_min >= d.exercise_goal_min && d.stand_hours >= d.stand_goal_hours).length;
}

const fmtSleep = (min) => (min == null ? '?' : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`);

/**
 * Compact text block for the coach: this week's averages against last week's.
 * metrics and previous are { date: { metric: value } }.
 */
export function metricsBlock(metrics, previous = {}) {
  if (!metrics || !Object.keys(metrics).length) return null;
  const line = (label, metric, fmt = r0, unit = '') => {
    const now = averageOf(metrics, metric);
    if (now == null) return null;
    const before = averageOf(previous, metric);
    return `  - ${label}: ${fmt(now)}${unit}${before != null ? ` (last week ${fmt(before)}${unit})` : ''}`;
  };
  const sleepStages = ['sleep_deep_min', 'sleep_core_min', 'sleep_rem_min'].map((m) => r0(averageOf(metrics, m)));
  const lines = [
    line('Sleep', 'sleep_min', fmtSleep),
    sleepStages.some((v) => v != null) ? `  - Sleep stages avg (deep/core/REM min): ${sleepStages.map((v) => v ?? '?').join('/')}` : null,
    line('HRV', 'hrv_ms', r0, ' ms'),
    line('Resting HR', 'resting_hr', r0, ' bpm'),
    line('VO2 max', 'vo2max', r1),
    line('Steps', 'steps'),
    line('Exercise minutes', 'exercise_min'),
    line('Active energy', 'active_kcal', r0, ' kcal'),
    line('Wrist temperature deviation', 'wrist_temp_delta', r1, ' °C'),
  ].filter(Boolean);
  const rings = closedRingDays(metrics);
  if (Object.values(metrics).some((d) => d.move_goal_kcal)) lines.push(`  - Activity rings closed on ${rings} of ${Object.keys(metrics).length} days`);
  return lines.length ? ['Apple Watch daily averages:', ...lines].join('\n') : null;
}

/** Energy out (active + resting) against food in, per day that has both. */
export function energyBalance(metrics, foodDays) {
  const food = new Map(foodDays.map((f) => [f.date, f.kcal]));
  const days = Object.entries(metrics)
    .filter(([date, d]) => d.active_kcal != null && d.basal_kcal != null && food.has(date))
    .map(([date, d]) => ({ date, outKcal: Math.round(d.active_kcal + d.basal_kcal), inKcal: Math.round(food.get(date)), balance: Math.round(food.get(date) - d.active_kcal - d.basal_kcal) }));
  return { days, avgBalance: days.length ? Math.round(avg(days.map((d) => d.balance))) : null };
}

/** The 7 dates ending at date, oldest first. */
export function lastDays(date, n = 7) {
  return Array.from({ length: n }, (_, i) => addDays(date, i - n + 1));
}
