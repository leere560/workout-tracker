const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = value => JSON.parse(JSON.stringify(value));
function setup(ids = ['A', 'B', 'C']) {
  const context = vm.createContext({ document: { addEventListener() {} }, window: {}, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App = WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  const exercises = ids.map(id => ({ id, name: id, muscle: 'Quads', sets: 3, targetReps: '6–8', restSeconds: 180 }));
  Object.assign(app, {
    routine: [{ id: 'day', title: 'Day', exercises }], activeDayIndex: 0,
    session: { exerciseOrder: [...ids], logs: Object.fromEntries(ids.map(id => [id, Array.from({ length: 3 }, () => ({ weight: 100, reps: 8, completed: false }))])), warmups: {}, swaps: {}, disabledSupersets: {} },
    timer: { active: true, targetEnd: 12345, remaining: 151 }, pendingRir: { exId: ids[0], setIdx: 0 }, editingCompletedSet: { exId: ids[0], setIdx: 0 },
    history: [], machineSettings: {}, exerciseNotes: {}, exercisePreferences: {}, collapsedCards: new Set(),
    sessionInfoEl: { innerHTML: '', querySelector: () => null }, exerciseListEl: { innerHTML: '' },
  });
  app.saved = [];
  app.saveCurrentSession = () => app.saved.push(clone(app.session));
  app.renderWorkout = () => {};
  app.updateNowLiftingHUD = () => { app.dockTarget = app.getNextSet(); };
  app.jumpToActiveExercise = () => { app.navigationTarget = app.getNextSet(); };
  app.showToast = message => { app.toast = message; };
  app.getSessionResumeInfo = () => ({});
  app.bindWorkoutCardEvents = () => {};
  return { app, exercises, App: context.App };
}

const order = app => Array.from(app.getOrderedExercises(), ex => ex.id);
const groups = app => Array.from(app.getExerciseGroups(), group => Array.from(group, ex => ex.id));
const finish = (app, id) => app.session.logs[id].forEach(set => { set.completed = true; set.rirAnswered = true; });

test('machine taken completes the destination exercise before returning to the deferred exercise', () => {
  const { app } = setup();
  assert.equal(app.deferExercise('A'), true);
  assert.deepEqual(order(app), ['B', 'A', 'C']);
  for (let setIdx = 0; setIdx < 3; setIdx++) {
    assert.equal(app.getNextSet().ex.id, 'B');
    assert.equal(app.getNextSet().setIdx, setIdx);
    assert.equal(app.getNextSet().type, 'working');
    app.session.logs.B[setIdx].completed = true;
  }
  assert.equal(app.getNextSet().ex.id, 'A');
  assert.equal(app.dockTarget.ex.id, 'B');
  assert.equal(app.navigationTarget.ex.id, 'B');
});

test('deferrals preserve partially completed sets, warm-ups, values, and the running timer', () => {
  const { app } = setup();
  Object.assign(app.session.logs.A[0], { completed: true, weight: 135 });
  app.session.logs.A[1].reps = '';
  app.session.warmups.A = [{ weight: 50, reps: 10, completed: true }, { weight: 70, reps: 5, completed: false }];
  const logs = clone(app.session.logs), warmups = clone(app.session.warmups), timer = clone(app.timer);
  app.deferExercise('A');
  assert.deepEqual(clone(app.session.logs), logs);
  assert.deepEqual(clone(app.session.warmups), warmups);
  assert.deepEqual(clone(app.timer), timer);
  assert.equal(app.pendingRir, null);
  assert.equal(app.editingCompletedSet, null);
  assert.equal(app.focusedExerciseId, 'B');
  assert.equal(app.saved.length, 1);
  assert.deepEqual(app.saved[0].exerciseOrder, ['B', 'A', 'C']);
  app.session = clone(app.saved[0]);
  assert.equal(app.getNextSet().ex.id, 'B');
});

test('repeated deferrals swap the immediate unfinished groups and skip completed exercises', () => {
  const { app } = setup(['A', 'B', 'C', 'D']);
  app.deferExercise('A');
  app.deferExercise('B');
  assert.deepEqual(order(app), ['A', 'B', 'C', 'D']);
  finish(app, 'B');
  app.deferExercise('A');
  assert.deepEqual(order(app), ['C', 'A', 'B', 'D']);
  finish(app, 'C');
  assert.equal(app.getNextSet().ex.id, 'A');
});

test('overview deferral and wrapping put the target then current before all other unfinished groups', () => {
  const { app } = setup(['A', 'B', 'C', 'D']);
  finish(app, 'A');
  app.deferExercise('D');
  assert.deepEqual(order(app), ['A', 'B', 'D', 'C']);
  assert.equal(app.getNextSet().ex.id, 'B');
  finish(app, 'B');
  assert.equal(app.getNextSet().ex.id, 'D');
  const other = setup().app;
  other.deferExercise('B');
  assert.deepEqual(order(other), ['C', 'B', 'A']);
  finish(other, 'C');
  assert.equal(other.getNextSet().ex.id, 'B');
});

test('enabled superset members move together and all remaining alternating sets precede the deferred group', () => {
  const { app, exercises } = setup(['A', 'B1', 'B2', 'C']);
  for (const ex of exercises.slice(1, 3)) ex.superset = { id: 'pair', tag: ex.id, restSeconds: 60 };
  app.session.logs.B1[0].completed = true;
  app.session.logs.B2.push({ weight: 80, reps: 10, completed: false });
  app.deferExercise('A');
  assert.deepEqual(order(app), ['B1', 'B2', 'A', 'C']);
  const actual = [];
  while (app.getNextSet()?.ex.id.startsWith('B')) {
    const next = app.getNextSet();
    actual.push(`${next.ex.id}:${next.setIdx}`);
    app.session.logs[next.ex.id][next.setIdx].completed = true;
  }
  assert.deepEqual(actual, ['B2:0', 'B1:1', 'B2:1', 'B1:2', 'B2:2', 'B2:3']);
  assert.equal(app.getNextSet().ex.id, 'A');
  app.deferExercise('A');
  assert.equal(app.getNextSet().ex.id, 'C');
});

test('deferring a superset from either member moves the full pair and disabled pairs move independently', () => {
  const { app, exercises } = setup(['A1', 'A2', 'B', 'C']);
  for (const ex of exercises.slice(0, 2)) ex.superset = { id: 'pair', tag: ex.id, restSeconds: 60 };
  app.deferExercise('A2');
  assert.deepEqual(groups(app), [['B'], ['A1', 'A2'], ['C']]);
  app.session.disabledSupersets.pair = true;
  app.deferExercise('A1');
  assert.deepEqual(groups(app), [['A2'], ['A1'], ['B'], ['C']]);
});

test('the final unfinished group is disabled, including warm-up-only unfinished groups', () => {
  const { app } = setup();
  finish(app, 'B'); finish(app, 'C');
  const before = clone(app.session);
  assert.equal(app.canDeferExercise('A'), false);
  assert.equal(app.canDeferExercise('B'), false);
  assert.equal(app.deferExercise('A'), false);
  assert.deepEqual(clone(app.session), before);
  app.session.warmups.B = [{ completed: false, weight: 50, reps: 10 }];
  assert.equal(app.canDeferExercise('A'), true);
  finish(app, 'A');
  assert.equal(app.canDeferExercise('B'), false);
  assert.equal(app.getDeferTargetGroup('unknown'), null);
});

test('ordering normalizes unknown and duplicate IDs and groups re-enabled supersets without mutating the draft', () => {
  const { app, exercises } = setup(['A', 'B1', 'B2', 'C']);
  for (const ex of exercises.slice(1, 3)) ex.superset = { id: 'pair' };
  app.session.exerciseOrder = ['B1', 'C', 'B1', 'deleted', 'A'];
  const original = clone(app.session);
  assert.deepEqual(order(app), ['B1', 'B2', 'C', 'A']);
  assert.deepEqual(clone(app.session), original);
  delete app.session.exerciseOrder;
  assert.deepEqual(order(app), ['A', 'B1', 'B2', 'C']);
});

test('overview and card position show the same session order and unavailable action has a visible explanation', () => {
  const { app, exercises, App } = setup();
  app.deferExercise('A');
  App.prototype.renderWorkout.call(app);
  const html = app.sessionInfoEl.innerHTML;
  assert.ok(html.indexOf('data-exid="B"') < html.indexOf('data-exid="A"'));
  assert.ok(html.indexOf('data-exid="A"') < html.indexOf('data-exid="C"'));
  assert.match(App.prototype.renderExerciseCard.call(app, exercises[0], false), /Exercise 2 of 3/);
  finish(app, 'B'); finish(app, 'C');
  const card = App.prototype.renderExerciseCard.call(app, exercises[0], false);
  assert.match(card, /machine-taken-btn[^>]*disabled aria-describedby="machineTakenHelp_A"/);
  assert.match(card, /No other unfinished exercise to switch to/);
});
