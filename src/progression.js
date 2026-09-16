// Deterministic double-progression rules. No I/O.

export function roundToIncrement(weight, increment) {
  const step = increment > 0 ? increment : 1;
  return Math.round(weight / step) * step;
}

/**
 * Compute the next exercise state from a finished session's sets.
 * @param {{repMin:number, repMax:number, increment:number}} exercise
 * @param {{weight:number|null, belowMinStreak:number}} state
 * @param {{reps:number, weight:number}[]} sets
 * @returns {{weight:number|null, belowMinStreak:number, change:'up'|'hold'|'down'|'adopt'}}
 */
export function nextState(exercise, state, sets) {
  const streak = state.belowMinStreak ?? 0;
  if (!sets || sets.length === 0) {
    return { weight: state.weight ?? null, belowMinStreak: streak, change: 'hold' };
  }
  if (state.weight == null) {
    const heaviest = Math.max(...sets.map((s) => Number(s.weight) || 0));
    return { weight: heaviest, belowMinStreak: 0, change: 'adopt' };
  }
  const reps = sets.map((s) => Number(s.reps) || 0);
  if (reps.every((r) => r >= exercise.repMax)) {
    return { weight: state.weight + exercise.increment, belowMinStreak: 0, change: 'up' };
  }
  if (reps.some((r) => r < exercise.repMin)) {
    if (streak + 1 >= 2) {
      return {
        weight: roundToIncrement(state.weight * 0.9, exercise.increment),
        belowMinStreak: 0,
        change: 'down',
      };
    }
    return { weight: state.weight, belowMinStreak: streak + 1, change: 'hold' };
  }
  return { weight: state.weight, belowMinStreak: 0, change: 'hold' };
}
