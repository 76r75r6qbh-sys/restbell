// Pure scheduling helpers. Dates are 'YYYY-MM-DD' strings; weekdays are 1 (Mon) .. 7 (Sun).

export const TIME_ZONE = 'Europe/Amsterdam';

const amsterdamDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Europe/Amsterdam as 'YYYY-MM-DD'. */
export function todayStr(now = new Date()) {
  return amsterdamDate.format(now);
}

/** ISO weekday for a date string: Monday = 1 ... Sunday = 7. */
export function weekdayOf(dateStr) {
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** Add n days to a date string. */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week that contains dateStr. */
export function weekStartOf(dateStr) {
  return addDays(dateStr, 1 - weekdayOf(dateStr));
}

export function isHoliday(settings, dateStr) {
  const h = settings?.holiday;
  if (!h?.from || !h?.to) return false;
  return dateStr >= h.from && dateStr <= h.to;
}

/**
 * The session planned for a date, or null on a rest day.
 * During a holiday, lift days are replaced by the program's travel day.
 */
export function plannedDay(program, dateStr, settings = {}) {
  const weekday = weekdayOf(dateStr);
  const day = program.days.find((d) => d.weekday === weekday);
  if (!day) return null;
  if (day.type === 'lift' && isHoliday(settings, dateStr) && program.travel) {
    return { ...program.travel, weekday, time: day.time };
  }
  return day;
}
