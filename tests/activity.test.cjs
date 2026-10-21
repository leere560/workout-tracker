const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

function setup() {
  let now = Date.parse('2026-10-21T16:00:00Z'), failKey = null;
  const values = new Map(), handlers = new Map(), elements = new Map();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (key === failKey) { failKey = null; throw Error('Quota'); } values.set(key, String(value)); },
    removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() { return values.size; }
  };
  const classList = {add() {}, remove() {}};
  const element = id => {
    if (!elements.has(id)) elements.set(id, {innerHTML: '', textContent: '', style: {}, classList,
      addEventListener: (event, callback) => handlers.set(`${id}:${event}`, callback)});
    return elements.get(id);
  };
  const context = vm.createContext({console, localStorage,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    document: {addEventListener() {}, getElementById: element, activeElement: null}, window: {}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App=WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  const keys = ['routine', 'history', 'machineSettings', 'exerciseNotes', 'lastWeights', 'exercisePreferences', 'routineRev',
    'wakeLockEnabled', 'deloadActive', 'deloadStartDate', 'lastBackupTime', 'timerTargetEnd', 'timerTotalDuration'];
  Object.assign(app, {
    routine: vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context), activeDayIndex: 0,
    history: [], lastWeights: {}, exercisePreferences: {}, machineSettings: {}, exerciseNotes: {},
    deloadActive: false, deloadStartDate: 0, collapsedCards: new Set(), activeView: 'workout',
    storageKeys: {...Object.fromEntries(keys.map(key => [key, key])), currentSessionPrefix: 'session_', legacyCurrentSession: 'legacy'},
    sessionInfoEl: {querySelector: () => null, querySelectorAll: () => []},
    exerciseListEl: {querySelector: () => null, querySelectorAll: () => []},
    swapModalEl: {classList}, swapModalTitleEl: {}, swapContentEl: {querySelectorAll: () => []},
    summaryModalEl: {classList}, timer: {active: false}
  });
  for (const name of ['renderWorkout', 'render', 'updateNowLiftingHUD', 'jumpToActiveExercise', 'revealWorkoutSet',
    'triggerHaptic', 'primeAudioContext', 'startTimer', 'stopTimer']) app[name] = () => {};
  app.showToast = message => { app.toast = message; };
  app.session = app.initNewSession(0);
  app.saveCurrentSession();
  const ex = app.routine[0].exercises[0];
  return {app, ex, values, handlers, now: () => new Date(now).toISOString(),
    advance: () => { now += 60000; }, failOnce: key => { failKey = key; }};
}

test('new sessions, load, passive saves and backup reads never create workout activity', () => {
  const {app, ex, advance} = setup();
  assert.equal(app.session.lastInteractionAt, null);
  app.session.startTime = '2026-10-19T16:00:00Z';
  app.session.logs[ex.id][0].completed = true;
  advance(); app.saveCurrentSession(); app.createBackupData();
  assert.equal(app.session.lastInteractionAt, null);
  assert.equal(app.loadSession(0).lastInteractionAt, null);
  delete app.session.lastInteractionAt;
  advance(); app.saveCurrentSession();
  assert.equal(app.loadSession(0).lastInteractionAt, undefined);
});

test('working set edits, completion, effort, progression and set count changes record actual activity', () => {
  const {app, ex, advance, now, values} = setup();
  const check = action => {
    advance(); action();
    assert.equal(app.session.lastInteractionAt, now());
    assert.equal(JSON.parse(values.get(app.getSessionKey(app.session.dayId))).lastInteractionAt, now());
  };
  check(() => app.updateSetWeight(ex.id, 0, 155));
  check(() => app.updateSetReps(ex.id, 0, 9));
  check(() => app.toggleSetCompletion(ex.id, 0));
  check(() => app.setSetRIR(ex.id, 0, 2));
  check(() => app.bumpExerciseWeight(ex.id, 5));
  check(() => app.addSetToExercise(ex.id));
  check(() => app.removeLastSetFromExercise(ex.id));
  check(() => app.toggleSetCompletion(ex.id, 0));
  const previous = app.session.lastInteractionAt;
  advance(); app.saveCurrentSession();
  assert.equal(app.session.lastInteractionAt, previous);
});

test('writing unchanged working values or warmups and rejected actions do not refresh activity', () => {
  const {app, ex, advance} = setup();
  app.updateSetWeight(ex.id, 0, 100);
  app.setSetRIR(ex.id, 0, null);
  const previous = app.session.lastInteractionAt;
  advance();
  app.updateSetWeight(ex.id, 0, '100');
  app.updateSetReps(ex.id, 0, String(app.session.logs[ex.id][0].reps));
  app.setSetRIR(ex.id, 0, null);
  app.bumpExerciseWeight(ex.id, 0);
  assert.equal(app.session.lastInteractionAt, previous);
  app.addWarmupSets(ex.id);
  const afterRamp = app.session.lastInteractionAt;
  advance();
  app.addWarmupSets(ex.id);
  app.updateWarmupSet(ex.id, 0, 'weight', String(app.getWarmupSets(ex.id)[0].weight));
  app.removeWarmupSet(ex.id, 99);
  assert.equal(app.session.lastInteractionAt, afterRamp);
});

test('warmups, deferral and superset toggles are activity even before starting working sets', () => {
  const {app, ex, advance, now, handlers} = setup();
  advance(); app.deferExercise(ex.id);
  assert.equal(app.session.lastInteractionAt, now());
  assert.equal(app.session.startTime, null);
  advance(); app.addWarmupSets(ex.id); assert.equal(app.session.lastInteractionAt, now());
  advance(); app.updateWarmupSet(ex.id, 0, 'reps', 11); assert.equal(app.session.lastInteractionAt, now());
  advance(); app.toggleWarmupCompletion(ex.id, 0); assert.equal(app.session.lastInteractionAt, now());
  advance(); app.removeWarmupSet(ex.id, 1); assert.equal(app.session.lastInteractionAt, now());
  const input = {dataset: {group: 'test-pair'}, checked: false, addEventListener: (event, callback) => handlers.set(`superset:${event}`, callback)};
  app.exerciseListEl.querySelectorAll = selector => selector === '.superset-enabled-input' ? [input] : [];
  app.bindWorkoutCardEvents();
  advance(); handlers.get('superset:input')(); assert.equal(app.session.lastInteractionAt, now());
  const previous = app.session.lastInteractionAt;
  advance(); handlers.get('superset:input')(); assert.equal(app.session.lastInteractionAt, previous);
});

test('equipment changes and explicit draft recovery are activity, including original equipment restore', () => {
  const {app, ex, advance, now, handlers, values} = setup();
  const sub = {name: 'Alternate press', muscle: 'Chest', targetReps: '8–12'};
  advance(); app.applyExerciseSwap(ex.id, sub, 'today'); assert.equal(app.session.lastInteractionAt, now());
  const previous = app.session.lastInteractionAt;
  advance(); app.applyExerciseSwap(ex.id, sub, 'today'); assert.equal(app.session.lastInteractionAt, previous);
  app.openSwapModal(ex.id, ex.name);
  advance(); handlers.get('restoreSwapBtn:click')(); assert.equal(app.session.lastInteractionAt, now());
  advance(); app.applyExerciseSwap(ex.id, sub, 'permanent'); assert.equal(app.session.lastInteractionAt, now());
  const draft = clone(app.session);
  draft.id = 'recovered-draft'; draft.lastInteractionAt = '2026-10-19T16:00:00Z';
  values.set('gym_saved_draft_recovered-draft', JSON.stringify(draft));
  app.session = app.initNewSession(0); app.saveCurrentSession();
  advance(); assert.equal(app.restoreSavedDraft('recovered-draft'), true);
  assert.equal(app.session.lastInteractionAt, now());
});

test('failed interaction writes restore activity, workout state, and persisted data', () => {
  for (const action of [
    (app, ex) => app.updateSetWeight(ex.id, 0, 155),
    (app, ex) => app.updateSetReps(ex.id, 0, 11),
    (app, ex) => app.toggleSetCompletion(ex.id, 0),
    (app, ex) => app.addWarmupSets(ex.id),
    (app, ex) => app.deferExercise(ex.id),
    (app, ex) => app.applyExerciseSwap(ex.id, {name: 'Different press'}, 'permanent')
  ]) {
    const {app, ex, values, failOnce, advance} = setup();
    const previous = clone(app.session), routine = clone(app.routine), stored = [...values.entries()];
    advance(); failOnce('gym_last_active_day_v1'); action(app, ex);
    assert.deepEqual(clone(app.session), previous);
    assert.deepEqual(clone(app.routine), routine);
    assert.deepEqual([...values.entries()], stored);
  }
});

test('backup activity is optional or a valid timestamp in current sessions, retained drafts and snapshots', () => {
  const {app} = setup();
  const draft = clone(app.session);
  const backup = {sessions: [clone(draft)], savedDrafts: [clone(draft)], history: [
    {id: 'saved', date: '2026-10-21T16:00:00Z', exercises: {}, sessionSnapshot: clone(draft)}
  ]};
  for (const value of [undefined, null, '2026-10-21T16:00:00.000Z']) {
    for (const session of [backup.sessions[0], backup.savedDrafts[0], backup.history[0].sessionSnapshot]) {
      if (value === undefined) delete session.lastInteractionAt;
      else session.lastInteractionAt = value;
    }
    assert.doesNotThrow(() => app.validateBackup(backup));
  }
  for (const target of ['session', 'draft', 'snapshot']) {
    for (const value of ['', 'invalid', 123, {}, []]) {
      const invalid = clone(backup);
      const session = target === 'session' ? invalid.sessions[0] : target === 'draft' ? invalid.savedDrafts[0] : invalid.history[0].sessionSnapshot;
      session.lastInteractionAt = value;
      assert.throws(() => app.validateBackup(invalid));
    }
  }
});
