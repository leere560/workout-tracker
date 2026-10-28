const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

function setup(dayIndex = 0) {
  let now = Date.parse('2026-10-28T17:00:00Z'), failKey = null;
  const values = new Map(), handlers = new Map(), elements = new Map();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (key === failKey) { failKey = null; throw Error('Quota exceeded'); } values.set(key, String(value)); },
    removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() { return values.size; }
  };
  const classList = { add() {}, remove() {} };
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', style: {}, classList, addEventListener: (name, fn) => handlers.set(id + ':' + name, fn), click() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    console, localStorage, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    document: { addEventListener() {}, getElementById: element, querySelector: () => ({ click() {} }), body: { classList } },
    window: {}, setInterval: () => 1, clearInterval() {}, confirm: () => true, alert() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App=WorkoutApp;', context);
  const App = context.App, app = Object.create(App.prototype);
  const keys = ['routine', 'history', 'lastWeights', 'routineRev', 'machineSettings', 'exerciseNotes', 'exercisePreferences', 'wakeLockEnabled', 'deloadActive', 'deloadStartDate', 'lastBackupTime', 'timerTargetEnd', 'timerTotalDuration'];
  app.storageKeys = Object.fromEntries(keys.map(key => [key, key]));
  app.storageKeys.currentSessionPrefix = 'gym_session_'; app.storageKeys.legacyCurrentSession = 'legacy';
  Object.assign(app, {
    routine: vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context), activeDayIndex: dayIndex, history: [], lastWeights: {},
    machineSettings: {}, exerciseNotes: {}, exercisePreferences: {}, deloadActive: false, deloadStartDate: 0, wakeLockEnabled: true,
    activeView: 'workout', collapsedCards: new Set(), timer: { active: true, targetEndTime: now + 125000, remaining: 125, intervalId: 1 },
    timerDockEl: { classList }, summaryContentEl: element('summaryContent'), summaryModalEl: element('summaryModal'),
    sessionInfoEl: { innerHTML: '', querySelector: () => null }, exerciseListEl: { innerHTML: '', querySelector: () => null }
  });
  for (const method of ['renderWorkout', 'render', 'renderAnalytics', 'bindWorkoutCardEvents', 'updateNowLiftingHUD', 'triggerHaptic', 'primeAudioContext', 'restoreActiveTimer', 'jumpToActiveExercise', 'revealWorkoutSet']) app[method] = () => {};
  app.timerCalls = []; app.startTimer = (...args) => app.timerCalls.push(args);
  app.showToast = message => { app.toast = message; };
  app.session = app.initNewSession(dayIndex); app.saveCurrentSession();
  const day = app.routine[dayIndex], ex = day.exercises[0];
  const complete = (index = 0, exercise = ex, weight = 100, reps = 8) => {
    Object.assign(app.session.logs[exercise.id][index], { completed: true, weight, reps, completedAt: new context.Date().toISOString(), rirAnswered: true });
    app.session.startTime ||= new context.Date(now - 42000).toISOString(); app.saveCurrentSession();
  };
  return { app, App, ex, day, values, complete, handlers, advance: () => { now += 60000; }, failOnce: key => { failKey = key; } };
}

test('skip and restore preserve pending inputs, record activity, and never start or change rest', () => {
  const { app, ex, advance } = setup();
  const row = app.session.logs[ex.id][0]; row.weight = null; row.reps = '';
  const before = clone(row), timer = clone(app.timer), initialLogs = clone(app.session.initialLogs);
  assert.equal(app.setSetSkipped(ex.id, 0, true), true);
  assert.deepEqual(clone(row), { ...before, skipped: true });
  assert.equal(app.session.startTime, null); assert.ok(app.session.lastInteractionAt);
  assert.deepEqual(clone(app.timer), timer); assert.equal(app.timerCalls.length, 0);
  assert.deepEqual(clone(app.session.initialLogs), initialLogs);
  assert.equal(app.getNextSet().setIdx, 1);
  const activity = app.session.lastInteractionAt; advance();
  assert.equal(app.setSetSkipped(ex.id, 0, true), false); assert.equal(app.session.lastInteractionAt, activity);
  app.toggleSetCompletion(ex.id, 0); assert.equal(row.completed, false);
  assert.equal(app.setSetSkipped(ex.id, 0, false), true); assert.deepEqual(clone(row), before);
  assert.notEqual(app.session.lastInteractionAt, activity); assert.deepEqual(clone(app.timer), timer);
  assert.equal(app.getNextSet().setIdx, 0);
});

test('skip remaining exercise preserves completed work, warmups, order, and its partner', () => {
  const { app, day, complete } = setup(1);
  const ex = day.exercises.find(item => item.superset), partner = day.exercises.find(item => item.id !== ex.id && item.superset?.id === ex.superset.id);
  complete(0, ex); app.session.logs[ex.id][0].rir = 1;
  app.session.warmups[ex.id] = [{ weight: 30, reps: 10, completed: true }, { weight: null, reps: '', completed: false }];
  const completed = clone(app.session.logs[ex.id][0]), warmup = clone(app.session.warmups[ex.id][0]);
  const other = clone(app.session.logs[partner.id]), order = clone(app.session.exerciseOrder), routine = clone(app.routine), timer = clone(app.timer);
  assert.equal(app.setExerciseSkipped(ex.id, true), true);
  assert.deepEqual(clone(app.session.logs[ex.id][0]), completed); assert.deepEqual(clone(app.session.warmups[ex.id][0]), warmup);
  assert.ok(app.session.logs[ex.id].slice(1).every(set => set.skipped)); assert.equal(app.session.warmups[ex.id][1].skipped, true);
  assert.deepEqual(clone(app.session.logs[partner.id]), other); assert.deepEqual(clone(app.session.exerciseOrder), order);
  assert.deepEqual(clone(app.routine), routine); assert.deepEqual(clone(app.timer), timer);
  assert.equal(app.setSetSkipped(ex.id, 0, true), false);
  assert.equal(app.setExerciseSkipped(ex.id, false), true);
  assert.ok(app.session.logs[ex.id].every(set => !set.skipped)); assert.ok(app.session.warmups[ex.id].every(set => !set.skipped));
  assert.deepEqual(clone(app.session.logs[ex.id][0]), completed);
});

test('superset guidance skips only the selected member and keeps all partner sets in order', () => {
  const { app, day } = setup(1);
  const ex = day.exercises.find(item => item.superset), partner = day.exercises.find(item => item.id !== ex.id && item.superset?.id === ex.superset.id);
  day.exercises.filter(item => ![ex.id, partner.id].includes(item.id)).forEach(item => app.setExerciseSkipped(item.id, true));
  const rest = app.getRestSeconds(partner);
  app.setSetSkipped(ex.id, 0, true); assert.equal(app.getNextSet().ex.id, partner.id); assert.equal(app.getNextSet().setIdx, 0);
  app.session.logs[partner.id][0].completed = true; assert.equal(app.getNextSet().ex.id, ex.id); assert.equal(app.getNextSet().setIdx, 1);
  app.setExerciseSkipped(ex.id, true);
  for (let idx = 1; idx < app.session.logs[partner.id].length; idx++) {
    assert.equal(app.getNextSet().ex.id, partner.id); assert.equal(app.getNextSet().setIdx, idx); app.session.logs[partner.id][idx].completed = true;
  }
  assert.equal(app.getNextSet(), null); assert.equal(app.getRestSeconds(partner), rest);
  assert.equal(app.isSupersetEnabled(ex), true); assert.equal(app.canDeferExercise(ex.id), false);
});

test('skipped exercises are bypassed by machine deferral and return when restored', () => {
  const { app, day, ex } = setup(); const other = day.exercises[1];
  app.setExerciseSkipped(other.id, true); assert.equal(app.deferExercise(ex.id), true);
  assert.notEqual(app.getNextSet().ex.id, other.id);
  day.exercises.filter(item => item.id !== other.id).forEach(item => app.setExerciseSkipped(item.id, true));
  assert.equal(app.getNextSet(), null); assert.equal(app.getDeferTargetGroup(ex.id), null);
  app.setExerciseSkipped(other.id, false); assert.equal(app.getNextSet().ex.id, other.id);
});

test('skips cannot edit completed rows and storage failures roll back data, focus, and timers', () => {
  const { app, ex, complete, values, failOnce } = setup(); complete();
  const before = clone(app.session), saved = [...values.entries()], timer = clone(app.timer);
  app.focusedExerciseId = ex.id; app.editingCompletedSet = { exId: ex.id, setIdx: 0 };
  assert.equal(app.setSetSkipped(ex.id, 0, true), false);
  failOnce('gym_last_active_day_v1'); assert.equal(app.setExerciseSkipped(ex.id, true), false);
  assert.deepEqual(clone(app.session), before); assert.deepEqual([...values.entries()], saved); assert.deepEqual(clone(app.timer), timer);
  assert.equal(app.focusedExerciseId, ex.id); assert.deepEqual(app.editingCompletedSet, { exId: ex.id, setIdx: 0 });
  app.setSetSkipped(ex.id, 1, true); const skipped = clone(app.session); failOnce(app.getSessionKey(app.session.dayId));
  assert.equal(app.setSetSkipped(ex.id, 1, false), false); assert.deepEqual(clone(app.session), skipped);
});

test('completed effort stays visible when the final prescribed rows are skipped', () => {
  const { app, App, ex, complete } = setup(); complete(); delete app.session.logs[ex.id][0].rirAnswered;
  app.setExerciseSkipped(ex.id, true); App.prototype.renderWorkout.call(app);
  assert.equal(app.pendingRir.exId, ex.id); assert.equal(app.pendingRir.setIdx, 0);
  assert.match(app.exerciseListEl.innerHTML, /Reps left in reserve/);
  const skippedMarkup = app.renderSkippedSet(ex.id, app.session.logs[ex.id][1], 1);
  assert.match(skippedMarkup, /Restore set 2/); assert.doesNotMatch(skippedMarkup, /rir-chip|set-check-btn|set-input/);
  app.pendingRir = null; app.session.logs[ex.id][0].rirAnswered = true; App.prototype.renderWorkout.call(app);
  assert.equal(app.pendingRir, null);
});

test('finishing the last available working set retains effort when later sets were skipped', () => {
  const { app, ex } = setup(); app.setSetSkipped(ex.id, 1, true); app.setSetSkipped(ex.id, 2, true);
  app.toggleSetCompletion(ex.id, 0);
  assert.equal(app.pendingRir.setIdx, 0); assert.equal(app.pendingRir.exId, ex.id); assert.equal(app.timerCalls.length, 1);
});

test('all-skipped workouts stay recoverable drafts and never become completed history', () => {
  const { app, App, day, values } = setup();
  day.exercises.forEach(ex => app.setExerciseSkipped(ex.id, true));
  assert.equal(app.getNextSet(), null); assert.equal(app.hasSessionProgress(app.session), true);
  const before = clone(app.session); app.showWorkoutSummary(); app.finishSession();
  assert.equal(app.history.length, 0); assert.deepEqual(clone(app.session), before);
  App.prototype.renderWorkout.call(app); assert.match(app.exerciseListEl.innerHTML, /No working sets logged/);
  assert.doesNotMatch(app.exerciseListEl.innerHTML, /review-finish-btn|All sets complete/);
  assert.match(app.sessionInfoEl.innerHTML, /skipped · 0 remaining/);
  assert.ok(JSON.parse(values.get(app.getSessionKey(day.id))).logs[day.exercises[0].id][0].skipped);
});

test('finish review and archived totals distinguish skipped sets from actual work', () => {
  const { app, day, ex, complete } = setup(); complete(0, ex, 100, 8);
  app.session.logs[ex.id][1].weight = null; app.session.logs[ex.id][1].reps = '';
  day.exercises.forEach(item => app.setExerciseSkipped(item.id, true));
  const counts = clone(app.getWorkingSetCounts()); assert.equal(counts.completed, 1); assert.equal(counts.remaining, 0);
  app.showWorkoutSummary(); assert.match(app.summaryContentEl.innerHTML, new RegExp(`1 sets completed · ${counts.skipped} skipped · 0 remaining`));
  assert.doesNotMatch(app.summaryContentEl.innerHTML, /Finish early/);
  assert.equal(app.finishSession(), true); const record = app.history[0];
  assert.equal(record.totalCompletedSets, 1); assert.equal(record.totalVolume, 800); assert.equal(record.exercises[ex.name].sets.length, 1);
  assert.equal(app.getPreviousProgressionFlag(ex.name, ex.targetReps, ex.sets, ex).unlocked, false);
  assert.match(app.summaryContentEl.innerHTML, /Skipped sets do not count/);
  assert.match(app.renderHistoryCard(record), /Skipped for this workout/); assert.match(app.renderHistoryCard(record), /Set 2/);
  assert.equal(app.calculateWeeklyVolume().completed.Chest.direct, 1);
});

test('skipping a middle set preserves its original position in history, targets and Last labels', () => {
  const { app, ex, complete } = setup(); complete(0, ex, 100, 6); complete(2, ex, 80, 10); app.setSetSkipped(ex.id, 1, true);
  assert.equal(app.finishSession(), true); const record = app.history[0];
  assert.deepEqual(Array.from(record.exercises[ex.name].sets, set => set.setNum), [1, 3]);
  assert.equal(app.getSetTarget(ex, 0).targetReps, 7);
  assert.equal(app.getSetTarget(ex, 1).targetReps, app.getMinTargetReps(ex.targetReps));
  assert.equal(app.getPreviousSetAt(record.exercises[ex.name].sets, 1), undefined);
  assert.equal(app.getPreviousSetAt(record.exercises[ex.name].sets, 2).weight, 80);
  app.activeDayIndex = 0; app.session = app.initNewSession(0);
  const html = app.renderExerciseCard(ex, false);
  assert.match(html, /aria-label="Set 2">[\s\S]*?Last: No previous set/);
  assert.match(html, /aria-label="Set 3">[\s\S]*?Last: 80 lb × 10/);
});

test('legacy unnumbered history keeps positional targets and legacy cards never borrow current skips', () => {
  const { app, ex } = setup();
  const sets = [{ weight: 90, reps: 6, completed: true }, { weight: 80, reps: 7, completed: true }];
  app.history = [{ id: 'legacy', date: '2026-10-20T17:00:00Z', exercises: { [ex.name]: { sets } } }];
  assert.equal(app.getSetTarget(ex, 1).targetWeight, 80); assert.equal(app.getSetTarget(ex, 1).targetReps, 8);
  app.setSetSkipped(ex.id, 0, true); assert.doesNotMatch(app.renderHistoryCard(app.history[0]), /skipped|Skipped/);
});

test('warmup skips do not block guidance and the final restored warmup uses regular rest', () => {
  const { app, ex } = setup(1); app.addWarmupSets(ex.id); app.setExerciseSkipped(ex.id, true);
  assert.equal(app.getNextWarmup(ex.id), null); assert.equal(app.getWarmupWorkingSet(ex.id), null); assert.equal(app.addWarmupSets(ex.id), false);
  app.setSetSkipped(ex.id, 0, false); app.setSetSkipped(ex.id, 0, false, 'warmup');
  assert.equal(app.getNextWarmup(ex.id).setIdx, 0);
  assert.equal(app.toggleWarmupCompletion(ex.id, 0), true);
  assert.deepEqual(app.timerCalls.at(-1), [app.getRestSeconds(ex), 120]);
  assert.equal(app.getNextWarmup(ex.id), null); assert.equal(app.getNextSet().type, 'working');
  assert.equal(app.toggleWarmupCompletion(ex.id, 1), false);
});

test('equipment swaps retain skip status and recoverable skipped warmups', () => {
  const { app, ex } = setup(); app.addWarmupSets(ex.id); app.setExerciseSkipped(ex.id, true);
  const warmups = clone(app.session.warmups[ex.id]);
  app.applyExerciseSwap(ex.id, { name: 'Temporary machine', muscle: 'Chest', targetReps: '8–12' }, 'today');
  assert.ok(app.session.logs[ex.id].every(set => set.skipped));
  assert.deepEqual(clone(app.session.warmups[ex.id]), warmups); assert.equal(app.getNextWarmup(ex.id), null);
  app.setExerciseSkipped(ex.id, false);
  assert.equal(app.session.warmups[ex.id][0].exerciseName, ex.name); assert.equal(app.getNextWarmup(ex.id).setIdx, 0);
});

test('changing the first load does not silently overwrite skipped set inputs', () => {
  const { app, ex } = setup(); app.session.logs[ex.id][1].weight = 77; app.setSetSkipped(ex.id, 1, true);
  app.updateSetWeight(ex.id, 0, 130); assert.equal(app.session.logs[ex.id][1].weight, 77); assert.equal(app.session.logs[ex.id][2].weight, 130);
});

test('skips survive reload, retained drafts, backups and reopening; new workouts reset them', () => {
  const { app, ex, complete } = setup(); complete(); app.addWarmupSets(ex.id); app.setExerciseSkipped(ex.id, true);
  const original = clone(app.session); assert.deepEqual(clone(app.loadSession(0).logs), original.logs);
  const backup = clone(app.createBackupData()); assert.doesNotThrow(() => app.validateBackup(backup));
  assert.equal(backup.sessions[0].logs[ex.id][1].skipped, true);
  assert.equal(app.startNewSession(), true); assert.ok(app.session.logs[ex.id].every(set => !set.skipped));
  const draftId = app.getSessionResumeInfo().savedDraftId; assert.equal(draftId, original.id);
  assert.equal(app.createBackupData().savedDrafts[0].logs[ex.id][1].skipped, true);
  assert.equal(app.restoreSavedDraft(draftId), true); assert.deepEqual(clone(app.session.logs), original.logs);
  assert.equal(app.finishSession(), true); const record = app.history[0];
  assert.equal(record.sessionSnapshot.logs[ex.id][1].skipped, true);
  assert.equal(app.reopenWorkout(record.id), true); assert.deepEqual(clone(app.session.logs), original.logs);
  assert.deepEqual(clone(app.session.warmups), original.warmups);
});

