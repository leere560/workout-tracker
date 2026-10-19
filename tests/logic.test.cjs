const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DEFAULT_ROUTINE } = require('../routine-data.js');

function harness() {
  let now = 1000000;
  const values = new Map();
  const classList = { add() {}, remove() {} };
  const skip = {};
  const context = {
    document: { addEventListener() {}, body: { classList }, getElementById: () => skip },
    window: {}, console,
    Date: class extends Date { static now() { return now; } },
    localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) },
    setInterval: () => 1, clearInterval() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + '\nglobalThis.App = WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, {
    history: [], lastWeights: {}, exercisePreferences: {}, routine: JSON.parse(JSON.stringify(DEFAULT_ROUTINE)),
    activeDayIndex: 0, session: null, deloadActive: false, collapsedCards: new Set(),
    storageKeys: { timerTargetEnd: 'end', timerTotalDuration: 'total' },
    timer: { active: false, intervalId: null, totalDuration: 120, remaining: 0 },
    timerDockEl: { classList }, timerDisplayEl: {}, timerProgressBarEl: { style: {} },
    activeView: 'workout', wakeLockEnabled: true,
  });
  for (const method of ['saveCurrentSession', 'renderWorkout', 'updateNowLiftingHUD', 'showToast', 'primeAudioContext', 'triggerHaptic', 'requestWakeLock', 'releaseWakeLock', 'requestNotificationPermission', 'playTimerAlarm', 'showRestCompleteBanner', 'saveRoutine']) app[method] = () => {};
  app.session = app.initNewSession(0);
  return { app, values, skip, advance: seconds => { now += seconds * 1000; } };
}

test('every straight rest is at least two minutes and seated curl superset is 75 seconds', () => {
  const { app } = harness();
  for (const day of app.routine) for (const ex of day.exercises) {
    assert.ok(ex.restSeconds >= 120);
    assert.equal(ex.rest, app.formatRest(ex.restSeconds));
    if (ex.superset) {
      assert.equal(ex.superset.rest, app.formatRest(ex.superset.restSeconds) === '1 min' ? '60 sec' : app.formatRest(ex.superset.restSeconds));
      app.session.disabledSupersets[ex.superset.id] = true;
      assert.equal(app.getRestSeconds(ex), ex.restSeconds);
      delete app.session.disabledSupersets[ex.superset.id];
    }
  }
  const curl = app.routine[1].exercises.find(ex => ex.name === 'Seated Leg Curl');
  assert.equal(app.getRestSeconds(curl), 75);
});

test('guidance alternates pairs, handles uneven counts, undone and out-of-order sets', () => {
  const { app } = harness();
  app.activeDayIndex = 4;
  app.session = app.initNewSession(4);
  const pair = app.routine[4].exercises.filter(ex => ex.superset);
  for (const ex of app.routine[4].exercises) if (!ex.superset) app.session.logs[ex.id].forEach(s => s.completed = true);
  const order = [];
  let next;
  while ((next = app.getNextSet())) {
    order.push(`${next.ex.id}:${next.setIdx}`);
    app.session.logs[next.ex.id][next.setIdx].completed = true;
  }
  assert.deepEqual(order, [0, 1, 2].flatMap(i => pair.map(ex => `${ex.id}:${i}`)).concat(`${pair[1].id}:3`));
  app.session.logs[pair[0].id][0].completed = false;
  app.session.logs[pair[1].id][1].completed = false;
  assert.equal(app.getNextSet().ex.id, pair[0].id);
  app.session.logs[pair[0].id][0].completed = true;
  assert.equal(app.getNextSet().setIdx, 1);
});

test('disabled supersets use straight-set guidance', () => {
  const { app } = harness();
  const pair = app.routine[0].exercises.filter(ex => ex.superset);
  for (const ex of app.routine[0].exercises) if (!ex.superset) app.session.logs[ex.id].forEach(s => s.completed = true);
  app.session.disabledSupersets[pair[0].superset.id] = true;
  app.session.logs[pair[0].id][0].completed = true;
  assert.equal(app.getNextSet().ex.id, pair[0].id);
  assert.equal(app.getNextSet().setIdx, 1);
});

test('progression respects selected increments and ignores deload records', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  app.history = [
    { date: '2026-10-01', exercises: { [ex.name]: { sets: Array.from({length: 3}, () => ({weight: 100, reps: 8, completed: true})) } } },
    { date: '2026-10-08', deload: true, exercises: { [ex.name]: { sets: [{weight: 90, reps: 6, completed: true}] } } },
  ];
  app.exercisePreferences[ex.name] = { increment: 2.5 };
  assert.equal(app.getSetTarget(ex, 0).targetWeight, 102.5);
  assert.equal(app.getPreviousProgressionFlag(ex.name, ex.targetReps, 3, ex).increment, 2.5);
  app.deloadActive = true;
  assert.equal(app.getSetTarget(ex, 0).isProgressionIncrease, false);
});

test('swaps preserve completed identity and require an unrelated machine baseline', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  const originalName = ex.name;
  app.session.logs[ex.id][0].completed = true;
  app.applyExerciseSwap(ex.id, { name: 'Different chest machine', targetReps: '6–8' }, 'today');
  const logs = app.session.logs[ex.id];
  assert.equal(logs[0].exerciseName, originalName);
  assert.equal(logs[1].exerciseName, 'Different chest machine');
  assert.equal(logs[1].weight, null);
  assert.equal(logs[1].needsBaseline, true);
  app.toggleSetCompletion(ex.id, 1);
  assert.equal(logs[1].completed, false);
  app.applyExerciseSwap(ex.id, { name: 'Third chest machine' }, 'permanent');
  assert.equal(logs[0].exerciseName, originalName);
  assert.equal(app.getSetTarget(ex, 0).targetWeight, null);
});

test('swaps use their own historical load', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  app.history = [{ exercises: { 'Alternative press': { sets: [{weight: 35, reps: 7, completed: true}] } } }];
  app.applyExerciseSwap(ex.id, {name: 'Alternative press'}, 'today');
  assert.equal(app.session.logs[ex.id][0].weight, 35);
  assert.equal(app.session.logs[ex.id][0].needsBaseline, false);
});

test('permanent swaps update routine muscle but preserve completed set muscle and rep targets', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  const original = { name: ex.name, muscle: ex.muscle, targetReps: ex.targetReps };
  app.toggleSetCompletion(ex.id, 0);
  app.applyExerciseSwap(ex.id, { name: 'Alternative shoulder press', muscle: 'Shoulders', targetReps: '10–12' }, 'permanent');
  const [completed, pending] = app.session.logs[ex.id];
  assert.equal(ex.muscle, 'Shoulders');
  assert.equal(ex.targetReps, '10–12');
  assert.equal(completed.exerciseName, original.name);
  assert.equal(completed.muscle, original.muscle);
  assert.equal(completed.targetReps, original.targetReps);
  assert.equal(pending.muscle, 'Shoulders');
  assert.equal(pending.targetReps, '10–12');
  const nextSession = app.initNewSession(0);
  assert.equal(nextSession.logs[ex.id][0].muscle, 'Shoulders');
  assert.equal(nextSession.logs[ex.id][0].targetReps, '10–12');
  assert.deepEqual(nextSession.initialLogs, nextSession.logs);
  assert.notEqual(nextSession.initialLogs[ex.id], nextSession.logs[ex.id]);
});

test('repeated swaps preserve completed rep targets from each equipment choice', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  app.applyExerciseSwap(ex.id, { name: 'Alternative row', muscle: 'Back / Lats', targetReps: '8–10' }, 'today');
  const set = app.session.logs[ex.id][0];
  set.weight = 50;
  set.needsBaseline = false;
  // A legacy set without snapshots is stamped from the active alternative on completion.
  delete set.muscle;
  delete set.targetReps;
  app.toggleSetCompletion(ex.id, 0);
  assert.equal(set.muscle, 'Back / Lats');
  assert.equal(set.targetReps, '8–10');
  app.applyExerciseSwap(ex.id, { name: 'Alternative curl', muscle: 'Biceps', targetReps: '12–15' }, 'permanent');
  assert.equal(set.exerciseName, 'Alternative row');
  assert.equal(set.muscle, 'Back / Lats');
  assert.equal(set.targetReps, '8–10');
  assert.equal(app.session.logs[ex.id][1].targetReps, '12–15');
  assert.equal(ex.muscle, 'Biceps');
});

test('swapping snapshots legacy completed targets before mutating the routine', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  const set = app.session.logs[ex.id][0];
  set.completed = true;
  delete set.targetReps;
  app.applyExerciseSwap(ex.id, { name: 'Another chest press', targetReps: '10–12' }, 'permanent');
  assert.equal(set.targetReps, '6–8');
  assert.equal(ex.targetReps, '10–12');
});

test('final effort stays visible until selected or skipped', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  app.session.logs[ex.id].forEach((s, i) => s.completed = i < 2);
  app.toggleSetCompletion(ex.id, 2);
  assert.equal(app.pendingRir.exId, ex.id);
  assert.equal(app.collapsedCards.has(ex.id), false);
  app.setSetRIR(ex.id, 2, null);
  assert.equal(app.pendingRir, null);
  assert.equal(app.collapsedCards.has(ex.id), true);
});

test('adding sets after a completed exercise is swapped uses the current equipment baseline and identity', () => {
  const { app } = harness();
  const ex = app.routine[0].exercises[0];
  app.session.logs[ex.id].forEach(set => set.completed = true);
  app.applyExerciseSwap(ex.id, { name: 'Alternative shoulder press', muscle: 'Shoulders', targetReps: '10–12' }, 'permanent');
  app.addSetToExercise(ex.id);
  const list = app.session.logs[ex.id];
  const pending = list[list.length - 1];
  assert.equal(pending.weight, null);
  assert.equal(pending.needsBaseline, true);
  assert.equal(pending.exerciseName, 'Alternative shoulder press');
  assert.equal(pending.muscle, 'Shoulders');
  assert.equal(pending.targetReps, '10–12');
  assert.equal(pending.reps, 10);
  pending.weight = 25;
  pending.needsBaseline = false;
  app.addSetToExercise(ex.id);
  assert.equal(list[list.length - 1].weight, 25);
  assert.equal(list[list.length - 1].needsBaseline, false);
  app.applyExerciseSwap(ex.id, { name: 'Alternative row', muscle: 'Back / Lats', targetReps: '8–10' }, 'today');
  app.addSetToExercise(ex.id);
  assert.equal(list[list.length - 1].weight, null);
  assert.equal(list[list.length - 1].exerciseName, 'Alternative row');
  assert.equal(list[list.length - 1].muscle, 'Back / Lats');
  assert.equal(list[list.length - 1].targetReps, '8–10');
});

test('straight timers clamp duration, block early skip, and permit skip after 120 seconds', () => {
  const { app, advance, skip } = harness();
  app.startTimer(180);
  app.adjustTimer(-150);
  assert.equal(app.timer.totalDuration, 120);
  assert.equal(app.skipTimer(), false);
  assert.equal(skip.disabled, true);
  advance(119.9);
  app.tickTimer();
  assert.equal(app.timer.remaining, 1);
  assert.equal(app.skipTimer(), false);
  advance(0.1);
  assert.equal(app.skipTimer(), true);
});

test('superset timers can be shorter; adjustments persist exact countdown end', () => {
  const { app, values, advance } = harness();
  app.startTimer(75, 0);
  advance(30);
  app.adjustTimer(-30);
  assert.equal(app.timer.remaining, 15);
  app.timer.active = false;
  app.syncTimerFromBackground();
  assert.equal(app.timer.remaining, 15);
  assert.equal(app.timer.minimumDuration, 0);
  advance(16);
  app.syncTimerFromBackground();
  assert.equal(app.timer.active, false);
  assert.equal(values.has('end'), false);
});

test('stopping an old timer cannot erase a newer timer in storage', () => {
  const { app, values } = harness();
  app.startTimer(120);
  const newerEnd = app.timer.targetEndTime + 60000;
  values.set('end', String(newerEnd));
  app.stopTimer();
  assert.equal(values.get('end'), String(newerEnd));
});
