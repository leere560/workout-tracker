const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = value => JSON.parse(JSON.stringify(value));
const root = path.join(__dirname, '..');
const dayId = 'mon__lower_b';
const revisions = [
  {id: 'mon__lower_b_ex_hip_thrust', oldName: 'Machine Hip Thrust / Glute Drive', oldMuscle: 'Glutes', oldReps: '6–8', oldWeight: 'Light (find weight)', name: 'Barbell Romanian Deadlift', sets: 3, targetReps: '8–10', restSeconds: 180},
  {id: 'mon__lower_b_ex_back_ext', oldName: '45-Degree Back Extension', oldMuscle: 'Glutes / Hamstrings', oldReps: '8–12', oldWeight: 'Bodyweight', name: 'Seated Hip Abduction', sets: 2, targetReps: '12–20', restSeconds: 120},
  {id: 'mon__lower_b_ex6', oldName: "Captain's Chair Knee Raise", oldMuscle: 'Abs / Core', oldReps: '10–12', oldWeight: 'Bodyweight', name: 'Machine Crunch', sets: 3, targetReps: '10–12', restSeconds: 120}
];

function legacyRoutine(defaults) {
  const routine = clone(defaults), monday = routine.find(day => day.id === dayId);
  routine.find(day => day.id === 'sat___upper_b').exercises.forEach(ex => {
    if (['sat___upper_b_ex1', 'sat___upper_b_ex3'].includes(ex.id)) ex.equipmentRepairVersion = 1;
  });
  delete monday.mondayRevision;
  revisions.forEach(change => {
    const ex = monday.exercises.find(item => item.id === change.id);
    Object.assign(ex, {name: change.oldName, muscle: change.oldMuscle, sets: 3, targetReps: change.oldReps,
      startingWeight: change.oldWeight, rest: change.restSeconds === 180 ? '3 min' : '2 min', restSeconds: change.restSeconds,
      notes: `Legacy setup for ${change.oldName}`, increment: change.id.includes('hip_thrust') ? 10 : 5});
    for (const key of ['mondayRevision', 'previousExercise', 'equipmentAlternatives', 'originalExercise', 'needsBaseline']) delete ex[key];
  });
  return routine;
}

function setup() {
  const values = new Map(), elements = new Map();
  let failKey;
  const storage = {getItem: key => values.get(key) ?? null,
    setItem(key, value) {if (key === failKey) {failKey = undefined; throw Error('Quota exceeded');} values.set(key, String(value));},
    removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() {return values.size;}};
  const classList = {add() {}, remove() {}};
  const element = id => {
    if (!elements.has(id)) elements.set(id, {innerHTML: '', textContent: '', style: {}, classList, addEventListener() {}, click() {}, querySelectorAll: () => []});
    return elements.get(id);
  };
  const context = vm.createContext({localStorage: storage, console: {error() {}, log() {}, warn() {}}, Date,
    document: {addEventListener() {}, getElementById: element, querySelector: () => ({click() {}}), body: {classList}},
    window: {}, setInterval: () => 1, clearInterval() {}, confirm: () => true, alert() {}});
  vm.runInContext(fs.readFileSync(path.join(root, 'routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8') + ';globalThis.App=WorkoutApp;', context);
  const defaults = vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context);
  const app = Object.create(context.App.prototype);
  const keys = ['routine', 'routineRev', 'history', 'lastWeights', 'machineSettings', 'equipmentSettings', 'exerciseNotes',
    'exercisePreferences', 'wakeLockEnabled', 'deloadActive', 'deloadStartDate', 'lastBackupTime', 'timerTargetEnd', 'timerTotalDuration'];
  app.storageKeys = Object.fromEntries(keys.map(key => [key, key]));
  app.storageKeys.currentSessionPrefix = 'gym_session_'; app.storageKeys.legacyCurrentSession = 'legacy';
  Object.assign(app, {routine: legacyRoutine(defaults), history: [], lastWeights: {}, machineSettings: {}, equipmentSettings: {},
    exerciseNotes: {}, exercisePreferences: {}, activeDayIndex: defaults.findIndex(day => day.id === dayId),
    deloadActive: false, deloadStartDate: 0, wakeLockEnabled: true, activeView: 'workout', collapsedCards: new Set(),
    timer: {active: false, intervalId: null}, timerDockEl: {classList}, summaryModalEl: element('summaryModal'),
    summaryContentEl: element('summaryContent'), exerciseListEl: {querySelector: () => null}});
  for (const name of ['render', 'renderWorkout', 'renderAnalytics', 'jumpToActiveExercise', 'updateNowLiftingHUD',
    'releaseWakeLock', 'restoreActiveTimer']) app[name] = () => {};
  app.showToast = message => {app.toast = message;};
  values.set('routine', JSON.stringify(app.routine)); values.set('routineRev', '16');
  const oldSession = (id = 'legacy-monday', progressed = false, unnamed = false) => {
    const session = app.initNewSession(app.routine.findIndex(day => day.id === dayId));
    session.id = id; delete session.mondayRevision;
    if (progressed) {
      session.startTime = '2026-10-26T17:00:00.000Z'; session.lastInteractionAt = session.startTime;
      revisions.forEach((change, index) => {
        Object.assign(session.logs[change.id][0], {weight: 50 + index * 10, reps: 8 + index, completed: true, completedAt: session.startTime});
        session.logs[change.id][1].weight = 55 + index * 10;
      });
    }
    if (unnamed) for (const change of revisions) {
      session.logs[change.id].forEach(set => {delete set.exerciseName; delete set.muscle; delete set.targetReps;});
      if (!progressed) session.initialLogs[change.id] = clone(session.logs[change.id]);
    }
    return session;
  };
  const save = (session, key = app.getSessionKey(dayId)) => values.set(key, JSON.stringify(session));
  const upgrade = () => {app.routine = app.loadRoutine(); return app.routine.find(day => day.id === dayId);};
  const stored = key => JSON.parse(values.get(key));
  const snapshot = () => [...values].sort(([a], [b]) => a.localeCompare(b));
  return {app, values, defaults, oldSession, save, upgrade, stored, snapshot, failOnce: key => {failKey = key;}};
}

test('the published program changes only the three authorized Monday prescriptions', () => {
  const {defaults} = setup();
  const original = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/original-program.json'), 'utf8'));
  const expected = clone(original);
  revisions.forEach(change => Object.assign(expected.find(day => day.id === dayId).exercises.find(ex => ex.id === change.id),
    {name: change.name, sets: change.sets, targetReps: change.targetReps}));
  const actual = clone(defaults).map(day => ({id: day.id, title: day.title,
    exercises: day.exercises.map(({id, name, sets, targetReps}) => ({id, name, sets, targetReps}))}));
  assert.deepEqual(actual, expected);
  const monday = defaults.find(day => day.id === dayId);
  for (const change of revisions) {
    const ex = monday.exercises.find(item => item.id === change.id);
    assert.equal(ex.restSeconds, change.restSeconds);
    assert.equal(ex.needsBaseline, true);
  }
  assert.equal(monday.exercises.find(ex => ex.name === 'Horizontal Leg Press').superset.id,
    monday.exercises.find(ex => ex.name === 'Leg Press Calf Press').superset.id);
});

test('saved original Monday defaults upgrade once while unrelated prescriptions remain unchanged', () => {
  const {app, values, upgrade} = setup();
  const before = clone(app.routine), monday = upgrade();
  for (const change of revisions) {
    const ex = monday.exercises.find(item => item.id === change.id);
    assert.equal(ex.name, change.name); assert.equal(ex.sets, change.sets); assert.equal(ex.targetReps, change.targetReps);
    assert.equal(ex.restSeconds, change.restSeconds); assert.equal(ex.needsBaseline, true);
    assert.ok(app.getSubstitutionsForExercise(ex.name, ex).some(option => option.name === change.oldName));
  }
  for (const day of before) {
    if (day.id !== dayId) assert.deepEqual(clone(app.routine.find(item => item.id === day.id)), day);
    else for (const ex of day.exercises.filter(ex => !revisions.some(change => change.id === ex.id)))
      assert.deepEqual(clone(monday.exercises.find(item => item.id === ex.id)), ex);
  }
  assert.equal(values.get('routineRev'), '17');
  const first = JSON.stringify(app.routine); upgrade(); assert.equal(JSON.stringify(app.routine), first);
});

test('custom replacements and deliberate later returns to legacy equipment are preserved', () => {
  const {app, values, upgrade} = setup();
  const ex = app.routine.find(day => day.id === dayId).exercises.find(item => item.id === revisions[0].id);
  Object.assign(ex, {name: 'My custom hinge', sets: 4, targetReps: '5–7', restSeconds: 240, rest: '4 min', notes: 'My custom cue'});
  values.set('routine', JSON.stringify(app.routine)); const monday = upgrade();
  assert.deepEqual(clone(monday.exercises.find(item => item.id === ex.id)), {...clone(ex), mondayRevision: 1});
  const changed = monday.exercises.find(item => item.id === revisions[1].id);
  changed.name = revisions[1].oldName; changed.sets = 4; changed.targetReps = '6–9';
  values.set('routine', JSON.stringify(app.routine)); upgrade();
  assert.equal(app.routine.find(day => day.id === dayId).exercises.find(item => item.id === changed.id).name, revisions[1].oldName);
  assert.equal(app.routine.find(day => day.id === dayId).exercises.find(item => item.id === changed.id).sets, 4);
});

test('untouched drafts regenerate exact new counts and never reuse old-equipment working loads', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  revisions.forEach(change => {app.lastWeights[change.oldName] = {date: '2026-10-20', sets: [{weight: 200, reps: 10, completed: true}]};});
  const old = oldSession(); save(old); const monday = upgrade();
  const updated = stored(app.getSessionKey(dayId));
  for (const change of revisions) {
    assert.equal(updated.logs[change.id].length, change.sets);
    assert.ok(updated.logs[change.id].every(set => set.exerciseName === change.name && set.weight === null && set.needsBaseline));
  }
  assert.deepEqual(updated.logs, updated.initialLogs);
  assert.equal(app.hasSessionProgress(updated), false);
  app.session = updated;
  const fresh = app.initNewSession(app.activeDayIndex);
  assert.equal(fresh.mondayRevision, 1);
  assert.equal(fresh.logs[revisions[1].id].length, monday.exercises.find(ex => ex.id === revisions[1].id).sets);
});

test('recognized legacy equipment retains customized prescriptions while receiving its new default equipment', () => {
  const {app, values, oldSession, save, upgrade, stored} = setup();
  const ex = app.routine.find(day => day.id === dayId).exercises.find(item => item.id === revisions[1].id);
  Object.assign(ex, {sets: 4, targetReps: '5–9', restSeconds: 240, rest: '4 min', increment: 2.5});
  values.set('routine', JSON.stringify(app.routine)); save(oldSession());
  const monday = upgrade(), updated = monday.exercises.find(item => item.id === ex.id);
  assert.equal(updated.name, revisions[1].name);
  assert.equal(updated.sets, 4); assert.equal(updated.targetReps, '5–9');
  assert.equal(updated.restSeconds, 240); assert.equal(updated.increment, 2.5);
  assert.equal(stored(app.getSessionKey(dayId)).logs[ex.id].length, 4);
});

test('new equipment uses only its own history when one already exists', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  app.history = [{id: 'prior-rdl', date: '2026-10-20', exercises: {
    'Barbell Romanian Deadlift': {sets: [{weight: 95, reps: 8, completed: true}]},
    'Machine Hip Thrust / Glute Drive': {sets: [{weight: 250, reps: 8, completed: true}]}
  }}];
  save(oldSession()); upgrade();
  const updated = stored(app.getSessionKey(dayId));
  assert.equal(updated.logs[revisions[0].id][0].weight, 95);
  assert.equal(updated.logs[revisions[1].id][0].weight, null);
  assert.equal(updated.logs[revisions[2].id][0].weight, null);
});

test('progressed current and legacy drafts retain old identities, rows, skips, warmups, and timestamps', () => {
  for (const key of ['gym_session_' + dayId, 'legacy']) {
    const {app, oldSession, save, upgrade, stored} = setup();
    const session = oldSession('progressed', true, true);
    session.logs[revisions[1].id][2].skipped = true;
    session.warmups[revisions[0].id] = [{setNum: 1, weight: 25, reps: 5, completed: true}];
    const before = clone(session); save(session, key); upgrade();
    const updated = stored(key);
    for (const change of revisions) {
      assert.equal(updated.logs[change.id].length, 3);
      assert.ok(updated.logs[change.id].every(set => set.exerciseName === change.oldName));
      assert.deepEqual(updated.logs[change.id].map(set => [set.weight, set.reps, set.completed, set.skipped]),
        before.logs[change.id].map(set => [set.weight, set.reps, set.completed, set.skipped]));
      assert.equal(updated.swaps[change.id].name, change.oldName);
      assert.equal(updated.swaps[change.id].programSets, 3);
    }
    assert.equal(updated.warmups[revisions[0].id][0].exerciseName, revisions[0].oldName);
    assert.equal(updated.lastInteractionAt, before.lastInteractionAt);
    assert.equal(updated.startTime, before.startTime);
    assert.deepEqual(updated.exerciseOrder, before.exerciseOrder);
  }
});

test('activity elsewhere in Monday keeps unstarted affected slots on the original equipment', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  const session = oldSession();
  session.logs.mon__lower_b_ex2[0].completed = true;
  session.startTime = '2026-10-26T17:00:00Z';
  save(session); upgrade();
  const updated = stored(app.getSessionKey(dayId));
  for (const change of revisions) assert.equal(updated.swaps[change.id].name, change.oldName);
  assert.equal(updated.logs[revisions[1].id].length, 3);
});

test('retained drafts are preserved even when their rows are untouched, and later recovery keeps equipment', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  const session = oldSession('saved-untouched', false, true), key = 'gym_saved_draft_saved-untouched';
  save(session, key); upgrade();
  const updated = stored(key);
  for (const change of revisions) {
    assert.equal(updated.logs[change.id].length, 3);
    assert.equal(updated.swaps[change.id].name, change.oldName);
  }
  app.session = app.initNewSession(app.activeDayIndex); app.saveCurrentSession();
  assert.equal(app.restoreSavedDraft('saved-untouched'), true);
  for (const change of revisions) assert.equal(app.getEffectiveExerciseName(change.id, app.findExerciseById(change.id)), change.oldName);
});

test('late discovered old drafts reconcile even after the routine has already upgraded', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  const session = oldSession('late', true, true); upgrade();
  save(session); upgrade();
  const updated = stored(app.getSessionKey(dayId));
  for (const change of revisions) assert.equal(updated.swaps[change.id].name, change.oldName);
});

test('migration failures roll back routine, revision, current, and retained drafts together', () => {
  for (const failedKey of ['routine', 'routineRev', 'gym_session_' + dayId, 'gym_saved_draft_saved']) {
    const {app, oldSession, save, upgrade, snapshot, failOnce} = setup();
    save(oldSession('active', true, true)); save(oldSession('saved', false, true), 'gym_saved_draft_saved');
    const before = snapshot(); failOnce(failedKey); upgrade();
    assert.deepEqual(snapshot(), before);
    assert.equal(app.routine.find(day => day.id === dayId).exercises[0].name, revisions[0].oldName);
  }
});

test('reopening old unnamed Monday history restores legacy equipment on a clone', () => {
  const {app, oldSession, upgrade} = setup();
  const session = oldSession('archived', true, true);
  const record = {id: 'w_archived', sessionId: session.id, dayId, dayTitle: 'Mon - Lower B', date: '2026-10-26T18:00:00Z',
    sessionSnapshot: clone(session), exercises: Object.fromEntries(revisions.map((change, index) => [change.oldName,
      {sets: [{setNum: 1, weight: 50 + index * 10, reps: 8 + index, completed: true}]}]))};
  app.history = [record]; const original = clone(record); upgrade();
  app.session = app.initNewSession(app.activeDayIndex); app.saveCurrentSession();
  assert.equal(app.reopenWorkout(record.id), true);
  assert.deepEqual(record, original);
  for (const change of revisions) {
    assert.equal(app.session.swaps[change.id].name, change.oldName);
    assert.equal(app.session.logs[change.id].length, 3);
    assert.ok(app.session.logs[change.id].every(set => set.exerciseName === change.oldName));
  }
});

test('old back-extension drafts retain the three-set progression threshold', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  const session = oldSession('old-back-extension');
  session.startTime = '2026-10-26T17:00:00Z';
  const rows = session.logs[revisions[1].id];
  Object.assign(rows[0], {weight: 25, reps: 12, completed: true});
  Object.assign(rows[1], {weight: 25, reps: 12, completed: true}); rows[2].skipped = true;
  save(session); upgrade(); app.session = stored(app.getSessionKey(dayId));
  const ex = app.findExerciseById(revisions[1].id);
  assert.equal(app.getPrescribedSetCount(ex, revisions[1].oldName), 3);
  assert.equal(app.finishSession(), true);
  assert.doesNotMatch(app.summaryContentEl.innerHTML, /Weight Increases Unlocked/);
  assert.equal(app.history[0].exercises[revisions[1].oldName].sets.length, 2);
  assert.ok(app.history[0].exercises[revisions[1].oldName].sets.every(set => set.programSets === 3));
});

test('changing migrated equipment resets only pending prescription metadata', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  save(oldSession('switch-after-migration', true)); upgrade();
  app.session = stored(app.getSessionKey(dayId));
  const ex = app.findExerciseById(revisions[1].id), rows = app.session.logs[ex.id];
  assert.equal(rows[0].programSets, 3); assert.equal(rows[1].programSets, 3);
  app.applyExerciseSwap(ex.id, app.getExerciseSnapshot(ex), 'temporary');
  assert.equal(rows[0].exerciseName, revisions[1].oldName);
  assert.equal(rows[0].programSets, 3);
  assert.equal(rows[1].exerciseName, revisions[1].name);
  assert.notEqual(rows[1].programSets, 3, 'new equipment must not inherit the old three-set prescription');
});

test('selecting legacy equipment in a fresh workout keeps the current two-set prescription', () => {
  const {app, upgrade} = setup();
  upgrade(); app.session = app.initNewSession(app.activeDayIndex);
  const ex = app.findExerciseById(revisions[1].id);
  const alternative = app.getSubstitutionsForExercise(ex.name, ex).find(item => item.name === revisions[1].oldName);
  assert.ok(alternative);
  assert.equal(app.session.logs[ex.id].length, 2);
  app.applyExerciseSwap(ex.id, alternative, 'temporary');
  assert.equal(app.getEffectiveExerciseName(ex.id, ex), revisions[1].oldName);
  assert.equal(app.getPrescribedSetCount(ex, revisions[1].oldName), 2);
  assert.equal(app.session.logs[ex.id].length, 2);
  assert.ok(app.session.logs[ex.id].every(set => !set.completed && !set.skipped));
});

test('mixed old and new equipment rows keep the old prescription even when new equipment is pending', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  const session = oldSession('mixed-equipment'), rows = session.logs[revisions[1].id];
  session.startTime = '2026-10-26T17:00:00Z';
  rows.slice(0, 2).forEach(row => Object.assign(row, {weight: 25, reps: 12, completed: true}));
  Object.assign(rows[2], {exerciseName: revisions[1].name, weight: null, needsBaseline: true, targetReps: revisions[1].targetReps});
  save(session); upgrade(); app.session = stored(app.getSessionKey(dayId));
  assert.ok(app.session.logs[revisions[1].id].slice(0, 2).every(row => row.programSets === 3));
  assert.equal(app.finishSession(), true);
  assert.doesNotMatch(app.summaryContentEl.innerHTML, /Weight Increases Unlocked/);
});

test('temporary custom equipment in a legacy draft retains its original slot prescription', () => {
  const {app, oldSession, save, upgrade, stored} = setup();
  const session = oldSession('temporary-custom'), id = revisions[1].id;
  const name = 'Custom temporary hinge';
  session.startTime = '2026-10-26T17:00:00Z';
  session.swaps[id] = {name, muscle: 'Glutes / Hamstrings', targetReps: '8–12'};
  session.logs[id].forEach(set => Object.assign(set, {exerciseName: name, weight: 25, reps: 12}));
  session.logs[id][0].completed = true; session.logs[id][1].completed = true; session.logs[id][2].skipped = true;
  save(session); upgrade(); app.session = stored(app.getSessionKey(dayId));
  assert.equal(app.getPrescribedSetCount(app.findExerciseById(id), name), 3);
  assert.equal(app.finishSession(), true);
  assert.doesNotMatch(app.summaryContentEl.innerHTML, /Weight Increases Unlocked/);
});

test('legacy backups preserve equipment in both keep-program and replace-program modes without duplicate recovery', () => {
  for (const restoreSettings of [false, true]) {
    const {app, oldSession, upgrade} = setup();
    const routine = clone(app.routine), incoming = oldSession('incoming-old', true, true);
    const retained = oldSession('retained-old', false, true);
    upgrade(); app.session = app.initNewSession(app.activeDayIndex); app.saveCurrentSession();
    const data = {version: '3.4', routine, history: [], sessions: [incoming], savedDrafts: [retained]};
    const plan = app.prepareBackupImport(data, {restoreSettings});
    assert.equal(app.applyBackupImport(plan), true);
    const imported = app.loadSession(app.routine.findIndex(day => day.id === dayId));
    for (const change of revisions) {
      assert.equal(app.routine.find(day => day.id === dayId).exercises.find(ex => ex.id === change.id).name, change.name);
      assert.equal(imported.swaps[change.id].name, change.oldName);
    }
    const count = app.getSavedDrafts().length;
    assert.equal(app.importData(JSON.stringify(data), {restoreSettings}), true);
    assert.equal(app.getSavedDrafts().length, count);
    const backup = app.createBackupData();
    assert.ok(backup.savedDrafts.some(draft => draft.id === retained.id && draft.logs[revisions[1].id].length === 3));
  }
});

test('backup migration previews stay read-only and late failures roll back staged Monday repairs', () => {
  const {app, oldSession, upgrade, snapshot, failOnce} = setup();
  const data = {routine: clone(app.routine), history: [], sessions: [oldSession('backup-old', true, true)]};
  upgrade(); app.session = app.initNewSession(app.activeDayIndex); app.saveCurrentSession();
  const before = snapshot(), routine = clone(app.routine), session = clone(app.session);
  const plan = app.prepareBackupImport(data, {restoreSettings: true});
  assert.deepEqual(snapshot(), before);
  failOnce('routineRev');
  assert.equal(app.applyBackupImport(plan), false);
  assert.deepEqual(snapshot(), before); assert.deepEqual(clone(app.routine), routine); assert.deepEqual(clone(app.session), session);
});
