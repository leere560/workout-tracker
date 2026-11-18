const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp } = require('./load-app.cjs');

function createHarness() {
  let now = Date.parse('2026-11-18T15:00:00Z');
  let failKey = null;
  let downloaded = null;
  const values = new Map();
  const elements = new Map();
  const handlers = new Map();
  const appendedBody = [];
  const classList = { add() {}, remove() {}, contains() { return false; } };

  const makeEl = (tagName = 'div', id = '') => {
    const el = {
      tagName: tagName.toUpperCase(),
      id,
      innerHTML: '',
      _textContent: '',
      children: [],
      style: {},
      dataset: {},
      className: '',
      classList: {
        _set: new Set(),
        add(...names) { names.forEach(n => this._set.add(n)); },
        remove(...names) { names.forEach(n => this._set.delete(n)); },
        contains(n) { return this._set.has(n); }
      },
      attributes: {},
      open: false,
      hidden: false,
      disabled: false,
      addEventListener(name, fn) {
        handlers.set(`${id || tagName}:${name}`, fn);
      },
      setAttribute(name, val) {
        this.attributes[name] = String(val);
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      contains() { return false; },
      focus() {},
      remove() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      click() { downloaded = this.download || 'clicked'; }
    };
    Object.defineProperty(el, 'textContent', {
      get() { return this._textContent; },
      set(val) { this._textContent = String(val ?? ''); }
    });
    return el;
  };

  const getEl = id => {
    if (!elements.has(id)) elements.set(id, makeEl('div', id));
    return elements.get(id);
  };

  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === failKey) {
        failKey = null;
        throw new Error('Quota exceeded');
      }
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
    key: i => [...values.keys()][i],
    get length() { return values.size; }
  };

  const context = vm.createContext({
    console: { error() {}, log() {}, warn() {}, info() {} },
    localStorage,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } },
    HTMLElement: function HTMLElement() {},
    document: {
      addEventListener() {},
      getElementById: getEl,
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement: tag => makeEl(tag),
      activeElement: null,
      body: {
        classList,
        appendChild(node) { appendedBody.push(node); return node; }
      }
    },
    window: { matchMedia: () => ({ matches: false }) },
    navigator: {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => { throw new Error('Must not use native window.confirm'); },
    alert() {}
  });

  loadApp(context, { includeData: true });
  const app = Object.create(context.App.prototype);
  const keys = [
    'routine', 'history', 'lastWeights', 'routineRev', 'machineSettings',
    'equipmentSettings', 'exerciseNotes', 'exercisePreferences', 'wakeLockEnabled',
    'deloadActive', 'deloadStartDate', 'lastBackupTime', 'timerTargetEnd', 'timerTotalDuration'
  ];
  app.storageKeys = Object.fromEntries(keys.map(k => [k, k]));
  app.storageKeys.currentSessionPrefix = 'gym_session_';
  app.storageKeys.legacyCurrentSession = 'legacy';

  Object.assign(app, {
    routine: vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context),
    history: [],
    lastWeights: {},
    machineSettings: {},
    equipmentSettings: {},
    exerciseNotes: {},
    exercisePreferences: {},
    deloadActive: false,
    deloadStartDate: 0,
    wakeLockEnabled: true,
    activeDayIndex: 0,
    activeView: 'workout',
    selectedProgressExercise: null,
    earlierWorkoutsLimit: 15,
    timer: { active: false, intervalId: null, totalDuration: 120, minimumDuration: 120, remaining: 0, startedAt: 0, targetEndTime: 0, source: null },
    timerDockEl: { classList },
    timerDisplayEl: getEl('timerDisplay'),
    timerProgressBarEl: { style: {} },
    exerciseListEl: getEl('exerciseList'),
    sessionInfoEl: getEl('sessionInfo'),
    analyticsContentEl: getEl('analyticsContent'),
    routineEditorEl: getEl('routineEditor'),
    summaryModalEl: getEl('summaryModal'),
    summaryContentEl: getEl('summaryContent'),
    swapModalEl: getEl('swapModal'),
    swapContentEl: getEl('swapContent'),
    quickHistoryModalEl: getEl('quickHistoryModal'),
    quickHistoryContentEl: getEl('quickHistoryContent'),
    swapModalTitleEl: getEl('swapModalTitle'),
    quickHistoryTitleEl: getEl('quickHistoryTitle'),
    requestWakeLock() {},
    releaseWakeLock() {},
    triggerHaptic() {},
    primeAudioContext() {},
    requestNotificationPermission() {},
    playTimerAlarm() {}
  });
  app.session = app.initNewSession(0);
  app.selectionLocalDate = app.getLocalDateKey(new context.Date());
  app.saveCurrentSession();

  return {
    app, context, values, elements, handlers, appendedBody,
    getEl,
    getDownloaded: () => downloaded,
    resetDownloaded: () => { downloaded = null; },
    failOnce: key => { failKey = key; },
    advanceMs: ms => { now += ms; }
  };
}

test('undo stops only its matching rest timer and preserves manual/other timers', () => {
  const { app } = createHarness();
  const ex = app.routine[0].exercises[0];
  app.session.logs[ex.id][0].weight = 100;
  app.toggleSetCompletion(ex.id, 0);
  assert.equal(app.timer.active, true);
  assert.deepEqual(JSON.parse(JSON.stringify(app.timer.source)), { exId: ex.id, setIdx: 0, type: 'working' });

  // Completing set 1 starts a timer for set 1; undoing set 0 must NOT cancel set 1's timer.
  app.session.logs[ex.id][1].weight = 100;
  app.toggleSetCompletion(ex.id, 1);
  assert.equal(app.timer.source.setIdx, 1);
  app.toggleSetCompletion(ex.id, 0);
  assert.equal(app.timer.active, true);

  // Undoing set 1 itself stops set 1's active timer.
  app.toggleSetCompletion(ex.id, 1);
  assert.equal(app.timer.active, false);

  // Manual rest timer must not be cancelled by undoing a warmup.
  app._pendingTimerSource = { type: 'manual', exId: ex.id };
  app.startTimer(120, 0);
  assert.equal(app.timer.active, true);
  app.addWarmupSets(ex.id);
  app.session.warmups[ex.id][0].completed = true;
  app.toggleWarmupCompletion(ex.id, 0);
  assert.equal(app.timer.active, true);
});

test('warm-up UI shows 90 sec before intermediate warmups and configured rest before working sets', () => {
  const { app } = createHarness();
  const ex = app.routine[0].exercises[0];
  app.session.logs[ex.id][0].weight = 180;
  app.addWarmupSets(ex.id);
  const html = app.renderWarmupSets(ex);
  assert.match(html, /Rest 90 sec/);
  // Mark earlier warmups done so only 1 warmup remains:
  const warmups = app.getWarmupSets(ex.id);
  for (let i = 0; i < warmups.length - 1; i++) warmups[i].completed = true;
  const finalHtml = app.renderWarmupSets(ex);
  assert.match(finalHtml, /Rest 3 min before working sets/);
});

test('-30s timer button disables at minimum duration and Skip reflects dynamic minimum rest', () => {
  const { app, getEl } = createHarness();
  app.startTimer(120, 90);
  app.timer.targetEndTime = app.timer.startedAt + 90 * 1000;
  app.updateTimerUI();
  assert.equal(getEl('timerMinus30Btn').disabled, true);
  assert.equal(getEl('timerSkipBtn').disabled, true);
  assert.match(getEl('timerSkipBtn').title, /90 sec/);
  app.timer.targetEndTime = app.timer.startedAt + 120 * 1000;
  app.updateTimerUI();
  assert.equal(getEl('timerMinus30Btn').disabled, false);
});

test('superset handoff keeps pendingRir visible and advances cleanly once RIR is answered', () => {
  const { app } = createHarness();
  const ssDayIndex = app.routine.findIndex(d => d.exercises.some(e => e.superset));
  const ssDay = app.routine[ssDayIndex];
  app.activeDayIndex = ssDayIndex;
  app.session = app.initNewSession(ssDayIndex);
  const ssEx = ssDay.exercises.find(e => e.superset);
  const ssId = ssEx.superset.id;
  // Mark non-superset exercises before ssEx as completed so ssEx is active
  for (const prior of ssDay.exercises) {
    if (prior.superset?.id === ssId) break;
    (app.session.logs[prior.id] || []).forEach(s => { s.weight = 100; s.completed = true; s.rirAnswered = true; });
  }
  const partner = ssDay.exercises.find(e => e.id !== ssEx.id && e.superset?.id === ssId);
  assert.equal(app.getNextSet().ex.id, ssEx.id);

  app.session.logs[ssEx.id][0].weight = 100;
  app.toggleSetCompletion(ssEx.id, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(app.pendingRir)), { exId: ssEx.id, setIdx: 0 });
  assert.match(app.exerciseListEl.innerHTML, new RegExp(`class="rir-selector-row" data-exid="${ssEx.id}" data-setidx="0"`));

  app.setSetRIR(ssEx.id, 0, 2);
  assert.equal(app.pendingRir, null);
  assert.equal(app.getNextSet().ex.id, partner.id);
});

test('removeLastSetFromExercise blocks completed last set and bumpExerciseWeight affects pending sets only', () => {
  const { app, appendedBody } = createHarness();
  const ex = app.routine[0].exercises[0];
  app.session.logs[ex.id].forEach((s, i) => {
    s.weight = 100;
    s.completed = i === 0 || i === app.session.logs[ex.id].length - 1;
  });
  const countBefore = app.session.logs[ex.id].length;
  assert.equal(app.removeLastSetFromExercise(ex.id), false);
  assert.equal(app.session.logs[ex.id].length, countBefore);
  assert.match(appendedBody.at(-1).children[0].textContent, /Undo the last set/);

  // Only pending middle set should change on weight bump
  app.bumpExerciseWeight(ex.id, 10);
  assert.equal(app.session.logs[ex.id][0].weight, 100);
  assert.equal(app.session.logs[ex.id][1].weight, 110);
  assert.equal(app.session.logs[ex.id][countBefore - 1].weight, 100);

  // When last set is uncompleted, removing succeeds
  app.session.logs[ex.id][countBefore - 1].completed = false;
  assert.equal(app.removeLastSetFromExercise(ex.id), true);
  assert.equal(app.session.logs[ex.id].length, countBefore - 1);
});

test('Adductors volume bucket, Reverse Curl indirect Biceps, Epley 1-rep, deload rounding & bodyweight rules work accurately', () => {
  const { app } = createHarness();
  // Adductors direct volume & Reverse Curl indirect Biceps
  const monday = app.routine.find(d => d.id === 'mon__lower_b');
  const adduction = monday.exercises.find(e => e.name === 'Seated Hip Adduction');
  assert.ok(adduction);
  const vol = app.calculateWeeklyVolume();
  assert.ok(vol.planned.Adductors.direct >= adduction.sets);
  const reverseCredits = app.getExerciseMuscleCredits('Standing Dumbbell Reverse Curl', 'Forearms');
  assert.equal(reverseCredits.direct[0], 'Forearms');
  assert.equal(reverseCredits.indirect.Biceps, 0.5);

  // Epley 1-rep formula returns exact weight
  const pr = app.getPersonalRecord('Test 1RM');
  assert.equal(pr.max1RM, 0);
  app.history = [{
    id: 'w1',
    date: '2026-11-10T12:00:00Z',
    dayTitle: 'Day',
    exercises: { 'Test 1RM': { sets: [{ setNum: 1, weight: 225, reps: 1, completed: true }] } }
  }];
  assert.equal(app.getPersonalRecord('Test 1RM').max1RM, 225);

  // Deload rounding honors 1 lb and 2.5 lb increments
  assert.equal(app.getDeloadRoundedWeight(55, 2.5), 50);
  assert.equal(app.getDeloadRoundedWeight(52.5, 2.5), 47.5);
  assert.equal(app.getDeloadRoundedWeight(21, 1), 19);

  // Bodyweight progression uses reps, never recommends +lb weight increase
  app.history.push({
    id: 'w2',
    date: '2026-11-11T12:00:00Z',
    dayTitle: 'Day',
    exercises: {
      'Hanging Knee Raise': {
        sets: [
          { setNum: 1, weight: 0, reps: 15, completed: true },
          { setNum: 2, weight: 0, reps: 15, completed: true },
          { setNum: 3, weight: 0, reps: 15, completed: true }
        ]
      }
    }
  });
  const bwEx = { id: 'bw1', name: 'Hanging Knee Raise', sets: 3, targetReps: '10–15', increment: 5, startingWeight: '0' };
  const target = app.getSetTarget(bwEx, 0, 'Hanging Knee Raise');
  assert.equal(target.isProgressionIncrease, false);
  assert.equal(target.targetWeight, 0);
  assert.equal(app.getPreviousProgressionFlag('Hanging Knee Raise', '10–15', 3, bwEx).unlocked, false);
});

test('EXERCISE_ALIASES resolves renamed exercises across history, substitutions, and equipment settings', () => {
  const { app } = createHarness();
  app.equipmentSettings = { 'Standing Overhead DB Triceps Extension': 'Seat 2' };
  app.history = [{
    id: 'h_alias',
    date: '2026-11-01T12:00:00Z',
    dayTitle: 'Arms',
    exercises: {
      'Standing Overhead DB Triceps Extension': { sets: [{ setNum: 1, weight: 50, reps: 10, completed: true }] }
    }
  }];
  assert.equal(app.getCanonicalExerciseName('Standing Overhead DB Triceps Extension'), 'Standing / Seated DB Overhead Triceps Extension');
  assert.equal(app.getEquipmentSetting('Standing / Seated DB Overhead Triceps Extension'), 'Seat 2');
  assert.equal(app.getPreviousExercisePerformance('Standing / Seated DB Overhead Triceps Extension').sets[0].weight, 50);
  assert.ok(app.getSubstitutionsForExercise('Standing Overhead DB Press').length > 0);
});

test('showToast renders untrusted strings strictly with textContent and never injects HTML', () => {
  const { app, appendedBody } = createHarness();
  app.showToast('<img src=x onerror=alert(1)><b>Unsafe</b>');
  const toastEl = appendedBody.at(-1);
  assert.equal(toastEl.className, 'app-toast show');
  assert.equal(toastEl.children[0].textContent, '<img src=x onerror=alert(1)><b>Unsafe</b>');
  assert.equal(toastEl.innerHTML, '');
});

test('resetRoutine handles activeDayIndex >= 5 and rolls back cleanly on storage quota errors', () => {
  const { app, values, failOnce } = createHarness();
  app.activeDayIndex = 5;
  app.routine.push({
    id: 'onetime_test',
    title: 'Extra',
    oneTime: true,
    exercises: [{ id: 'ot_ex', name: 'Custom Curl', muscle: 'Biceps', sets: 2, targetReps: '8–12', restSeconds: 120, increment: 5 }]
  });
  app.session = app.initNewSession(5);
  app.session.logs.ot_ex[0].weight = 35;
  app.session.logs.ot_ex[0].completed = true;

  // Fail transaction -> memory and routine unchanged
  failOnce(app.storageKeys.routineRev);
  assert.equal(app.resetRoutine({ skipConfirm: true }), false);
  assert.equal(app.routine.length, 6);

  // Succeed -> activeDayIndex clamps to default bounds and draft retained
  assert.equal(app.resetRoutine({ skipConfirm: true }), true);
  assert.equal(app.routine.length, 5);
  assert.equal(app.activeDayIndex, 4);
  assert.ok(app.getSavedDrafts().some(d => d.session.dayId === 'onetime_test'));
  assert.equal(values.get(app.storageKeys.routineRev), app.CURRENT_ROUTINE_REV);
});

test('deleteWorkoutFromHistory updates baselines transactionally and rolls back on failure', () => {
  const { app, failOnce } = createHarness();
  app.history = [
    {
      id: 'old_w',
      date: '2026-11-01T12:00:00Z',
      dayTitle: 'Upper A',
      totalVolume: 800,
      exercises: { 'Smith Machine Incline Chest Press': { sets: [{ setNum: 1, weight: 100, reps: 8, completed: true }] } }
    },
    {
      id: 'new_w',
      date: '2026-11-08T12:00:00Z',
      dayTitle: 'Upper A',
      totalVolume: 880,
      exercises: { 'Smith Machine Incline Chest Press': { sets: [{ setNum: 1, weight: 110, reps: 8, completed: true }] } }
    }
  ];
  app.lastWeights = app.buildLastWeightsFromHistory(app.history);

  failOnce(app.storageKeys.lastWeights);
  assert.equal(app.deleteWorkoutFromHistory('new_w', { skipConfirm: true }), false);
  assert.equal(app.history.length, 2);
  assert.equal(app.lastWeights['Smith Machine Incline Chest Press'].sets[0].weight, 110);

  assert.equal(app.deleteWorkoutFromHistory('new_w', { skipConfirm: true }), true);
  assert.equal(app.history.length, 1);
  assert.equal(app.lastWeights['Smith Machine Incline Chest Press'].sets[0].weight, 100);
});

test('Routine Editor adds, edits, pairs supersets, reorders, removes exercises, and rolls back on failure', () => {
  const { app, failOnce } = createHarness();
  const dayId = app.routine[0].id;
  const origCount = app.routine[0].exercises.length;

  assert.equal(app.saveRoutineExercise(dayId, null, { name: 'Cable Fly', muscle: 'Chest', sets: 3, targetReps: '12–15', restSeconds: 120, increment: 5 }), true);
  assert.equal(app.routine[0].exercises.length, origCount + 1);
  const added = app.routine[0].exercises[origCount];
  assert.ok(app.session.logs[added.id]);

  // Move up then edit & pair with first exercise
  assert.equal(app.moveRoutineExercise(dayId, added.id, -1), true);
  assert.equal(app.routine[0].exercises[origCount - 1].id, added.id);
  const partnerId = app.routine[0].exercises[0].id;
  assert.equal(app.saveRoutineExercise(dayId, added.id, { name: 'Pec Deck Fly', muscle: 'Chest', sets: 4, targetReps: '10–12', restSeconds: 120, increment: 5, partnerId, supersetRestSeconds: 60 }), true);
  assert.ok(app.routine[0].exercises.find(e => e.id === added.id).superset);
  assert.equal(app.session.logs[added.id].length, 4);

  // Storage failure on delete keeps exercise intact
  failOnce(app.storageKeys.routine);
  assert.equal(app.deleteRoutineExercise(dayId, added.id, { skipConfirm: true }), false);
  assert.equal(app.routine[0].exercises.length, origCount + 1);

  // Deleting removes exercise and cleans lone superset partner
  assert.equal(app.deleteRoutineExercise(dayId, added.id, { skipConfirm: true }), true);
  assert.equal(app.routine[0].exercises.length, origCount);
  assert.equal(app.routine[0].exercises.find(e => e.id === partnerId).superset, null);
});

test('One-Time Builder creates, dismisses with draft preservation, and syncs dismissedOneTimeIds in backups', () => {
  const { app, values } = createHarness();
  const pick = app.routine[0].exercises[0];
  assert.equal(app.createCustomOneTimeWorkout({ title: 'Bonus Pump', replacesDayIds: [app.routine[1].id], exercises: [pick] }), true);
  const otDay = app.routine.find(d => d.oneTime);
  assert.ok(otDay);
  assert.equal(app.session.dayId, otDay.id);

  // Log progress before dismissing
  const otExId = otDay.exercises[0].id;
  app.session.logs[otExId][0].weight = 95;
  app.session.logs[otExId][0].completed = true;
  assert.equal(app.dismissOneTimeWorkout(otDay.id), true);
  assert.equal(values.get(`gym_onetime_done_${otDay.id}`), '1');
  assert.equal(app.routine.some(d => d.id === otDay.id), false);
  assert.ok(app.getSavedDrafts().some(d => d.session.dayId === otDay.id));

  const backup = app.createBackupData();
  assert.ok(backup.dismissedOneTimeIds.includes(otDay.id));

  // Importing backup on clean state preserves dismissal marker
  const { app: cleanApp, values: cleanValues } = createHarness();
  const plan = cleanApp.prepareBackupImport({ ...backup, dismissedOneTimeIds: ['ot_remote'] });
  assert.equal(cleanApp.applyBackupImport(plan), true);
  assert.equal(cleanValues.get('gym_onetime_done_ot_remote'), '1');
});

test('exportHistoryCsv quotes CSV fields properly and backup reminder enforces thresholds', () => {
  const { app, values, getDownloaded } = createHarness();
  app.history = [
    {
      id: 'h1',
      date: '2026-11-01T12:00:00Z',
      dayTitle: 'Upper "A", Heavy',
      deload: true,
      exercises: { 'Chest, Press': { sets: [{ setNum: 1, weight: 120, reps: 8, rir: 2 }] } }
    },
    { id: 'h2', date: '2026-11-05T12:00:00Z', dayTitle: 'Day 2', exercises: {} }
  ];
  const csv = app.exportHistoryCsv();
  assert.match(csv, /Date,Day,Deload,Exercise,Set,Weight \(lb\),Reps,RIR/);
  assert.match(csv, /2026-11-01,"Upper ""A"", Heavy",Yes,"Chest, Press",1,120,8,2/);
  assert.match(getDownloaded(), /\.csv$/);

  // < 3 workouts -> no reminder
  assert.equal(app.getBackupReminderInfo().shouldRemind, false);
  // 3 workouts with no export -> remind
  app.history.push({ id: 'h3', date: '2026-11-10T12:00:00Z', dayTitle: 'Day 3', exercises: {} });
  assert.equal(app.getBackupReminderInfo().shouldRemind, true);
  // Recent export -> no reminder
  values.set(app.storageKeys.lastBackupTime, String(Date.parse('2026-11-15T12:00:00Z')));
  assert.equal(app.getBackupReminderInfo(Date.parse('2026-11-18T12:00:00Z')).shouldRemind, false);
  // >= 14 days old -> remind
  assert.equal(app.getBackupReminderInfo(Date.parse('2026-11-30T12:00:00Z')).shouldRemind, true);
});

test('SVG chart, trend badges, open details preservation, and Earlier Workouts pagination render cleanly', () => {
  const h = createHarness();
  // Create 18 saved sessions to exercise label thinning + Earlier Workouts pagination
  h.app.history = Array.from({ length: 18 }, (_, i) => ({
    id: `hist_${i}`,
    date: new Date(Date.UTC(2026, 9, i + 1, 12)).toISOString(),
    dayTitle: 'Upper A',
    totalCompletedSets: 3,
    totalVolume: 2000,
    exercises: { 'Smith Machine Incline Chest Press': { sets: [{ setNum: 1, weight: 100 + i * 5, reps: 8, rir: 2, completed: true }] } }
  }));

  h.app.renderAnalytics();
  const initialHtml = h.getEl('analyticsContent').innerHTML;
  assert.match(initialHtml, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(initialHtml, /class="trend-badge trend-up"/);
  assert.match(initialHtml, /Earlier workouts \(17\)/);
  assert.match(initialHtml, /show-more-workouts-btn/);
  assert.match(initialHtml, /2 RIR/);
  assert.match(initialHtml, /<th scope="row">Adductors<\/th>/);

  // Count thinned x-axis labels in the SVG chart (font-size="8.5")
  const xLabels = initialHtml.match(/font-size="8\.5"/g) || [];
  assert.ok(xLabels.length <= 6 && xLabels.length >= 2);

  // Preserve open <details> state when switching lifts
  h.getEl('analyticsContent').querySelectorAll = () => [];
  const liftDetails = { open: true };
  h.getEl('analyticsContent').querySelector = sel => sel === '#liftTrendDetails' ? liftDetails : null;
  h.app.renderAnalytics();
  assert.match(h.getEl('analyticsContent').innerHTML, /id="liftTrendDetails" class="insight-details" open/);
});
