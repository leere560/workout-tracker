const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const clone = value => JSON.parse(JSON.stringify(value));

function setup(dayIndex = 1) {
  const values = new Map();
  let failKey = null;
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (key === failKey) { failKey = null; throw Error('Quota'); } values.set(key, String(value)); },
    removeItem: key => values.delete(key)
  };
  const context = vm.createContext({document: {addEventListener() {}}, localStorage, Date, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App=WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, {
    routine: vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context), activeDayIndex: dayIndex,
    history: [], lastWeights: {}, exercisePreferences: {}, deloadActive: false, activeView: 'workout',
    storageKeys: {currentSessionPrefix: 'session_', legacyCurrentSession: 'legacy'}, exerciseListEl: {querySelector: () => null},
    toast: '', timerCalls: [], renderCount: 0
  });
  app.showToast = message => { app.toast = message; };
  app.startTimer = (...args) => app.timerCalls.push(args);
  app.renderWorkout = () => app.renderCount++;
  for (const method of ['updateNowLiftingHUD', 'jumpToActiveExercise', 'triggerHaptic']) app[method] = () => {};
  app.session = app.initNewSession(dayIndex);
  app.saveCurrentSession();
  const ex = app.routine[dayIndex].exercises[0];
  return {app, ex, values, failOnce: key => { failKey = key; }};
}

test('warm-up ramp uses configured increments, is capped and cannot duplicate working logs', () => {
  const {app, ex} = setup();
  app.exercisePreferences[ex.name] = {increment: 2.5};
  app.session.logs[ex.id][0].weight = 125;
  const originalLogs = clone(app.session.logs);
  assert.equal(app.addWarmupSets(ex.id), true);
  assert.deepEqual(clone(app.getWarmupSets(ex.id)).map(set => [set.weight, set.reps]), [[62.5, 10], [87.5, 5], [107.5, 2]]);
  assert.deepEqual(clone(app.session.logs), originalLogs);
  assert.equal(app.addWarmupSets(ex.id), false);
  assert.equal(app.getWarmupSets(ex.id).length, 3);
  app.session.warmups[ex.id] = [];
  app.session.logs[ex.id].forEach(set => { set.weight = 7; });
  app.exercisePreferences[ex.name].increment = 10;
  assert.equal(app.addWarmupSets(ex.id), true);
  assert.ok(app.getWarmupSets(ex.id).every(set => set.weight <= 7 && set.weight >= 0));
});

test('warmup numbers remain stable after removal and unsafe stored numbers cannot render markup', () => {
 const {app,ex}=setup();app.addWarmupSets(ex.id);app.removeWarmupSet(ex.id,1);
 assert.equal(app.getWarmupNumber(app.getWarmupSets(ex.id)[1],1),3);
 app.session.warmups[ex.id][0].setNum='<img src=x onerror=alert(1)>';
 const html=app.renderWarmupSets(ex);assert.doesNotMatch(html,/<img|onerror/);assert.match(html,/Warm-up 1/);
});

test('warm-up generation requires the current equipment to have a positive valid working load', () => {
  const {app, ex} = setup();
  for (const weight of [null, '', 0, -10, 'invalid']) {
    app.session.logs[ex.id].forEach(set => { set.weight = weight; });
    assert.equal(app.addWarmupSets(ex.id), false);
  }
  app.session.logs[ex.id][0] = {exerciseName: ex.name, weight: 200, reps: 8, completed: true};
  app.session.swaps[ex.id] = {name: 'New cable equipment'};
  app.session.logs[ex.id].slice(1).forEach(set => { set.exerciseName = 'New cable equipment'; set.weight = null; });
  assert.equal(app.addWarmupSets(ex.id), false);
  app.session.logs[ex.id][1].weight = 50;
  assert.equal(app.addWarmupSets(ex.id), true);
  assert.ok(app.getWarmupSets(ex.id).every(set => set.exerciseName === 'New cable equipment' && set.weight <= 50));
});

test('warm-up completion validates edits and uses 90 seconds before final configured rest', () => {
  const {app, ex} = setup();
  assert.match(ex.name, /Hack Squat/);
  app.addWarmupSets(ex.id);
  for (const reps of ['', 0, -1, 2.5]) {
    assert.equal(app.updateWarmupSet(ex.id, 0, 'reps', reps), true);
    assert.equal(app.toggleWarmupCompletion(ex.id, 0), false);
    assert.equal(app.getWarmupSets(ex.id)[0].completed, false);
  }
  app.updateWarmupSet(ex.id, 0, 'reps', 10);
  app.updateWarmupSet(ex.id, 0, 'weight', -5);
  assert.equal(app.toggleWarmupCompletion(ex.id, 0), false);
  app.updateWarmupSet(ex.id, 0, 'weight', 0);
  assert.equal(app.toggleWarmupCompletion(ex.id, 0), true);
  assert.deepEqual(app.timerCalls.at(-1), [90, 90]);
  app.toggleWarmupCompletion(ex.id, 1);
  assert.deepEqual(app.timerCalls.at(-1), [90, 90]);
  app.toggleWarmupCompletion(ex.id, 2);
  assert.deepEqual(app.timerCalls.at(-1), [180, 120]);
  assert.equal(app.getNextWarmup(ex.id), null);
  assert.equal(app.pendingRir, undefined);
  assert.equal(app.session.logs[ex.id].filter(set => set.completed).length, 0);
});

test('warm-up undo, out-of-order completion and removal choose the remaining ramp correctly', () => {
  const {app, ex} = setup();
  app.addWarmupSets(ex.id);
  app.toggleWarmupCompletion(ex.id, 2);
  assert.deepEqual(app.timerCalls.at(-1), [90, 90]);
  assert.equal(app.removeWarmupSet(ex.id, 2), false);
  app.removeWarmupSet(ex.id, 1);
  assert.equal(app.getNextWarmup(ex.id).setIdx, 0);
  assert.equal(app.getNextWarmup(ex.id).type, 'warmup');
  app.toggleWarmupCompletion(ex.id, 0);
  assert.deepEqual(app.timerCalls.at(-1), [180, 120]);
  app.toggleWarmupCompletion(ex.id, 0);
  assert.equal(app.getNextWarmup(ex.id).setIdx, 0);
  assert.equal(app.getWarmupSets(ex.id)[0].completedAt, undefined);
});

test('warm-up draft edits persist through reload and a fresh workout has no ramp', () => {
  const {app, ex} = setup();
  app.addWarmupSets(ex.id);
  app.updateWarmupSet(ex.id, 1, 'weight', '');
  app.updateWarmupSet(ex.id, 1, 'reps', '');
  app.toggleWarmupCompletion(ex.id, 0);
  const warmups = clone(app.session.warmups);
  app.session = app.loadSession();
  assert.deepEqual(clone(app.session.warmups), warmups);
  assert.equal(app.getWarmupSets(ex.id)[1].weight, null);
  assert.equal(app.getWarmupSets(ex.id)[1].reps, '');
  app.session = app.initNewSession(app.activeDayIndex);
  assert.equal(app.getWarmupSets(ex.id).length, 0);
});

test('warm-up save failure rolls back both memory and storage and cannot start a timer', () => {
  const {app, ex, values, failOnce} = setup();
  app.addWarmupSets(ex.id);
  const before = clone(app.session), stored = [...values.entries()];
  failOnce('gym_last_active_day_v1');
  assert.equal(app.toggleWarmupCompletion(ex.id, 0), false);
  assert.deepEqual(clone(app.session), before);
  assert.deepEqual([...values.entries()], stored);
  assert.equal(app.timerCalls.length, 0);
  assert.match(app.toast, /Could not save/);
});

test('inline rows identify warm-up inputs separately and never render an effort prompt', () => {
  const {app, ex} = setup();
  app.addWarmupSets(ex.id);
  let html = app.renderWarmupSets(ex);
  assert.match(html, /This workout only/);
  assert.match(html, /Complete warm-up/);
  assert.doesNotMatch(html, /rir-selector|set-weight-input|set-reps-input|data-setidx=/);
  app.toggleWarmupCompletion(ex.id, 0);
  html = app.renderWarmupSets(ex);
  assert.match(html, /Completed warm-up 1/);
  assert.match(html, /Edit warm-up 1/);
  assert.match(html, /Undo warm-up 1/);
  app.editingCompletedWarmup = {exId: ex.id, setIdx: 0};
  assert.match(app.renderWarmupSets(ex), /Done editing/);
});
