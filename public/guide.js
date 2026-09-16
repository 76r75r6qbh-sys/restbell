/* Guided session order: pure helpers shared by the browser (classic script) and the tests (imported for its side effect). */
(() => {
  const loggedCount = (ex, sets) => new Set(sets.filter((s) => s.exerciseId === ex.id && s.setIndex < ex.sets).map((s) => s.setIndex)).size;
  const isDone = (ex, sets) => loggedCount(ex, sets) >= ex.sets;
  const nextOpenSet = (ex, sets) => {
    for (let i = 0; i < ex.sets; i++) if (!sets.some((s) => s.exerciseId === ex.id && s.setIndex === i)) return i;
    return null;
  };
  // First unfinished exercise in program order; -1 when every set is logged.
  const firstOpen = (exercises, sets) => exercises.findIndex((ex) => !isDone(ex, sets));
  // First unfinished exercise after `from`, wrapping around to skipped ones; never `from` itself.
  const nextExercise = (exercises, sets, from) => {
    const n = exercises.length;
    for (let k = 1; k < n; k++) {
      const i = (from + k) % n;
      if (!isDone(exercises[i], sets)) return i;
    }
    return -1;
  };
  globalThis.RestbellGuide = { loggedCount, isDone, nextOpenSet, firstOpen, nextExercise };
})();
