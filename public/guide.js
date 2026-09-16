/* Guided session order: pure helpers shared by the browser (classic script) and the tests (imported for its side effect). */
(() => {
  const isLogged = (ex, setIndex, sets) => sets.some((s) => s.exerciseId === ex.id && s.setIndex === setIndex);
  const loggedCount = (ex, sets) => new Set(sets.filter((s) => s.exerciseId === ex.id && s.setIndex < ex.sets).map((s) => s.setIndex)).size;
  const rounds = (exercises) => Math.max(0, ...exercises.map((ex) => ex.sets));
  // Unlogged sets in round order: set 1 of every exercise, then set 2, ... The first one is the current step.
  const openSteps = (exercises, sets) => {
    const steps = [];
    for (let setIndex = 0; setIndex < rounds(exercises); setIndex++) {
      exercises.forEach((ex, index) => {
        if (setIndex < ex.sets && !isLogged(ex, setIndex, sets)) steps.push({ index, setIndex });
      });
    }
    return steps;
  };
  globalThis.RestbellGuide = { loggedCount, openSteps, rounds };
})();
