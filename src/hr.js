// Heart-rate zone analysis for imported Apple Watch workouts. Pure functions.

/** Five zones as fractions of max HR: Z1 50–60 %, Z2 60–70 %, Z3 70–80 %, Z4 80–90 %, Z5 90 %+. */
export const ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9];
export const ZONE_LABELS = ['Recovery', 'Easy', 'Aerobic', 'Threshold', 'Max'];

export function defaultMaxHr(age) {
  return 220 - age;
}

export function zoneOf(hr, maxHr) {
  const pct = hr / maxHr;
  if (pct < ZONE_BOUNDS[0]) return 0; // below Z1 counts as recovery
  let z = 0;
  for (let i = 0; i < ZONE_BOUNDS.length; i++) if (pct >= ZONE_BOUNDS[i]) z = i;
  return z;
}

/** Intensity label from the share of time at or above zone 3 (70 % max). */
export function intensityFrom(minutesPerZone) {
  const total = minutesPerZone.reduce((a, b) => a + b, 0);
  if (total === 0) return 'unknown';
  const hard = (minutesPerZone[3] + minutesPerZone[4]) / total;
  const moderate = minutesPerZone[2] / total;
  if (hard >= 0.3) return 'hard';
  if (hard + moderate >= 0.4) return 'moderate';
  return 'easy';
}

/**
 * Analyze heart-rate samples. samples = [{t: ISO string | epoch ms, hr}], unordered allowed.
 * Time credited to a sample is the gap to the next one, capped at maxGapSec.
 */
export function analyzeSamples(samples, maxHr, { maxGapSec = 30 } = {}) {
  const pts = (samples ?? [])
    .map((s) => ({ t: typeof s.t === 'number' ? s.t : Date.parse(s.t), hr: Number(s.hr) }))
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.hr) && s.hr > 0)
    .sort((a, b) => a.t - b.t);
  const minutes = [0, 0, 0, 0, 0];
  if (pts.length === 0) return { minutesPerZone: minutes, avgHr: null, maxHr: null, intensity: 'unknown', samples: 0 };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < pts.length; i++) {
    const gapSec = i + 1 < pts.length ? Math.min(maxGapSec, (pts[i + 1].t - pts[i].t) / 1000) : Math.min(maxGapSec, 5);
    minutes[zoneOf(pts[i].hr, maxHr)] += gapSec / 60;
    sum += pts[i].hr;
    if (pts[i].hr > max) max = pts[i].hr;
  }
  const rounded = minutes.map((m) => Math.round(m * 10) / 10);
  return { minutesPerZone: rounded, avgHr: Math.round(sum / pts.length), maxHr: max, intensity: intensityFrom(rounded), samples: pts.length };
}

/** When only an average is known, estimate the intensity from it. */
export function intensityFromAvg(avgHr, maxHr) {
  if (!avgHr || !maxHr) return 'unknown';
  const pct = avgHr / maxHr;
  if (pct >= 0.8) return 'hard';
  if (pct >= 0.7) return 'moderate';
  return 'easy';
}
