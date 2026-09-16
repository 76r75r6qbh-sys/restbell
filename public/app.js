/* Trainer — vanilla JS front end. State lives in `S`; every view re-renders from it. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v === false || v == null) continue;
      else if (k === 'checked' || k === 'disabled' || k === 'hidden') node[k] = v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
    return node;
  };

  const QUEUE_KEY = 'trainer.queue';
  const S = {
    tab: 'today',
    today: null,
    stats: null,
    settings: null,
    health: null,
    session: null,
    editing: null,       // { exerciseId, setIndex }
    foodDate: null,
    foodDay: null,
    quick: null,         // { favorites, recent }
    editFavorites: false,
    estimate: null,
    history: null,
    checkins: null,
    coach: null,
    queue: JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'),
    timer: null,         // { endsAt, next, total }
    doneSummary: null,
    guide: null,         // { open, last } while a lift session runs
  };

  // ---------- helpers ----------
  const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDateLong = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const pad = (n) => String(n).padStart(2, '0');
  const kg = (w) => (w == null ? '—' : `${Number(w) % 1 === 0 ? w : Number(w).toFixed(1)} kg`);
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const addDays = (d, n) => {
    const x = new Date(`${d}T12:00:00`);
    x.setDate(x.getDate() + n);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  let toastTimer;
  const toast = (msg, ms = 2600) => {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  };

  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) {
      showLogin();
      throw new Error('login required');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { status: res.status });
    return json;
  }

  // Offline queue: set logs that failed on the network are retried later.
  const saveQueue = () => localStorage.setItem(QUEUE_KEY, JSON.stringify(S.queue));
  async function sendOrQueue(method, path, body) {
    try {
      return await api(method, path, body);
    } catch (e) {
      if (e instanceof TypeError) {
        S.queue.push({ method, path, body, at: Date.now() });
        saveQueue();
        toast('No connection. Saved on the phone, will sync later.');
        return null;
      }
      throw e;
    }
  }
  async function flushQueue() {
    if (!S.queue.length) return;
    const pending = [...S.queue];
    S.queue = [];
    saveQueue();
    for (const item of pending) {
      try {
        await api(item.method, item.path, item.body);
      } catch (e) {
        if (e instanceof TypeError) S.queue.push(item);
      }
    }
    saveQueue();
    if (!S.queue.length && pending.length) toast(`Synced ${pending.length} saved ${pending.length === 1 ? 'set' : 'sets'}.`);
  }

  // ---------- voice ----------
  function speak(text) {
    if (!S.settings?.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 1;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
  function announceHA(text) {
    if (!S.settings?.haAnnounce || !S.health?.ha) return;
    fetch('/api/ha/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
  }

  // ---------- rest timer ----------
  let timerInterval = null;
  function startTimer(seconds, next) {
    S.timer = { endsAt: Date.now() + seconds * 1000, next, total: seconds };
    $('#timer').hidden = false;
    $('#timer-next').textContent = next ? `Up next: ${next}` : 'Rest';
    clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 250);
    tickTimer();
  }
  function tickTimer() {
    if (!S.timer) return;
    const left = Math.max(0, Math.round((S.timer.endsAt - Date.now()) / 1000));
    $('#timer-clock').textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
    tickGuideRing(left);
    if (left <= 0) {
      const next = S.timer.next;
      stopTimer();
      const msg = next ? `Rest over. ${next}.` : 'Rest over.';
      speak(msg);
      announceHA(msg);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }
  function stopTimer() {
    S.timer = null;
    clearInterval(timerInterval);
    $('#timer').hidden = true;
    if (S.guide?.open) renderGuide();
  }
  $('#timer-skip').addEventListener('click', stopTimer);
  const addRest = () => {
    if (!S.timer) return;
    S.timer.endsAt += 30000;
    S.timer.total = Math.max(S.timer.total, (S.timer.endsAt - Date.now()) / 1000);
    tickTimer();
  };
  $('#timer-plus').addEventListener('click', addRest);

  const keepAwake = (on) => globalThis.RestbellAwake?.set(on);

  // ---------- sheet (bottom modal) ----------
  function openSheet(...content) {
    const sheet = $('#sheet');
    sheet.replaceChildren(...content);
    sheet.hidden = false;
    $('#sheet-backdrop').hidden = false;
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
  }
  $('#sheet-backdrop').addEventListener('click', closeSheet);

  // ---------- login ----------
  function showLogin() { $('#login').hidden = false; }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').hidden = true;
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#login-password').value }) });
    if (res.ok) {
      $('#login').hidden = true;
      $('#login-password').value = '';
      boot();
    } else {
      $('#login-error').hidden = false;
    }
  });

  // ---------- data loading ----------
  async function loadToday() {
    const d = localToday();
    [S.today, S.stats] = await Promise.all([api('GET', `/api/today?date=${d}`), api('GET', `/api/stats?date=${d}`).catch(() => null)]);
    S.session = S.today.openSession;
    if (S.session) keepAwake(true);
  }
  async function loadSettings() { S.settings = await api('GET', '/api/settings'); }

  // ---------- rendering ----------
  function render() {
    $('#top-date').textContent = fmtDateLong(localToday());
    for (const b of $('#tabs').children) b.classList.toggle('active', b.dataset.tab === S.tab);
    const view = $('#view');
    view.replaceChildren();
    ({ today: renderToday, history: renderHistory, checkin: renderCheckin, food: renderFood, coach: renderCoach })[S.tab](view);
    renderGuide();
  }

  // ----- Today -----
  function targetText(ex) {
    const reps = ex.repMin === ex.repMax ? ex.repMin : `${ex.repMin}–${ex.repMax}`;
    const unit = ex.unit === 'sec' ? 's' : '';
    const load = ex.weight == null ? 'find weight' : ex.weight === 0 ? 'bodyweight' : kg(ex.weight);
    return `${ex.sets} × ${reps}${unit} · ${load}`;
  }
  function loggedSet(exId, idx) { return S.session?.sets.find((s) => s.exerciseId === exId && s.setIndex === idx) ?? null; }
  function lastSessionSet(exId, idx) { return S.today?.lastSession?.sets?.find((s) => s.exerciseId === exId && s.setIndex === idx) ?? null; }

  function renderToday(view) {
    const t = S.today;
    if (!t) return view.append(el('div', { class: 'empty' }, 'Loading…'));
    if (S.queue.length) view.append(el('div', { class: 'banner' }, `${S.queue.length} set${S.queue.length > 1 ? 's' : ''} waiting to sync. `, el('a', { href: '#', onclick: (e) => { e.preventDefault(); flushQueue().then(refreshToday); } }, 'Retry')));
    if (t.holiday && localToday() >= t.holiday.from && localToday() <= t.holiday.to) {
      view.append(el('div', { class: 'banner' }, `Holiday until ${fmtDate(t.holiday.to)}: lifts are swapped for a bodyweight session. Runs stay.`));
    }
    if (S.doneSummary) view.append(renderDoneCard());
    if (S.stats) view.append(renderDashboard(S.stats, !!S.session));
    if (S.session) return view.append(renderSession(t));
    if (!t.day) return view.append(renderRestDay(t));
    view.append(renderPlannedCard(t));
  }

  function renderDashboard(st, compact) {
    const tile = (k, v, sub, extra = '') => el('div', { class: `tile${extra}` }, el('div', { class: 'k' }, k), v, sub ? el('div', { class: 'small muted' }, sub) : null);
    const pct = st.week.planned ? Math.min(1, st.week.done / st.week.planned) : 0;
    const C = 2 * Math.PI * 23;
    const ring = el('div', { class: 'tile ring' },
      el('div', { html: `<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="23" fill="none" stroke="var(--line)" stroke-width="7"/><circle cx="28" cy="28" r="23" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="32" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor">${st.week.done}/${st.week.planned}</text></svg>` }),
      el('div', {}, el('div', { class: 'k' }, 'Sessions'), el('div', { class: 'small muted' }, st.week.holiday ? 'Holiday week: anything counts' : st.week.remaining === 0 ? 'Week complete' : `${st.week.remaining} to go this week`)),
    );
    const grid = el('div', { class: 'dash' }, ring,
      tile('Volume lifted', el('div', { class: 'v num' }, `${st.volume.kg.toLocaleString('en-GB')} kg`), st.volume.changePct == null ? (st.volume.kg ? 'this week' : 'no lifts yet this week') : el('span', {}, el('b', { class: st.volume.changePct >= 0 ? 'good' : 'muted' }, `${st.volume.changePct >= 0 ? '+' : ''}${st.volume.changePct}%`), ' vs last week')),
    );
    if (!compact) {
      grid.append(
        tile('Streak', el('div', { class: 'v num' }, `${st.streak} wk`), st.streak ? 'every planned session done' : 'complete a week to start one'),
        tile('Run this month', el('div', { class: 'v num' }, `${st.runs.km} km`), st.runs.count ? `${st.runs.count} run${st.runs.count > 1 ? 's' : ''} · avg ${st.runs.avgKm} km` : 'no runs yet'),
        tile('Bodyweight', el('div', { class: 'v num' }, st.bodyweight ? `${st.bodyweight.kg.toFixed(1)} kg` : '—'), st.bodyweight ? (st.bodyweight.delta != null ? el('span', {}, el('b', { class: 'good' }, `${st.bodyweight.delta > 0 ? '+' : ''}${st.bodyweight.delta}`), ` over ${st.bodyweight.over} weigh-ins`) : `weighed ${fmtDate(st.bodyweight.date)}`) : 'no weigh-in yet'),
        el('div', { class: 'tile' }, el('div', { class: 'k' }, st.bests.fresh ? 'New bests · 7 days' : 'Best sets'),
          st.bests.items.length ? st.bests.items.map((b) => el('div', { class: 'pr' }, el('span', {}, b.name), el('b', { class: 'num' }, b.weight > 0 ? `${b.weight} kg × ${b.reps}` : `${b.reps} reps`))) : el('div', { class: 'small muted' }, 'log a session to set one')),
      );
      const max = Math.max(1, ...st.weeks.map((w) => Math.max(w.done, w.planned)));
      grid.append(el('div', { class: 'tile wide' }, el('div', { class: 'k' }, 'Sessions per week'),
        el('div', { class: 'bars' }, st.weeks.map((w, i) => el('div', { class: `b${i === st.weeks.length - 1 ? ' now' : ''}${w.done === 0 ? ' zero' : ''}${w.holiday ? ' hol' : ''}`, style: `height:${Math.round((w.done / max) * 100)}%`, title: `${fmtDate(w.weekStart)}: ${w.done} of ${w.planned}${w.holiday ? ' (holiday)' : ''}` }))),
        el('div', { class: 'bars-x' }, st.weeks.map((w) => el('span', {}, w.weekStart.slice(8, 10).replace(/^0/, '') + '/' + w.weekStart.slice(5, 7).replace(/^0/, '')))),
      ));
    }
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', { class: 'eyebrow' }, compact ? 'This week' : 'This week'), st.programWeek ? el('span', { class: 'pill accent' }, `Week ${st.programWeek} of the program`) : null),
      grid,
    );
  }

  function renderPlannedCard(t) {
    const d = t.day;
    const card = el('div', { class: 'card' },
      el('div', { class: 'eyebrow' }, d.time ? `Planned · ${d.time}` : 'Planned'),
      el('h1', {}, d.title),
      d.type === 'run' ? el('p', { class: 'muted' }, d.cue) : el('p', { class: 'muted' }, `${d.exercises.length} exercises · ${d.exercises.reduce((n, e) => n + e.sets, 0)} sets`),
      t.lastSession ? el('p', { class: 'small muted' }, `Last time: ${fmtDate(t.lastSession.date)}, felt ${t.lastSession.feel ?? '–'}/5${t.lastSession.notes ? ` — “${t.lastSession.notes}”` : ''}`) : null,
      d.type === 'run' ? renderRunForm(d) : el('button', { class: 'btn primary wide', onclick: () => startSession(d.key) }, 'Start session'),
    );
    if (d.type !== 'run') {
      card.append(el('div', { class: 'list' }, d.exercises.map((ex) => el('div', { class: 'item' },
        el('div', { class: 'item-main' }, el('div', { class: 'item-title' }, ex.name), el('div', { class: 'item-sub' }, ex.cue)),
        el('span', { class: 'pill num' }, targetText(ex)),
      ))));
    }
    card.append(el('button', { class: 'btn ghost wide', onclick: () => pickSession(t) }, 'Do a different session'));
    if (t.programNotes) card.append(el('p', { class: 'small muted' }, t.programNotes));
    return card;
  }

  function renderRestDay(t) {
    return el('div', { class: 'card' },
      el('div', { class: 'eyebrow' }, 'Today'),
      el('h1', {}, 'Rest day'),
      el('p', { class: 'muted' }, 'Nothing planned. Walk, eat your protein, sleep. Or pick something below.'),
      el('div', { class: 'row' }, t.days.map((d) => el('button', { class: 'btn', onclick: () => d.type === 'run' ? openSheet(el('h2', {}, 'Log a run'), renderRunForm(d)) : startSession(d.key) }, d.title.split(' ·')[0]))),
    );
  }

  function pickSession(t) {
    openSheet(
      el('h2', {}, 'Which session?'),
      el('div', { class: 'stack' }, [...t.days, { key: 'T', title: 'Travel session · bodyweight', type: 'travel' }].map((d) =>
        el('button', { class: 'btn wide', onclick: () => { closeSheet(); d.type === 'run' ? openSheet(el('h2', {}, 'Log a run'), renderRunForm(d)) : startSession(d.key); } }, d.title))),
    );
  }

  async function startSession(dayKey) {
    try {
      S.doneSummary = null;
      S.guide = null; // render() opens the guide for the new session
      await api('POST', '/api/sessions', { date: localToday(), dayKey });
      await loadToday(); // /api/today returns the open session's day and targets
      keepAwake(true);
      S.tab = 'today';
      render();
      window.scrollTo(0, 0);
    } catch (e) { toast(e.message); }
  }

  function renderSession(t) {
    const day = t.day && t.day.key === S.session.dayKey ? t.day : null;
    if (!day) return el('div', { class: 'card' }, el('p', {}, 'Loading session…'), el('button', { class: 'btn', onclick: () => discardSession() }, 'Discard session'));
    const done = S.session.sets.length;
    const total = day.exercises.reduce((n, e) => n + e.sets, 0);
    const card = el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'In progress'), el('h1', {}, day.title)), el('span', { class: 'pill accent num' }, `${done}/${total} sets`)),
      S.guide && !S.guide.open ? el('button', { class: 'btn primary wide', onclick: () => { S.guide.open = true; render(); } }, 'Resume guided view') : null,
    );
    for (const ex of day.exercises) card.append(renderExercise(ex));
    card.append(
      el('button', { class: 'btn primary wide', onclick: () => finishSheet(day) }, 'Finish session'),
      el('button', { class: 'btn ghost wide danger', onclick: discardSession }, 'Discard session'),
    );
    return card;
  }

  function renderExercise(ex) {
    const box = el('div', { class: 'exercise' },
      el('div', { class: 'exercise-head' }, el('h3', {}, ex.name), el('span', { class: 'exercise-target num' }, targetText(ex))),
      el('div', { class: 'cue' }, ex.cue),
    );
    const sets = el('div', { class: 'sets' });
    for (let i = 0; i < ex.sets; i++) {
      const logged = loggedSet(ex.id, i);
      const editing = S.editing && S.editing.exerciseId === ex.id && S.editing.setIndex === i;
      const btn = el('button', { class: `set num${logged ? ' done' : ''}${editing ? ' editing' : ''}`, onclick: () => { S.editing = editing ? null : { exerciseId: ex.id, setIndex: i }; render(); } },
        logged ? `${logged.reps}${ex.unit === 'sec' ? 's' : ''}` : `Set ${i + 1}`,
        logged ? el('small', {}, logged.weight > 0 ? kg(logged.weight) : 'bw') : el('small', {}, ex.unit === 'sec' ? `${ex.repMax}s` : `${ex.repMax} reps`),
      );
      sets.append(btn);
    }
    box.append(sets);
    if (S.editing && S.editing.exerciseId === ex.id) box.append(renderEditor(ex, S.editing.setIndex));
    return box;
  }

  // Starting values for a set: what was logged, else this session's previous set, the target, or last time.
  function prefill(ex, idx) {
    const logged = loggedSet(ex.id, idx);
    const prevInSession = [...S.session.sets].reverse().find((s) => s.exerciseId === ex.id);
    const last = lastSessionSet(ex.id, idx);
    return {
      logged,
      last,
      weight: logged?.weight ?? prevInSession?.weight ?? ex.weight ?? last?.weight ?? 0,
      reps: logged?.reps ?? (ex.unit === 'sec' ? ex.repMax : (ex.repMax ?? 8)),
    };
  }

  function renderEditor(ex, idx) {
    const { logged, last, weight, reps } = prefill(ex, idx);
    const step = ex.increment > 0 ? ex.increment : 2.5;
    const wIn = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', value: weight, id: `w-${ex.id}-${idx}` });
    const rIn = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: reps, id: `r-${ex.id}-${idx}` });
    const bump = (input, d) => { input.value = Math.max(0, Math.round((Number(input.value) + d) * 100) / 100); };
    const editor = el('div', { class: 'editor' },
      el('div', { class: 'editor-grid' },
        el('div', {}, el('div', { class: 'stepper-label' }, 'Weight (kg)'), el('div', { class: 'stepper' }, el('button', { onclick: () => bump(wIn, -step) }, '−'), el('div', { class: 'value' }, wIn), el('button', { onclick: () => bump(wIn, step) }, '+'))),
        el('div', {}, el('div', { class: 'stepper-label' }, ex.unit === 'sec' ? 'Seconds' : 'Reps'), el('div', { class: 'stepper' }, el('button', { onclick: () => bump(rIn, -1) }, '−'), el('div', { class: 'value' }, rIn), el('button', { onclick: () => bump(rIn, 1) }, '+'))),
      ),
      last ? el('div', { class: 'small muted' }, `Last time: ${last.reps}${ex.unit === 'sec' ? 's' : ''} at ${kg(last.weight)}`) : null,
      el('div', { class: 'row' },
        logged ? el('button', { class: 'btn danger', onclick: () => removeSet(ex, idx) }, 'Remove') : null,
        el('button', { class: 'btn primary', onclick: () => logSet(ex, idx, Number(rIn.value), Number(wIn.value)) }, logged ? 'Update set' : 'Log set'),
      ),
    );
    return editor;
  }

  function nextSetDescription(ex, idx, day) {
    if (idx + 1 < ex.sets) return `${ex.name}, set ${idx + 2} of ${ex.sets}`;
    const i = day.exercises.findIndex((e) => e.id === ex.id);
    const nx = day.exercises[i + 1];
    return nx ? `${nx.name}, ${targetText(nx)}` : 'last exercise done, finish the session';
  }

  async function logSet(ex, idx, reps, weight) {
    if (!Number.isFinite(reps) || !Number.isFinite(weight)) return toast('Enter reps and weight');
    if (ex.weight == null && weight <= 0 && ex.increment > 0) return toast('Enter the weight you used, so it becomes your working weight');
    const body = { exerciseId: ex.id, exerciseName: ex.name, setIndex: idx, targetReps: ex.repMax, reps, weight };
    const saved = await sendOrQueue('POST', `/api/sessions/${S.session.id}/sets`, body);
    const setRow = saved ?? { ...body, sessionId: S.session.id, queued: true };
    S.session.sets = S.session.sets.filter((s) => !(s.exerciseId === ex.id && s.setIndex === idx)).concat(setRow);
    S.editing = null;
    if (S.guide?.open) return guideAfterLog(ex, idx, S.today.day);
    startTimer(ex.restSec ?? 90, nextSetDescription(ex, idx, S.today.day));
    render();
  }

  async function removeSet(ex, idx) {
    try {
      await api('DELETE', `/api/sessions/${S.session.id}/sets`, { exerciseId: ex.id, setIndex: idx });
      S.session.sets = S.session.sets.filter((s) => !(s.exerciseId === ex.id && s.setIndex === idx));
      S.editing = null;
      render();
    } catch (e) { toast(e.message); }
  }

  // ----- Guided session (fullscreen, set by set in rounds) -----
  const G = globalThis.RestbellGuide;
  const RING_R = 118;
  const RING_C = 2 * Math.PI * RING_R;
  const ICON = {
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    check: '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  const guideDay = () => (S.session && S.today?.day?.key === S.session.dayKey && S.today.day.exercises?.length ? S.today.day : null);
  const stepText = (exs, step) => `${exs[step.index].name}, set ${step.setIndex + 1} of ${exs[step.index].sets}`;

  function guideAfterLog(ex, idx, day) {
    const exs = day.exercises;
    const [next] = G.openSteps(exs, S.session.sets);
    S.guide.last = `${ex.name} · set ${idx + 1} logged`;
    if (!next) {
      stopTimer();
      speak('All sets done. Nice work.');
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      return render();
    }
    startTimer(ex.restSec ?? 90, stepText(exs, next));
    render();
  }

  function tickGuideRing(left) {
    const arc = $('#g-arc');
    if (!arc || !S.timer) return;
    const ms = Math.max(0, S.timer.endsAt - Date.now());
    arc.style.strokeDashoffset = (RING_C * (1 - ms / (S.timer.total * 1000))).toFixed(1);
    $('#g-clock').textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
  }

  function renderGuide() {
    const root = $('#guide');
    if (!S.session) S.guide = null;
    const day = guideDay();
    if (day && !S.guide) S.guide = { open: true, last: null };
    const open = !!(day && S.guide?.open);
    root.hidden = !open;
    document.body.classList.toggle('guiding', open);
    // Safari tints its translucent top bar from the page background and theme colour, not from the overlay.
    document.documentElement.classList.toggle('guiding', open);
    $('meta[name="theme-color"]').content = open ? '#07090C' : '#0E7C86';
    if (!open) return root.replaceChildren();

    const exs = day.exercises;
    const sets = S.session.sets;
    const steps = G.openSteps(exs, sets);
    const [step, after] = steps;
    const totalRounds = G.rounds(exs);

    const top = el('div', { class: 'g-top' },
      el('button', { class: 'g-icon', 'aria-label': 'Show all exercises', onclick: () => { S.guide.open = false; render(); window.scrollTo(0, 0); }, html: ICON.list }),
      el('div', { class: 'g-heading' },
        el('div', { class: 'g-eyebrow' }, day.title),
        el('div', { class: 'g-count num' }, step ? `Round ${step.setIndex + 1} of ${totalRounds} · Exercise ${step.index + 1} of ${exs.length}` : 'All sets done')),
      el('button', { class: 'g-pill', onclick: () => finishSheet(day) }, 'Finish'),
    );
    // One segment per round, filled by the share of that round's sets that are logged.
    const progress = el('div', { class: 'g-progress', 'aria-hidden': 'true' }, Array.from({ length: totalRounds }, (_, r) => {
      const inRound = exs.filter((e) => r < e.sets);
      const done = inRound.filter((e) => sets.some((s) => s.exerciseId === e.id && s.setIndex === r)).length;
      return el('span', { class: `g-seg${step?.setIndex === r ? ' now' : ''}` }, el('i', { style: `width:${Math.round((done / inRound.length) * 100)}%` }));
    }));

    let body;
    if (S.timer && step) body = guideRest(exs, step);
    else if (!step) body = guideComplete(day, sets);
    else body = guideStep(exs, step, after);
    body.classList.add('g-body');
    root.replaceChildren(el('div', { class: 'g-wrap' }, top, progress, body));
    if (S.timer) tickTimer();
  }

  function guideStep(exs, step, after) {
    const ex = exs[step.index];
    const idx = step.setIndex;
    const dots = el('div', { class: 'g-dots', 'aria-label': `${G.loggedCount(ex, S.session.sets)} of ${ex.sets} sets logged` },
      Array.from({ length: ex.sets }, (_, k) => el('span', { class: `g-dot${loggedSet(ex.id, k) ? ' done' : ''}${k === idx ? ' current' : ''}` })));

    const { last, weight, reps } = prefill(ex, idx);
    const step1 = ex.increment > 0 ? ex.increment : 2.5;
    const wIn = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', min: '0', value: weight, 'aria-label': 'Weight in kg' });
    const rIn = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '0', value: reps, 'aria-label': ex.unit === 'sec' ? 'Seconds' : 'Reps' });
    const bump = (input, d) => { input.value = Math.max(0, Math.round((Number(input.value) + d) * 100) / 100); };
    const stepper = (label, input, d) => el('div', { class: 'g-stepper' },
      el('button', { 'aria-label': `Less ${label.toLowerCase()}`, onclick: () => bump(input, -d) }, '−'),
      el('label', { class: 'g-value' }, el('span', {}, label), input),
      el('button', { 'aria-label': `More ${label.toLowerCase()}`, onclick: () => bump(input, d) }, '+'));
    const hint = last
      ? `Last time: ${last.reps}${ex.unit === 'sec' ? 's' : ''}${last.weight > 0 ? ` at ${kg(last.weight)}` : ', bodyweight'}`
      : ex.weight == null ? 'Find your working weight: start light, stop with 2 reps left.' : null;

    return el('div', {},
      el('div', { class: 'g-main' },
        el('div', { class: 'g-setline' }, el('span', { class: 'g-eyebrow accent' }, `Set ${idx + 1} of ${ex.sets}`), dots),
        el('h1', { class: 'g-name' }, ex.name),
        el('div', { class: 'g-target num' }, targetText(ex)),
        ex.cue ? el('p', { class: 'g-cue' }, ex.cue) : null,
      ),
      el('div', { class: 'g-controls' },
        el('div', { class: 'g-steppers' }, stepper('Weight · kg', wIn, step1), stepper(ex.unit === 'sec' ? 'Seconds' : 'Reps', rIn, 1)),
        hint ? el('div', { class: 'g-hint' }, hint) : null,
        el('button', { class: 'g-cta', onclick: () => logSet(ex, idx, Number(rIn.value), Number(wIn.value)) }, `Log set ${idx + 1}`),
      ),
      el('div', { class: 'g-upnext' },
        el('span', { class: 'g-eyebrow' }, after ? 'Next' : 'Then'),
        el('span', { class: 'g-upnext-name' }, after ? `${exs[after.index].name} · set ${after.setIndex + 1}` : 'Finish the session')),
    );
  }

  function guideRest(exs, step) {
    const ex = exs[step.index];
    return el('div', { class: 'g-rest' },
      S.guide.last ? el('div', { class: 'g-badge' }, el('span', { class: 'g-check-dot', html: ICON.check }), S.guide.last) : el('div', { class: 'g-eyebrow accent' }, 'Rest'),
      el('div', { class: 'g-ring' },
        el('div', { html: `<svg viewBox="0 0 260 260" aria-hidden="true"><defs><linearGradient id="g-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--g-accent)"/><stop offset="1" stop-color="var(--g-good)"/></linearGradient></defs><circle cx="130" cy="130" r="${RING_R}" class="g-track"/><circle id="g-arc" cx="130" cy="130" r="${RING_R}" class="g-arc" stroke-dasharray="${RING_C.toFixed(1)}" transform="rotate(-90 130 130)"/></svg>` }),
        el('div', { class: 'g-clock-wrap' }, el('div', { id: 'g-clock', class: 'g-clock num', role: 'timer' }, ''), el('div', { class: 'g-eyebrow' }, 'rest')),
      ),
      el('div', { class: 'g-rest-actions' },
        el('button', { class: 'g-pill', onclick: addRest }, '+30s'),
        el('button', { class: 'g-pill solid', onclick: stopTimer }, 'Skip rest')),
      el('div', { class: 'g-next-card' },
        el('div', { class: 'g-eyebrow' }, 'Up next'),
        el('div', { class: 'g-next-name' }, ex.name),
        el('div', { class: 'g-next-meta num' }, `Set ${step.setIndex + 1} of ${ex.sets} · ${targetText(ex)}`),
        ex.cue ? el('div', { class: 'g-cue' }, ex.cue) : null),
    );
  }

  function guideComplete(day, sets) {
    const volume = Math.round(sets.reduce((n, s) => n + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0));
    return el('div', { class: 'g-complete' },
      el('div', { class: 'g-trophy', html: ICON.check }),
      el('h1', { class: 'g-name' }, 'All sets done'),
      el('p', { class: 'g-cue' }, `${sets.length} sets${volume ? ` · ${volume.toLocaleString('en-GB')} kg lifted` : ''}. Tell the coach how it felt.`),
      el('button', { class: 'g-cta', onclick: () => finishSheet(day) }, 'Finish session'),
      el('button', { class: 'g-pill ghost', onclick: () => { S.guide.open = false; render(); } }, 'Review all sets'),
    );
  }

  const FEELS = [['1', 'Rough'], ['2', 'Meh'], ['3', 'OK'], ['4', 'Good'], ['5', 'Great']];
  function feelPicker(initial, onPick) {
    let value = initial;
    const wrap = el('div', { class: 'feel' });
    const paint = () => { for (const b of wrap.children) b.classList.toggle('active', b.dataset.v === String(value)); };
    for (const [v, label] of FEELS) wrap.append(el('button', { type: 'button', 'data-v': v, onclick: () => { value = Number(v); onPick(value); paint(); } }, v, el('small', {}, label)));
    paint();
    return wrap;
  }

  function finishSheet(day) {
    let feel = 4;
    const notes = el('textarea', { id: 'finish-notes', placeholder: 'How did it go? Anything to change next time?' });
    openSheet(
      el('h2', {}, 'Finish session'),
      el('div', { class: 'field' }, el('span', {}, 'How did it feel?'), feelPicker(feel, (v) => (feel = v))),
      el('label', { class: 'field' }, el('span', {}, 'Notes'), notes),
      el('button', { class: 'btn primary wide', onclick: async () => {
        try {
          await flushQueue();
          const r = await api('POST', `/api/sessions/${S.session.id}/finish`, { feel, notes: notes.value });
          closeSheet();
          stopTimer();
          keepAwake(false);
          S.doneSummary = { title: day.title, changes: r.changes, sets: r.session.sets.length };
          S.session = null;
          S.editing = null;
          speak('Session done. Nice work.');
          await loadToday();
          render();
          window.scrollTo(0, 0);
        } catch (e) { toast(e.message); }
      } }, 'Save & finish'),
    );
  }

  async function discardSession() {
    if (!S.session) return;
    openSheet(
      el('h2', {}, 'Discard this session?'),
      el('p', { class: 'muted' }, 'Logged sets will be deleted.'),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: closeSheet }, 'Keep'), el('button', { class: 'btn danger', onclick: async () => {
        try {
          await api('DELETE', `/api/sessions/${S.session.id}`);
          S.session = null;
          S.editing = null;
          stopTimer();
          keepAwake(false);
          closeSheet();
          await loadToday();
          render();
        } catch (e) { toast(e.message); }
      } }, 'Discard')),
    );
  }

  function renderDoneCard() {
    const d = S.doneSummary;
    const changeText = (c) => ({
      up: `${c.name}: up to ${kg(c.weight)} next time`,
      down: `${c.name}: back to ${kg(c.weight)} next time`,
      adopt: `${c.name}: working weight set to ${kg(c.weight)}`,
      hold: `${c.name}: stays at ${kg(c.weight)}`,
    })[c.change];
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Done'), el('h2', {}, d.title)), el('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => { S.doneSummary = null; render(); } }, '✕')),
      d.sets != null && d.sets > 0 ? el('p', { class: 'muted' }, `${d.sets} sets logged.`) : null,
      d.changes?.length ? el('ul', { class: 'changes' }, d.changes.map((c) => el('li', {}, changeText(c)))) : el('p', { class: 'muted' }, d.text ?? 'Logged.'),
    );
  }

  function renderRunForm(d) {
    const km = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '6.0', id: 'run-km' });
    const min = el('input', { type: 'number', inputmode: 'numeric', step: '1', placeholder: '38', id: 'run-min' });
    const notes = el('input', { type: 'text', placeholder: 'Route, legs, weather…', id: 'run-notes' });
    let feel = 3;
    return el('div', { class: 'stack' },
      el('div', { class: 'grid-2' },
        el('label', { class: 'field' }, el('span', {}, 'Distance (km)'), km),
        el('label', { class: 'field' }, el('span', {}, 'Time (min)'), min),
      ),
      el('div', { class: 'field' }, el('span', {}, 'How did it feel?'), feelPicker(feel, (v) => (feel = v))),
      el('label', { class: 'field' }, el('span', {}, 'Notes'), notes),
      el('button', { class: 'btn primary wide', onclick: async () => {
        if (!km.value) return toast('Enter the distance');
        try {
          const s = await api('POST', '/api/sessions', { date: localToday(), dayKey: d.key });
          await api('POST', `/api/sessions/${s.id}/finish`, { feel, notes: notes.value, distanceKm: Number(km.value), durationMin: min.value ? Number(min.value) : null });
          closeSheet();
          S.doneSummary = { title: d.title, changes: [], sets: 0, text: `${km.value} km${min.value ? ` in ${min.value} min` : ''} logged.` };
          await loadToday();
          render();
        } catch (e) { toast(e.message); }
      } }, 'Log run'),
    );
  }

  // ----- History -----
  async function renderHistory(view) {
    if (!S.history) {
      view.append(el('div', { class: 'empty' }, 'Loading…'));
      S.history = await api('GET', '/api/history?limit=60');
      return render();
    }
    const { sessions, bests } = S.history;
    const bestIds = Object.keys(bests);
    if (bestIds.length) {
      view.append(el('div', { class: 'card' }, el('div', { class: 'eyebrow' }, 'Best sets'), el('div', { class: 'bests' }, bestIds.map((id) => {
        const name = sessions.flatMap((s) => s.sets).find((s) => s.exerciseId === id)?.exerciseName ?? id;
        return el('div', { class: 'best' }, el('div', { class: 'v' }, `${bests[id].weight > 0 ? kg(bests[id].weight) : 'bw'} × ${bests[id].reps}`), el('div', { class: 'k' }, name));
      }))));
    }
    const workouts = S.history.workouts ?? [];
    if (workouts.length) {
      const ZONES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
      view.append(el('div', { class: 'card' }, el('div', { class: 'eyebrow' }, 'Apple Watch'), el('div', { class: 'list' }, workouts.map((w) => {
        const z = w.analysis?.minutesPerZone;
        const total = z ? z.reduce((a, b) => a + b, 0) : 0;
        const meta = [w.durationMin ? `${Math.round(w.durationMin)} min` : null, w.distanceKm ? `${w.distanceKm} km` : null, w.avgHr ? `avg ${w.avgHr}` : null, w.maxHr ? `max ${w.maxHr}` : null, w.kcal ? `${Math.round(w.kcal)} kcal` : null].filter(Boolean).join(' · ');
        return el('div', { class: 'item', style: 'display:grid' },
          el('div', { class: 'item-main' },
            el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:baseline' }, el('div', { class: 'item-title' }, `${fmtDate(w.date)} · ${w.type}`), el('span', { class: `pill ${w.analysis?.intensity === 'hard' ? 'accent' : w.analysis?.intensity === 'easy' ? 'good' : ''}` }, w.analysis?.intensity ?? '–')),
            el('div', { class: 'item-sub num' }, meta),
            z && total > 0 ? el('div', { class: 'zones' }, z.map((m, i) => el('span', { class: `zone z${i + 1}`, style: `flex:${Math.max(m, 0.01)}`, title: `${ZONES[i]} ${m} min` }))) : null,
            z && total > 0 ? el('div', { class: 'item-sub num' }, z.map((m, i) => `${ZONES[i]} ${Math.round(m)}′`).join(' · ')) : null,
          ),
        );
      }))));
    }
    if (!sessions.length) return view.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'No sessions yet. Today is a good day.')));
    view.append(el('div', { class: 'card' }, el('div', { class: 'eyebrow' }, 'Sessions'), el('div', { class: 'list' }, sessions.map((s) => {
      const byEx = new Map();
      for (const st of s.sets) { if (!byEx.has(st.exerciseName)) byEx.set(st.exerciseName, []); byEx.get(st.exerciseName).push(st.weight > 0 ? `${st.reps}×${st.weight}` : `${st.reps}`); }
      const sub = s.type === 'run' ? `${s.distanceKm ?? '?'} km${s.durationMin ? ` · ${s.durationMin} min` : ''}` : [...byEx].map(([n, v]) => `${n} ${v.join(' ')}`).join(' · ');
      return el('div', { class: 'item' },
        el('div', { class: 'item-main' }, el('div', { class: 'item-title' }, `${fmtDate(s.date)} · ${s.dayKey === 'R' ? 'Run' : s.dayKey === 'T' ? 'Travel' : s.dayKey === 'H' ? 'Home' : `Lift ${s.dayKey}`}`), el('div', { class: 'item-sub' }, sub || 'no sets'), s.notes ? el('div', { class: 'item-sub' }, `“${s.notes}”`) : null),
        s.feel ? el('span', { class: 'pill' }, `${s.feel}/5`) : null,
      );
    }))));
  }

  // ----- Check-in -----
  async function renderCheckin(view) {
    if (!S.checkins) {
      view.append(el('div', { class: 'empty' }, 'Loading…'));
      S.checkins = (await api('GET', '/api/checkins')).checkins;
      return render();
    }
    const w = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: S.checkins[0] ? String(S.checkins[0].weightKg) : '70.0', id: 'checkin-weight' });
    const notes = el('input', { type: 'text', placeholder: 'Optional note', id: 'checkin-notes' });
    view.append(el('div', { class: 'card' },
      el('div', { class: 'eyebrow' }, 'Weekly weigh-in'),
      el('p', { class: 'muted small' }, 'Monday morning, after the bathroom, before breakfast. Same conditions every week; the trend matters, not the number.'),
      el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Weight (kg)'), w), el('label', { class: 'field' }, el('span', {}, 'Note'), notes)),
      el('button', { class: 'btn primary wide', onclick: async () => {
        if (!w.value) return toast('Enter your weight');
        try {
          await api('POST', '/api/checkins', { date: localToday(), weightKg: Number(w.value), notes: notes.value });
          S.checkins = null;
          toast('Saved');
          render();
        } catch (e) { toast(e.message); }
      } }, 'Save weigh-in'),
    ));
    if (S.checkins.length) {
      view.append(el('div', { class: 'card' }, el('div', { class: 'eyebrow' }, 'Trend'), el('div', { class: 'list' }, S.checkins.map((c, i) => {
        const prev = S.checkins[i + 1];
        const delta = prev ? (c.weightKg - prev.weightKg) : null;
        return el('div', { class: 'item' },
          el('div', { class: 'item-main' }, el('div', { class: 'item-title num' }, `${c.weightKg.toFixed(1)} kg`), el('div', { class: 'item-sub' }, `${fmtDate(c.date)}${c.notes ? ` · ${c.notes}` : ''}`)),
          delta != null ? el('span', { class: `pill num${Math.abs(delta) < 0.05 ? '' : ''}` }, `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`) : null,
        );
      }))));
    }
  }

  // ----- Food -----
  async function renderFood(view) {
    if (!S.foodDate) S.foodDate = localToday();
    if (!S.foodDay || S.foodDay.date !== S.foodDate || !S.quick) {
      view.append(el('div', { class: 'empty' }, 'Loading…'));
      [S.foodDay, S.quick] = await Promise.all([api('GET', `/api/food?date=${S.foodDate}`), S.quick ?? api('GET', '/api/food/favorites')]);
      return render();
    }
    const d = S.foodDay;
    const t = d.targets;
    const bar = (label, val, target, unit) => el('div', { class: 'total-row' },
      el('div', { class: 'total-head' }, el('span', {}, label), el('b', {}, `${Math.round(val)} / ${target} ${unit}`)),
      el('div', { class: `bar${val > target * 1.1 ? ' over' : ''}` }, el('i', { style: `width:${Math.min(100, (val / target) * 100)}%` })),
    );
    view.append(el('div', { class: 'card' },
      el('div', { class: 'datebar' },
        el('button', { class: 'btn ghost', onclick: () => { S.foodDate = addDays(S.foodDate, -1); render(); } }, '‹'),
        el('div', { class: 'label' }, S.foodDate === localToday() ? 'Today' : fmtDate(S.foodDate)),
        el('button', { class: 'btn ghost', disabled: S.foodDate >= localToday(), onclick: () => { S.foodDate = addDays(S.foodDate, 1); render(); } }, '›'),
      ),
      el('div', { class: 'totals' }, bar('Calories', d.totals.kcal, t.kcal, 'kcal'), bar('Protein', d.totals.proteinG, t.proteinG, 'g')),
    ));

    const quickAdd = async (m) => {
      try {
        await api('POST', '/api/food', { date: S.foodDate, text: m.text, kcal: m.kcal, proteinG: m.proteinG });
        S.foodDay = null;
        S.quick = null;
        toast(`Added ${m.name ?? m.text}`);
        render();
      } catch (e) { toast(e.message); }
    };
    const favTexts = new Set(S.quick.favorites.map((f) => f.text));
    const recent = S.quick.recent.filter((r) => !favTexts.has(r.text));
    if (S.quick.favorites.length || recent.length) {
      const chips = el('div', { class: 'chips' });
      for (const f of S.quick.favorites) {
        chips.append(el('button', { class: 'chip fav', title: `${f.text} · ${Math.round(f.kcal)} kcal · ${Math.round(f.proteinG)} g`, onclick: () => S.editFavorites
          ? api('DELETE', `/api/food/favorites/${f.id}`).then(() => { S.quick = null; render(); })
          : quickAdd(f) },
          el('span', { class: 'chip-star' }, S.editFavorites ? '✕' : '★'), el('span', {}, f.name), el('small', { class: 'num' }, `${Math.round(f.kcal)}`)));
      }
      for (const r of recent) {
        chips.append(el('button', { class: 'chip', title: `${Math.round(r.kcal)} kcal · ${Math.round(r.proteinG)} g`, onclick: () => quickAdd(r) },
          el('span', {}, r.text.length > 34 ? `${r.text.slice(0, 32)}…` : r.text), el('small', { class: 'num' }, `${Math.round(r.kcal)}`)));
      }
      view.append(el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('div', { class: 'eyebrow' }, 'Quick add'),
          S.quick.favorites.length ? el('button', { class: 'btn ghost small-btn', onclick: () => { S.editFavorites = !S.editFavorites; render(); } }, S.editFavorites ? 'Done' : 'Edit favorites') : null),
        el('p', { class: 'small muted' }, S.editFavorites ? 'Tap a favorite to remove it.' : 'Tap to add to this day. ★ favorites first, then recent meals.'),
        chips,
      ));
    }

    const text = el('textarea', { id: 'food-text', placeholder: d.estimator ? 'e.g. 2 eggs, 2 slices of bread with cheese, a glass of milk' : 'What did you eat?' });
    const kcal = el('input', { type: 'number', inputmode: 'numeric', placeholder: 'kcal', id: 'food-kcal' });
    const prot = el('input', { type: 'number', inputmode: 'numeric', placeholder: 'g protein', id: 'food-protein' });
    const manual = el('div', { class: 'grid-2', hidden: d.estimator && !S.estimate }, el('label', { class: 'field' }, el('span', {}, 'Calories'), kcal), el('label', { class: 'field' }, el('span', {}, 'Protein (g)'), prot));
    const preview = el('div', { class: 'stack', hidden: true });
    if (S.estimate) {
      kcal.value = Math.round(S.estimate.kcal);
      prot.value = Math.round(S.estimate.proteinG);
      text.value = S.estimate.text;
      preview.hidden = false;
      preview.append(el('div', { class: 'list' }, S.estimate.items.map((it) => el('div', { class: 'item' }, el('div', { class: 'item-main' }, el('div', { class: 'item-title' }, it.name)), el('span', { class: 'pill num' }, `${Math.round(it.kcal)} kcal · ${Math.round(it.proteinG)} g`)))));
      if (S.estimate.note) preview.append(el('p', { class: 'small muted' }, S.estimate.note));
      manual.hidden = false;
    }
    const save = async () => {
      if (!kcal.value) return toast('Estimate first or enter calories');
      try {
        await api('POST', '/api/food', { date: S.foodDate, text: text.value, kcal: Number(kcal.value), proteinG: Number(prot.value || 0) });
        S.estimate = null;
        S.foodDay = null;
        toast('Saved');
        render();
      } catch (e) { toast(e.message); }
    };
    const estimateBtn = el('button', { class: 'btn', onclick: async () => {
      if (!text.value.trim()) return toast('Describe the meal first');
      estimateBtn.disabled = true;
      estimateBtn.textContent = 'Estimating…';
      try {
        const r = await api('POST', '/api/food/estimate', { text: text.value });
        S.estimate = { ...r, text: text.value };
        render();
      } catch (e) {
        toast(e.status === 503 ? 'Estimator unavailable, enter the numbers by hand.' : e.message);
        manual.hidden = false;
        estimateBtn.disabled = false;
        estimateBtn.textContent = 'Estimate';
      }
    } }, 'Estimate');
    view.append(el('div', { class: 'card' },
      el('div', { class: 'eyebrow' }, 'Add a meal'),
      !d.estimator ? el('div', { class: 'banner' }, 'The estimator is off: no Claude token on the server yet. Until then, enter calories and protein by hand.') : null,
      el('label', { class: 'field' }, el('span', {}, 'What did you eat?'), text),
      preview,
      manual,
      el('div', { class: 'row' },
        d.estimator ? estimateBtn : null,
        !d.estimator || S.estimate ? el('button', { class: 'btn primary', onclick: save }, 'Save meal') : el('button', { class: 'btn ghost', onclick: () => { manual.hidden = false; manual.after(el('button', { class: 'btn primary wide', onclick: save }, 'Save meal')); } }, 'Enter by hand'),
      ),
    ));
    if (d.entries.length) {
      view.append(el('div', { class: 'card' }, el('div', { class: 'eyebrow' }, 'Logged'), el('div', { class: 'list' }, d.entries.map((e) => el('div', { class: 'item' },
        el('div', { class: 'item-main' }, el('div', { class: 'item-title' }, e.text), el('div', { class: 'item-sub num' }, `${Math.round(e.kcal)} kcal · ${Math.round(e.proteinG)} g protein`)),
        el('div', { class: 'row-tight' },
          favTexts.has(e.text) ? el('span', { class: 'pill accent' }, '★') : el('button', { class: 'icon-btn', 'aria-label': 'Save as favorite', onclick: () => favoriteSheet(e) }, '☆'),
          el('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: async () => { await api('DELETE', `/api/food/${e.id}`); S.foodDay = null; S.quick = null; render(); } }, '✕'),
        ),
      )))));
    }
  }

  function favoriteSheet(entry) {
    const name = el('input', { type: 'text', id: 'fav-name', value: entry.text.length > 24 ? entry.text.slice(0, 24) : entry.text, maxlength: '60' });
    openSheet(
      el('h2', {}, 'Save as favorite'),
      el('p', { class: 'small muted' }, `${entry.text} · ${Math.round(entry.kcal)} kcal · ${Math.round(entry.proteinG)} g protein`),
      el('label', { class: 'field' }, el('span', {}, 'Name'), name),
      el('button', { class: 'btn primary wide', onclick: async () => {
        try {
          await api('POST', '/api/food/favorites', { name: name.value, text: entry.text, kcal: entry.kcal, proteinG: entry.proteinG });
          closeSheet();
          S.quick = null;
          toast('Favorite saved');
          render();
        } catch (e) { toast(e.message); }
      } }, 'Save'),
    );
    setTimeout(() => name.select(), 50);
  }

  // ----- Coach -----
  async function renderCoach(view) {
    if (!S.coach) {
      view.append(el('div', { class: 'empty' }, 'Loading…'));
      S.coach = await api('GET', '/api/coach');
      return render();
    }
    const btn = el('button', { class: 'btn wide', disabled: !S.coach.enabled, onclick: async () => {
      btn.disabled = true;
      btn.textContent = 'Reviewing… this takes a minute';
      try {
        await api('POST', '/api/coach/review', { date: localToday() });
        S.coach = null;
        render();
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Review this week now'; }
    } }, 'Review this week now');
    view.append(el('div', { class: 'card' },
      el('div', { class: 'eyebrow' }, 'Coach'),
      el('p', { class: 'muted small' }, S.coach.enabled ? 'Every Sunday evening the coach reads the week and writes a note here. Weights are progressed by the rules, not by the note.' : 'The coach is off: no ANTHROPIC_API_KEY on the server.'),
      btn,
    ));
    if (S.coach.proposals?.length) {
      const act = async (id, action) => {
        try {
          await api('POST', `/api/coach/proposals/${id}/${action}`);
          toast(action === 'apply' ? 'Applied' : 'Dismissed');
          S.coach = null;
          S.today = null;
          await loadSettings();
          await loadToday();
          render();
        } catch (e) { toast(e.message); }
      };
      view.append(el('div', { class: 'card' },
        el('div', { class: 'eyebrow' }, 'Proposed changes'),
        el('p', { class: 'small muted' }, 'The coach suggests these. Nothing changes until you apply it.'),
        el('div', { class: 'list' }, S.coach.proposals.map((p) => el('div', { class: 'item', style: 'display:grid' },
          el('div', { class: 'item-main' }, el('div', { class: 'item-title' }, p.text), el('div', { class: 'item-sub' }, p.proposal.reason)),
          el('div', { class: 'row' }, el('button', { class: 'btn ghost', onclick: () => act(p.id, 'dismiss') }, 'Dismiss'), el('button', { class: 'btn primary', onclick: () => act(p.id, 'apply') }, 'Apply')),
        ))),
      ));
    }
    if (!S.coach.notes.length) view.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'No notes yet.')));
    for (const n of S.coach.notes) {
      view.append(el('div', { class: 'card' },
        el('div', { class: 'note-head' }, el('h3', {}, `Week of ${fmtDate(n.weekStart)}`), el('span', { class: 'small muted' }, new Date(n.createdAt).toLocaleDateString('en-GB'))),
        el('div', { class: 'note' }, n.text),
      ));
    }
  }

  // ----- Settings -----
  function settingsSheet() {
    const s = S.settings;
    const voice = el('input', { type: 'checkbox', checked: !!s.voice, id: 'set-voice' });
    const ha = el('input', { type: 'checkbox', checked: !!s.haAnnounce, disabled: !S.health?.ha, id: 'set-ha' });
    const kcal = el('input', { type: 'number', value: s.targets?.kcal ?? 2600, id: 'set-kcal' });
    const prot = el('input', { type: 'number', value: s.targets?.proteinG ?? 140, id: 'set-protein' });
    const maxHr = el('input', { type: 'number', value: s.maxHr ?? 191, id: 'set-maxhr' });
    const athlete = el('textarea', { id: 'set-athlete', placeholder: 'Age, height, weight, goals, training history, where you live (for portion sizes)…' });
    athlete.value = s.athlete ?? '';
    const from = el('input', { type: 'date', value: s.holiday?.from ?? '', id: 'set-hol-from' });
    const to = el('input', { type: 'date', value: s.holiday?.to ?? '', id: 'set-hol-to' });
    openSheet(
      el('h2', {}, 'Settings'),
      el('label', { class: 'toggle' }, el('span', {}, 'Voice cues from the phone'), voice),
      el('label', { class: 'toggle' }, el('span', {}, S.health?.ha ? 'Announce on the Home Assistant speaker' : 'Home Assistant speaker (not configured on the server)'), ha),
      el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Calories / day'), kcal), el('label', { class: 'field' }, el('span', {}, 'Protein g / day'), prot)),
      el('label', { class: 'field' }, el('span', {}, 'About you, for the coach and the food estimator'), athlete),
      el('label', { class: 'field' }, el('span', {}, 'Max heart rate (for zones)'), maxHr),
      el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Holiday from'), from), el('label', { class: 'field' }, el('span', {}, 'Holiday to'), to)),
      el('p', { class: 'small muted' }, 'During a holiday, lift days become a bodyweight travel session.'),
      el('button', { class: 'btn primary wide', onclick: async () => {
        try {
          S.settings = await api('PUT', '/api/settings', {
            voice: voice.checked,
            haAnnounce: ha.checked,
            targets: { kcal: Number(kcal.value), proteinG: Number(prot.value) },
            maxHr: Number(maxHr.value),
            athlete: athlete.value,
            holiday: from.value && to.value ? { from: from.value, to: to.value } : null,
          });
          closeSheet();
          S.foodDay = null;
          await loadToday();
          render();
          toast('Settings saved');
        } catch (e) { toast(e.message); }
      } }, 'Save'),
      el('p', { class: 'small muted' }, `Restbell ${S.health?.version ?? ''} · ${S.queue.length} unsent`),
    );
  }
  $('#btn-settings').addEventListener('click', () => S.settings && settingsSheet());

  // ---------- tabs ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    S.tab = b.dataset.tab;
    if (S.tab === 'history') S.history = null;
    if (S.tab === 'checkin') S.checkins = null;
    if (S.tab === 'coach') S.coach = null;
    if (S.tab === 'food') S.foodDay = null;
    render();
    window.scrollTo(0, 0);
  });

  async function refreshToday() {
    await loadToday();
    render();
  }

  // ---------- boot ----------
  async function boot() {
    try {
      S.health = await api('GET', '/api/health');
      const auth = await api('GET', '/api/auth');
      if (auth.enabled && !auth.ok) return showLogin();
      await flushQueue();
      await Promise.all([loadSettings(), loadToday()]);
      render();
    } catch (e) {
      if (e.message !== 'login required') {
        $('#view').replaceChildren(el('div', { class: 'card' }, el('p', {}, 'Cannot reach the server.'), el('p', { class: 'muted small' }, e.message), el('button', { class: 'btn', onclick: boot }, 'Retry')));
      }
    }
  }
  window.addEventListener('online', () => flushQueue().then(() => S.tab === 'today' && refreshToday()));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.tab === 'today' && !S.session) refreshToday().catch(() => {}); });
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  boot();
})();
