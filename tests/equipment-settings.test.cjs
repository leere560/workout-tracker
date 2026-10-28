const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

function setup() {
  const values = new Map(), selectors = new Map();
  let failKey;
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (key === failKey) { failKey = null; throw Error('Storage full'); } values.set(key, String(value)); },
    removeItem: key => values.delete(key)
  };
  const context = vm.createContext({console, localStorage, document: {addEventListener() {}}, window: {}, Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App = WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, {
    routine: vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))', context),
    history: [], lastWeights: {}, machineSettings: {}, equipmentSettings: {}, exerciseNotes: {}, exercisePreferences: {},
    activeDayIndex: 2, deloadActive: false, collapsedCards: new Set(),
    storageKeys: {routine: 'routine', machineSettings: 'legacy-setup', equipmentSettings: 'equipment-setup', currentSessionPrefix: 'session_'},
    exerciseListEl: {querySelectorAll: selector => selectors.get(selector) || []}
  });
  app.renderWorkout = () => {};
  app.showToast = message => { app.toast = message; };
  app.session = app.initNewSession(2);
  const ex = app.routine[2].exercises[0];
  return {app, ex, values, selectors, failOn: key => { failKey = key; }};
}

function setupCard(name, exId, value = '', note = '') {
  const handlers = {};
  const cue = {textContent: value ? 'Seat / pin: ' + value : ''};
  cue.parentElement = {hidden: !value && !note, get textContent() { return cue.textContent + note; }};
  const legacy = {hidden: false};
  const input = {value, dataset: {exname: name, exid: exId}, addEventListener: (event, callback) => { handlers['input:' + event] = callback; }, focus() { input.focused = true; }};
  const button = {dataset: {exname: name, exid: exId}, addEventListener: (event, callback) => { handlers['button:' + event] = callback; }};
  const card = {querySelector: selector => ({'.saved-seat-cue': cue, '.legacy-machine-setting': legacy, '.machine-settings-input': input}[selector])};
  input.closest = button.closest = () => card;
  return {input, button, cue, legacy, handlers};
}

test('temporary swaps recall their own equipment setup and restore the original setup', () => {
  const {app, ex} = setup();
  const original = ex.name;
  const alternative = {name: 'Incline Dumbbell Bench Press', muscle: 'Chest', targetReps: '6–8'};
  assert.equal(app.updateEquipmentSetting(original, 'Bench stop 3'), true);
  app.applyExerciseSwap(ex.id, alternative, 'today');
  assert.equal(app.getEquipmentSetting(app.getEffectiveExerciseName(ex.id, ex)), '');
  app.updateEquipmentSetting(alternative.name, 'Bench 30 degrees');
  app.applyExerciseSwap(ex.id, {name: original, muscle: 'Chest', targetReps: '6–8'}, 'today');
  assert.equal(app.getEquipmentSetting(app.getEffectiveExerciseName(ex.id, ex)), 'Bench stop 3');
  assert.equal(app.getEquipmentSetting(alternative.name), 'Bench 30 degrees');
  assert.match(app.renderExerciseCard(ex, false), /Seat \/ pin: Bench stop 3/);
});

test('permanent replacement and fresh sessions keep setup for both equipment names', () => {
  const {app, ex, values} = setup();
  const original = app.getExerciseSnapshot(ex);
  const alternative = {name: 'Converging Machine Incline Press', muscle: 'Chest', targetReps: '6–8'};
  app.updateEquipmentSetting(original.name, 'Bench stop 3');
  app.updateEquipmentSetting(alternative.name, 'Seat 5');
  app.applyExerciseSwap(ex.id, alternative, 'permanent');
  app.session = app.initNewSession(2);
  assert.equal(app.getEquipmentSetting(app.getEffectiveExerciseName(ex.id, ex)), 'Seat 5');
  app.equipmentSettings = app.loadEquipmentSettings();
  app.applyExerciseSwap(ex.id, original, 'permanent');
  app.session = app.initNewSession(2);
  assert.equal(app.getEquipmentSetting(app.getEffectiveExerciseName(ex.id, ex)), 'Bench stop 3');
  assert.deepEqual(JSON.parse(values.get('equipment-setup')), {[original.name]: 'Bench stop 3', [alternative.name]: 'Seat 5'});
});

test('the same named equipment shares setup across different exercise slots and days', () => {
  const {app, ex} = setup();
  app.updateEquipmentSetting(ex.name, 'Seat 4');
  const other = {...ex, id: 'different-slot'};
  app.routine[0].exercises.push(other);
  app.activeDayIndex = 0;
  app.session = app.initNewSession(0);
  assert.equal(app.getEquipmentSetting(app.getEffectiveExerciseName(other.id, other)), 'Seat 4');
  assert.match(app.renderExerciseCard(other, false), /Seat \/ pin: Seat 4/);
});

test('legacy slot setup is labelled and never used until explicitly adopted', () => {
  const {app, ex, selectors} = setup();
  app.machineSettings[ex.id] = 'Seat 6';
  const before = clone(app.machineSettings);
  const html = app.renderExerciseCard(ex, false);
  assert.match(html, /Previous setup:<\/strong> Seat 6/);
  assert.match(html, /Use for this equipment/);
  assert.match(html, /machine-settings-input" value=""/);
  assert.doesNotMatch(html, /Seat \/ pin: Seat 6/);
  const card = setupCard(ex.name, ex.id);
  selectors.set('.machine-settings-input', [card.input]);
  selectors.set('.use-legacy-machine-setting-btn', [card.button]);
  app.bindEquipmentSetupEvents();
  card.handlers['button:click']();
  assert.equal(app.getEquipmentSetting(ex.name), 'Seat 6');
  assert.equal(card.input.value, 'Seat 6');
  assert.equal(card.cue.textContent, 'Seat / pin: Seat 6');
  assert.equal(card.legacy.hidden, true);
  assert.equal(card.input.focused, true);
  assert.deepEqual(clone(app.machineSettings), before);
  assert.match(app.renderExerciseCard(ex, false), /class="legacy-machine-setting" hidden/);
});

test('clearing equipment setup persists intentionally without reviving its legacy suggestion', () => {
  const {app, ex} = setup();
  app.machineSettings[ex.id] = 'Seat 6';
  app.updateEquipmentSetting(ex.name, 'Seat 2');
  app.updateEquipmentSetting(ex.name, '');
  app.equipmentSettings = app.loadEquipmentSettings();
  assert.equal(app.hasEquipmentSetting(ex.name), true);
  assert.equal(app.getEquipmentSetting(ex.name), '');
  assert.match(app.renderExerciseCard(ex, false), /class="legacy-machine-setting" hidden/);
  assert.equal(app.getLegacyMachineSetting(ex.id), 'Seat 6');
});

test('failed input save restores persisted value and visible cue while preserving notes', () => {
  const {app, ex, values, selectors, failOn} = setup();
  app.updateEquipmentSetting(ex.name, 'Seat 2');
  const before = values.get('equipment-setup');
  const card = setupCard(ex.name, ex.id, 'Seat 2', 'Keep shoulders down');
  selectors.set('.machine-settings-input', [card.input]);
  app.bindEquipmentSetupEvents();
  card.input.value = 'Seat 9';
  failOn('equipment-setup');
  card.handlers['input:input']();
  assert.equal(values.get('equipment-setup'), before);
  assert.equal(app.getEquipmentSetting(ex.name), 'Seat 2');
  assert.equal(card.input.value, 'Seat 2');
  assert.equal(card.cue.textContent, 'Seat / pin: Seat 2');
  assert.equal(card.cue.parentElement.hidden, false);
  assert.match(app.toast, /Could not save/);
});

test('failed legacy adoption leaves the suggestion available and does not create a setting', () => {
  const {app, ex, values, selectors, failOn} = setup();
  app.machineSettings[ex.id] = 'Seat 6';
  const card = setupCard(ex.name, ex.id);
  selectors.set('.machine-settings-input', [card.input]);
  selectors.set('.use-legacy-machine-setting-btn', [card.button]);
  app.bindEquipmentSetupEvents();
  failOn('equipment-setup');
  card.handlers['button:click']();
  assert.equal(app.hasEquipmentSetting(ex.name), false);
  assert.equal(values.has('equipment-setup'), false);
  assert.equal(card.input.value, '');
  assert.equal(card.legacy.hidden, false);
  assert.equal(app.getLegacyMachineSetting(ex.id), 'Seat 6');
  assert.match(app.toast, /Could not save/);
});

test('malformed equipment maps are rejected without rewriting stored data', () => {
  const {app, values} = setup();
  for (const raw of ['broken JSON', 'null', '[]', '"Seat 4"', '{"Press": 4}', '{"Press": {"seat":4}}', '{" ":"Seat 4"}']) {
    values.set('equipment-setup', raw);
    assert.deepEqual(clone(app.loadEquipmentSettings()), {});
    assert.equal(values.get('equipment-setup'), raw);
  }
  values.set('equipment-setup', '{"Press":"", "__proto__":"Seat 3"}');
  app.equipmentSettings = app.loadEquipmentSettings();
  assert.equal(app.getEquipmentSetting('__proto__'), 'Seat 3');
  assert.equal(app.getEquipmentSetting('toString'), '');
  assert.equal(app.hasEquipmentSetting('Press'), true);
  assert.equal(app.updateEquipmentSetting('', 'Seat 4'), false);
  assert.equal(app.updateEquipmentSetting('Press', {}), false);
});

test('equipment names and legacy settings render as text rather than markup', () => {
  const {app, ex} = setup();
  ex.name = '<img src=x onerror=alert(1)>';
  app.machineSettings[ex.id] = '<script>alert(1)</script>';
  app.updateEquipmentSetting(ex.name, 'Seat "4" <high>');
  const html = app.renderExerciseCard(ex, false);
  assert.match(html, /Seat &quot;4&quot; &lt;high&gt;/);
  assert.match(html, /data-exname="&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
});
