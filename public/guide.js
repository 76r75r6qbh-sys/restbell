/* Guided session order: pure helpers shared by the browser (classic script) and the tests (imported for its side effect). */
(() => {
  const isLogged = (ex, setIndex, sets) => sets.some((s) => s.exerciseId === ex.id && s.setIndex === setIndex);
  const loggedCount = (ex, sets) => new Set(sets.filter((s) => s.exerciseId === ex.id && s.setIndex < ex.sets).map((s) => s.setIndex)).size;
  const rounds = (exercises) => Math.max(0, ...exercises.map((ex) => ex.sets));
  // Gym lift days go exercise by exercise; home circuits and travel sessions go in rounds.
  const orderFor = (day) => (day.type === 'lift' ? 'straight' : 'rounds');
  // Unlogged sets in session order; the first one is the current step.
  // 'straight': every set of an exercise, then the next exercise. 'rounds': set 1 of every exercise, then set 2, ...
  const openSteps = (exercises, sets, order) => {
    const steps = [];
    const add = (index, setIndex) => {
      const ex = exercises[index];
      if (setIndex < ex.sets && !isLogged(ex, setIndex, sets)) steps.push({ index, setIndex });
    };
    if (order === 'straight') exercises.forEach((ex, index) => { for (let k = 0; k < ex.sets; k++) add(index, k); });
    else for (let k = 0; k < rounds(exercises); k++) exercises.forEach((_, index) => add(index, k));
    return steps;
  };
  globalThis.RestbellGuide = { loggedCount, openSteps, rounds, orderFor };
})();
