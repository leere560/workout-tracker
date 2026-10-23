const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

function setup() {
  const values = new Map(), handlers = new Map(), nodes = new Map();
  let failKey;
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (key === failKey) { failKey = null; throw Error('Storage full'); } values.set(key, String(value)); },
    removeItem: key => values.delete(key)
  };
  const classList = {add() {}, remove() {}};
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {innerHTML: '', textContent: '', classList,
      addEventListener: (event, callback) => handlers.set(`${id}:${event}`, callback)});
    return nodes.get(id);
  }
  const context = vm.createContext({console, localStorage, document: {addEventListener() {}, getElementById: node}, window: {},
    confirm() { throw Error('Routine changes must use an in-app review'); }});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App = WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, {
    routine: vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context), history: [], lastWeights: {},
    exercisePreferences: {}, activeDayIndex: 2, deloadActive: false, collapsedCards: new Set(),
    storageKeys: {routine: 'routine', currentSessionPrefix: 'session_'}, swapModalEl: {classList}, swapModalTitleEl: {},
    swapContentEl: {innerHTML: '', querySelectorAll: selector => {
      const id = selector === '.swap-btn-today' ? 'temporary' : 'permanent';
      const control = node(id); control.dataset = {subidx: '0'}; return [control];
    }}
  });
  app.renderWorkout = () => {};
  app.showToast = message => { app.toast = message; };
  app.session = app.initNewSession(2);
  const ex = app.routine[2].exercises[0];
  return {app, ex, values, handlers, failOn: key => { failKey = key; }};
}

test('temporary swaps leave routine defaults unchanged and a new workout returns to the default', () => {
  const {app, ex} = setup();
  const before = clone(app.routine);
  const sub = app.getSubstitutionsForExercise(ex.name, ex).find(alternative => alternative.type === 'Dumbbell');
  app.applyExerciseSwap(ex.id, sub, 'today');
  assert.deepEqual(clone(app.routine), before);
  assert.equal(app.getEffectiveExerciseName(ex.id, ex), sub.name);
  app.session = app.initNewSession(2);
  assert.equal(app.getEffectiveExerciseName(ex.id, ex), before[2].exercises[0].name);
  assert.equal(app.session.logs[ex.id][0].exerciseName, ex.name);
});

test('permanent swaps retain a scalar original descriptor and keep every equipment family recoverable', () => {
  const {app, ex, values} = setup();
  const original = clone(ex);
  const family = app.getSubstitutionsForExercise(ex.name, ex).map(sub => sub.name);
  const db = app.getSubstitutionsForExercise(ex.name, ex).find(sub => sub.type === 'Dumbbell');
  app.applyExerciseSwap(ex.id, db, 'permanent');
  const savedOriginal = clone(ex.originalExercise);
  assert.equal(savedOriginal.name, original.name);
  for (const key of ['id', 'sets', 'superset', 'rest', 'restSeconds', 'originalExercise', 'equipmentAlternatives']) assert.equal(savedOriginal[key], undefined);
  assert.equal(app.getSubstitutionsForExercise(ex.name, ex).filter(sub => sub.name === original.name).length, 1);
  assert.ok(!app.getSubstitutionsForExercise(ex.name, ex).some(sub => sub.name === db.name));
  app.applyExerciseSwap(ex.id, {name: 'Custom incline press', muscle: 'Chest', targetReps: '6–8'}, 'permanent');
  assert.deepEqual(clone(ex.originalExercise), savedOriginal);
  const recovered = app.getSubstitutionsForExercise(ex.name, ex).map(sub => sub.name);
  for (const name of [original.name, db.name, ...family]) assert.ok(recovered.includes(name), name);
  assert.equal(new Set(recovered.map(name => name.toLowerCase())).size, recovered.length);
  const stored = JSON.parse(values.get('routine'));
  assert.deepEqual(stored[2].exercises[0].originalExercise, savedOriginal);
});

test('legacy permanent dumbbell swaps recover Smith incline and machine overhead alternatives by stable ID', () => {
  const {app, ex} = setup();
  const incline = ex.name;
  const shoulder = app.routine[2].exercises.find(candidate => candidate.name === 'Machine Overhead Shoulder Press');
  ex.name = 'Incline Dumbbell Bench Press';
  shoulder.name = 'Seated Dumbbell Shoulder Press';
  const inclineAlternatives = app.getSubstitutionsForExercise(ex.name, ex).map(sub => sub.name);
  const shoulderAlternatives = app.getSubstitutionsForExercise(shoulder.name, shoulder).map(sub => sub.name);
  assert.ok(inclineAlternatives.includes(incline));
  assert.ok(inclineAlternatives.includes('Converging Machine Incline Press'));
  assert.ok(shoulderAlternatives.includes('Machine Overhead Shoulder Press'));
  assert.ok(shoulderAlternatives.includes('Smith Machine Overhead Press'));
  assert.ok(!inclineAlternatives.includes(ex.name));
  assert.ok(!shoulderAlternatives.includes(shoulder.name));
});

test('an original Smith overhead default retains the canonical shoulder alternative family', () => {
  const {app} = setup();
  const ex = app.routine[2].exercises.find(candidate => candidate.name === 'Machine Overhead Shoulder Press');
  ex.originalExercise = {...app.getExerciseSnapshot(ex), name: 'Smith Machine Overhead Press'};
  ex.name = 'Seated Dumbbell Shoulder Press';
  const names = app.getSubstitutionsForExercise(ex.name, ex).map(sub => sub.name);
  assert.ok(names.includes('Smith Machine Overhead Press'));
  assert.ok(names.includes('Standing Dumbbell Overhead Press'));
});

test('stored recovery alternatives remain available and current effective equipment is omitted', () => {
  const {app, ex} = setup();
  const db = {name: 'My saved dumbbell replacement', muscle: 'Chest', increment: 2.5};
  ex.equipmentAlternatives = [db, {...db}];
  assert.equal(app.getSubstitutionsForExercise(ex.name, ex).filter(sub => sub.name === db.name).length, 1);
  app.session.swaps[ex.id] = db;
  const names = app.getSubstitutionsForExercise(db.name, ex).map(sub => sub.name);
  assert.ok(!names.includes(db.name));
  assert.ok(names.includes(ex.name));
});

test('restoring a default preserves completed identities and never transfers dumbbell loads to Smith', () => {
  const {app, ex} = setup();
  const smith = app.getOriginalExercise(ex);
  app.applyExerciseSwap(ex.id, {name: 'Incline Dumbbell Bench Press', muscle: 'Chest', targetReps: '6–8'}, 'permanent');
  const completed = app.session.logs[ex.id][0];
  Object.assign(completed, {weight: 40, reps: 7, completed: true, exerciseName: ex.name});
  app.session.warmups[ex.id] = [
    {weight: 20, reps: 10, completed: true, exerciseName: ex.name},
    {weight: 30, reps: 5, completed: false, exerciseName: ex.name}
  ];
  app.lastWeights[ex.name] = {sets: [{weight: 40, reps: 7, completed: true}]};
  app.applyExerciseSwap(ex.id, smith, 'permanent');
  assert.equal(ex.name, smith.name);
  assert.equal(completed.exerciseName, 'Incline Dumbbell Bench Press');
  assert.equal(completed.weight, 40);
  assert.equal(app.session.logs[ex.id][1].weight, null);
  assert.equal(app.session.logs[ex.id][1].needsBaseline, true);
  assert.equal(app.session.warmups[ex.id].length, 1);
  assert.equal(app.session.warmups[ex.id][0].exerciseName, 'Incline Dumbbell Bench Press');
  assert.ok(app.getSubstitutionsForExercise(ex.name, ex).some(sub => sub.name === 'Incline Dumbbell Bench Press'));
});

test('restoring equipment uses that equipment history rather than the replacement baseline', () => {
  const {app, ex} = setup();
  const original = app.getOriginalExercise(ex);
  app.lastWeights[original.name] = {sets: [{weight: 115, reps: 7, completed: true}]};
  app.applyExerciseSwap(ex.id, {name: 'Incline Dumbbell Bench Press'}, 'permanent');
  app.applyExerciseSwap(ex.id, original, 'permanent');
  assert.equal(app.session.logs[ex.id][0].weight, 115);
  assert.equal(app.session.logs[ex.id][0].needsBaseline, false);
});

test('swap dialog defaults to this workout and routine changes require a separate named review', () => {
  const {app, ex, handlers} = setup();
  const original = ex.name;
  app.openSwapModal(ex.id, ex.name);
  const html = app.swapContentEl.innerHTML;
  assert.match(html, /Use for this workout/);
  assert.match(html, /<details class="swap-default-controls">\s*<summary>Change routine default<\/summary>/);
  assert.ok(html.indexOf('class="swap-btn-perm"') > html.indexOf('<details'));
  handlers.get('permanent:click')();
  assert.equal(ex.name, original);
  assert.match(app.swapModalTitleEl.textContent, /Change routine default\?/);
  assert.ok(app.swapContentEl.innerHTML.includes(original));
  assert.match(app.swapContentEl.innerHTML, /this workout and future workouts/);
  handlers.get('cancelRoutineDefaultBtn:click')();
  assert.equal(ex.name, original);
  handlers.get('permanent:click')();
  handlers.get('confirmRoutineDefaultBtn:click')();
  assert.notEqual(ex.name, original);
  app.openSwapModal(ex.id, ex.name);
  handlers.get('restoreRoutineDefaultBtn:click')();
  assert.notEqual(ex.name, original);
  assert.equal(app.swapModalTitleEl.textContent, 'Restore routine default?');
  handlers.get('confirmRoutineDefaultBtn:click')();
  assert.equal(ex.name, original);
});

test('dialog identifies the effective temporary equipment separately from the routine default', () => {
  const {app, ex} = setup();
  app.session.swaps[ex.id] = {name: 'Temporary dumbbells'};
  app.openSwapModal(ex.id, ex.name);
  assert.match(app.swapContentEl.innerHTML, /This workout<\/div>\s*<div[^>]*>Temporary dumbbells<\/div>/);
  assert.ok(app.swapContentEl.innerHTML.includes(`Routine default: ${ex.name}`));
  assert.ok(!app.getSubstitutionsForExercise(ex.name, ex).some(sub => sub.name === 'Temporary dumbbells'));
});

test('failed permanent change rolls back original snapshot, alternatives, routine and session together', () => {
  const {app, ex, failOn, values} = setup();
  const beforeRoutine = clone(app.routine), beforeSession = clone(app.session), beforeStorage = [...values];
  failOn('routine');
  app.applyExerciseSwap(ex.id, {name: 'Different press'}, 'permanent');
  assert.deepEqual(clone(app.routine), beforeRoutine);
  assert.deepEqual(clone(app.session), beforeSession);
  assert.deepEqual([...values], beforeStorage);
  assert.match(app.toast, /Could not save/);
});

test('promoting the current temporary equipment preserves pending values, baseline flags and every warmup', () => {
  const {app, ex, values} = setup();
  const originalName = ex.name;
  const sub = {name: 'Incline Dumbbell Bench Press', muscle: 'Chest', targetReps: '6–8'};
  app.applyExerciseSwap(ex.id, sub, 'today');
  Object.assign(app.session.logs[ex.id][0], {weight: 40, reps: 7, needsBaseline: false});
  // Preserve even incomplete edited values so changing the default cannot erase the user's draft.
  Object.assign(app.session.logs[ex.id][1], {weight: '', reps: '9', needsBaseline: true});
  app.session.warmups[ex.id] = [
    {setNum: 1, weight: 20, reps: 10, completed: true, exerciseName: sub.name},
    {setNum: 2, weight: 30, reps: 5, completed: false, exerciseName: sub.name}
  ];
  const beforeLogs = clone(app.session.logs[ex.id]);
  const beforeWarmups = clone(app.session.warmups[ex.id]);
  app.applyExerciseSwap(ex.id, sub, 'permanent');
  assert.deepEqual(clone(app.session.logs[ex.id]), beforeLogs);
  assert.deepEqual(clone(app.session.warmups[ex.id]), beforeWarmups);
  assert.equal(ex.name, sub.name);
  assert.equal(ex.originalExercise.name, originalName);
  assert.equal(app.session.swaps[ex.id], undefined);
  const persisted = JSON.parse(values.get(app.getSessionKey(app.session.dayId)));
  assert.deepEqual(persisted.logs[ex.id], beforeLogs);
  assert.deepEqual(persisted.warmups[ex.id], beforeWarmups);
  const future = app.initNewSession(2);
  assert.equal(future.logs[ex.id][0].exerciseName, sub.name);
  assert.equal(future.logs[ex.id][0].needsBaseline, true);
  assert.deepEqual(clone(future.warmups), {});
});
