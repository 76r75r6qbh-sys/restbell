// Readiness from Apple Watch recovery signals against a rolling personal baseline. Pure.
import { addDays } from './schedule.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** Minimum earlier days with a value before a signal counts. */
export const MIN_BASELINE_DAYS = 7;

/**
 * @param {object} metrics { 'YYYY-MM-DD': { hrv_ms, resting_hr, sleep_min, wrist_temp_delta } } covering date and up to 28 days before it
 * @param {string} date the day to score
 * @returns {{ level: 'good'|'ok'|'low'|null, score: number|null, reasons: string[], signals: object }}
 */
export function recoveryFor(metrics, date, { baselineDays = 28 } = {}) {
  const today = metrics[date] ?? {};
  const history = (metric) => {
    const out = [];
    for (let i = 1; i <= baselineDays; i++) {
      const v = metrics[addDays(date, -i)]?.[metric];
      if (v != null) out.push(v);
    }
    return out;
  };

  // Each signal contributes a z-like penalty in [-1, 1]; positive = worse than usual.
  const signals = {};
  const reasons = [];
  const compare = (metric, { higherIsBetter, label, unit = '', minSd }) => {
    const v = today[metric];
    const base = history(metric);
    if (v == null || base.length < MIN_BASELINE_DAYS) return;
    const m = mean(base);
    const spread = Math.max(sd(base), minSd);
    const z = (v - m) / spread;
    const penalty = Math.max(-1, Math.min(1, (higherIsBetter ? -z : z) / 2));
    const pct = m ? Math.round(((v - m) / m) * 100) : 0;
    signals[metric] = { value: v, baseline: Math.round(m * 10) / 10, penalty: Math.round(penalty * 100) / 100 };
    if (penalty >= 0.5) reasons.push(`${label} ${Math.abs(pct)} % ${v > m ? 'above' : 'below'} your usual${unit}`);
    else if (penalty <= -0.5) reasons.push(`${label} better than usual`);
  };
  compare('hrv_ms', { higherIsBetter: true, label: 'HRV', minSd: 3 });
  compare('resting_hr', { higherIsBetter: false, label: 'Resting HR', minSd: 1.5 });

  // Sleep: an absolute floor matters more than the baseline.
  if (today.sleep_min != null) {
    const h = today.sleep_min / 60;
    const penalty = h >= 7.5 ? -0.3 : h >= 6.5 ? 0 : h >= 5.5 ? 0.5 : 1;
    signals.sleep_min = { value: today.sleep_min, penalty };
    if (penalty >= 0.5) reasons.push(`${Math.floor(h)} h ${String(Math.round(today.sleep_min % 60)).padStart(2, '0')} sleep`);
  }
  // A raised wrist temperature often comes before illness.
  if (today.wrist_temp_delta != null) {
    const t = today.wrist_temp_delta;
    const penalty = t >= 0.8 ? 1 : t >= 0.5 ? 0.5 : 0;
    signals.wrist_temp_delta = { value: t, penalty };
    if (penalty > 0) reasons.push(`wrist temperature +${t.toFixed(1)} °C`);
  }

  const weights = { hrv_ms: 0.4, resting_hr: 0.25, sleep_min: 0.25, wrist_temp_delta: 0.1 };
  const used = Object.keys(signals);
  if (!used.length) return { level: null, score: null, reasons: [], signals };
  const totalWeight = used.reduce((a, k) => a + weights[k], 0);
  const penalty = used.reduce((a, k) => a + signals[k].penalty * weights[k], 0) / totalWeight;
  const score = Math.round(Math.max(0, Math.min(100, 70 - penalty * 50)));
  // A strong single warning (very short sleep, fever-like temperature) caps the level.
  const hardFlag = used.some((k) => signals[k].penalty >= 1);
  const level = score >= 70 && !hardFlag ? 'good' : score >= 50 && !hardFlag ? 'ok' : 'low';
  return { level, score, reasons, signals };
}

export function recoveryText(r) {
  if (!r?.level) return null;
  return `Recovery today: ${r.level} (${r.score}/100)${r.reasons.length ? ` — ${r.reasons.join(', ')}` : ''}`;
}
