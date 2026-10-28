const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = value => JSON.parse(JSON.stringify(value));
const root = path.join(__dirname, '..');

function setup() {
  let now = Date.parse('2026-10-28T17:00:00Z');
  let failKey, failDownload = false, mutations = 0, capturedBlob;
  const values = new Map(), handlers = new Map(), elements = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === failKey) { failKey = undefined; throw Error('Quota exceeded'); }
      mutations++; values.set(key, String(value));
    },
    removeItem(key) {
      if (key === failKey) { failKey = undefined; throw Error('Quota exceeded'); }
      mutations++; values.delete(key);
    },
    key: index => [...values.keys()][index],
    get length() { return values.size; }
  };
  const classes = new Set();
  const classList = {add: name => classes.add(name), remove: name => classes.delete(name)};
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', style: {}, classList,
      addEventListener: (name, handler) => handlers.set(`${id}:${name}`, handler),
      querySelectorAll: () => [], click() {}
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    console: {error() {}, info() {}, log() {}}, localStorage: storage,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    document: {
      addEventListener() {}, getElementById: element,
      querySelector: () => ({click() {}}), body: {classList},
      createElement: () => ({click() {if (failDownload) throw Error('Download unavailable');}})
    },
    window: {}, Blob: class {constructor(parts) {this.parts = parts;}},
    URL: {createObjectURL(blob) {capturedBlob = blob; return 'blob:backup';}, revokeObjectURL() {}},
    setTimeout: callback => {callback(); return 1;}, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, confirm: () => true,
    alert: message => {context.alertMessage = message;}
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8') + ';globalThis.App=WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  const keys = ['routine', 'history', 'lastWeights', 'routineRev', 'machineSettings', 'equipmentSettings',
    'exerciseNotes', 'exercisePreferences', 'wakeLockEnabled', 'deloadActive', 'deloadStartDate',
    'lastBackupTime', 'timerTargetEnd', 'timerTotalDuration'];
  app.storageKeys = Object.fromEntries(keys.map(key => [key, key]));
  app.storageKeys.currentSessionPrefix = 'gym_session_';
  app.storageKeys.legacyCurrentSession = 'legacy';
  Object.assign(app, {
    history: [], lastWeights: {}, machineSettings: {}, equipmentSettings: {}, exerciseNotes: {},
    exercisePreferences: {}, deloadActive: false, deloadStartDate: 0, wakeLockEnabled: true,
    activeDayIndex: 0, activeView: 'workout', collapsedCards: new Set(),
    timer: {active: false, intervalId: null}, timerDockEl: {classList},
    summaryContentEl: element('summaryContent'), summaryModalEl: element('summaryModal'),
    routineEditorEl: element('routineEditor'), exerciseListEl: {querySelector: () => null}
  });
  for (const name of ['render', 'renderWorkout', 'renderAnalytics', 'renderRoutineEditor',
    'updateNowLiftingHUD', 'jumpToActiveExercise', 'releaseWakeLock', 'restoreActiveTimer']) app[name] = () => {};
  app.showToast = message => {app.toast = message;};
  app.routine = app.loadRoutine();
  app.session = app.initNewSession(0);
  app.session.id = 'local-current';
  app.selectionLocalDate = app.getLocalDateKey(new context.Date());
  app.saveCurrentSession();
  const snapshot = () => ({storage: [...values].sort(([a], [b]) => a.localeCompare(b)),
    state: app.backupImportStateSignature(), timer: clone(app.timer)});
  const draft = (id = 'incoming', dayIndex = 0, weight = 105) => {
    const session = app.initNewSession(dayIndex);
    session.id = id;
    session.startTime = '2026-10-21T17:00:00.000Z';
    session.lastInteractionAt = session.startTime;
    session.updatedAt = session.startTime;
    const ex = app.routine[dayIndex].exercises[0];
    Object.assign(session.logs[ex.id][0], {weight, reps: 8, completed: true});
    return session;
  };
  const activate = session => {
    app.session = session;
    app.activeDayIndex = app.routine.findIndex(day => day.id === session.dayId);
    app.saveCurrentSession();
  };
  const archive = (session, id = `w_${session.id}`) => ({
    id, sessionId: session.id, dayId: session.dayId, date: '2026-10-21T18:00:00.000Z',
    dayTitle: session.dayTitle, sessionSnapshot: clone(session), exercises: {}, totalCompletedSets: 1
  });
  return {app, values, storage, handlers, snapshot, draft, activate, archive,
    mutationCount: () => mutations, failOnce: key => {failKey = key;},
    failDownload: () => {failDownload = true;}, advance: ms => {now += ms;},
    exported: () => JSON.parse(capturedBlob.parts.join(''))};
}

test('previewing, toggling settings, and cancelling a restore never write or change workout state', () => {
  const {app, snapshot, draft, handlers, mutationCount} = setup();
  const data = {history: [], sessions: [draft()], routine: clone(app.routine), exportedAt: '2026-10-21T19:00:00Z'};
  const before = snapshot(), count = mutationCount(), original = clone(data);
  const plan = app.prepareBackupImport(data);
  assert.equal(plan.summary.retained, 0);
  assert.deepEqual(clone(data), original);
  assert.deepEqual(snapshot(), before);
  app.previewBackupImport(JSON.stringify(data));
  handlers.get('restoreBackupSettings:change')({target: {checked: true}});
  handlers.get('cancelBackupRestore:click')();
  assert.deepEqual(snapshot(), before);
  assert.equal(mutationCount(), count);
});

test('older and newer same-ID imports keep current work and timer, retaining both differing versions', () => {
  const {app, draft, activate, values} = setup();
  const current = draft('same', 0, 125); activate(current);
  app.timer = {active: true, targetEndTime: 123456, minimumDuration: 120};
  values.set('timerTargetEnd', '123456');
  const timer = clone(app.timer), original = clone(app.session);
  for (const [stamp, weight] of [['2026-10-01T12:00:00Z', 95], ['2026-11-01T12:00:00Z', 140]]) {
    const incoming = draft('same', 0, weight);
    incoming.updatedAt = stamp; incoming.lastInteractionAt = stamp;
    assert.equal(app.importData(JSON.stringify({history: [], sessions: [incoming], timer: {targetEnd: '999'}})), true);
    assert.deepEqual(clone(app.session), original);
    assert.deepEqual(clone(app.timer), timer);
    assert.equal(values.get('timerTargetEnd'), '123456');
  }
  assert.equal(app.getSavedDrafts().length, 2);
  assert.equal(new Set(app.getSavedDrafts().map(item => item.recoveryId)).size, 2);
  assert.ok(app.getSavedDrafts().every(item => item.session.id === 'same'));
});

test('repeat import deduplicates recovery drafts despite object order and passive save timestamps', () => {
  const {app, draft, activate} = setup();
  activate(draft('active', 0, 125));
  const incoming = draft('incoming', 0, 95), data = {history: [], sessions: [incoming]};
  assert.equal(app.importData(JSON.stringify(data)), true);
  const changedOrder = Object.fromEntries(Object.entries(incoming).reverse());
  changedOrder.updatedAt = '2026-10-28T16:00:00Z';
  assert.equal(app.importData(JSON.stringify({history: [], sessions: [changedOrder]})), true);
  assert.equal(app.getSavedDrafts().length, 1);
});

test('anonymous legacy draft imports have stable identities and do not accumulate recovery copies', () => {
  for (const protectCurrent of [false, true]) {
    const {app, draft, activate} = setup();
    if (protectCurrent) activate(draft('active', 0, 125));
    const incoming = draft('legacy', 0, 95); delete incoming.id;
    const data = JSON.stringify({version: '2.4', sessions: [incoming]});
    assert.equal(app.importData(data), true);
    const count = app.getSavedDrafts().length;
    assert.equal(app.importData(data), true);
    assert.equal(app.getSavedDrafts().length, count);
  }
});

test('all recovery variants remain accessible and restoring one preserves the active draft', () => {
  const {app, draft, activate, values} = setup();
  activate(draft('current', 0, 130));
  const original = clone(app.session), writes = new Map();
  for (const [id, weight] of [['old-a', 90], ['old-b', 100], ['old-c', 110]]) app.retainSavedDraft(draft(id, 0, weight), writes);
  app.writeStorageTransaction(writes);
  values.delete(`gym_saved_draft_for_${app.session.dayId}`);
  assert.equal(app.getSavedDrafts().length, 3);
  const selected = app.getSavedDrafts().find(item => item.session.id === 'old-b');
  assert.equal(app.restoreSavedDraft(selected.recoveryId), true);
  assert.equal(app.session.id, 'old-b');
  const remaining = app.getSavedDrafts();
  assert.deepEqual(clone(remaining.map(item => item.session.id).sort()), ['current', 'old-a', 'old-c']);
  assert.deepEqual(clone(remaining.find(item => item.session.id === 'current').session), original);
  const exported = clone(app.createBackupData());
  assert.equal(exported.savedDrafts.length, 3);
  assert.ok(exported.savedDrafts.every(item => item.recoveryId));
  const fresh = setup();
  assert.equal(fresh.app.importData(JSON.stringify(exported)), true);
  assert.deepEqual(clone(fresh.app.getSavedDrafts().map(item => item.session.id).sort()), ['current', 'old-a', 'old-c']);
});

test('failed recovery restore preserves every version, selected workout, and timer', () => {
  const {app, draft, activate, snapshot, failOnce} = setup();
  activate(draft('current', 0, 130));
  const writes = new Map(), retained = app.retainSavedDraft(draft('old'), writes);
  app.writeStorageTransaction(writes);
  app.timer = {active: true, targetEndTime: 123456};
  const before = snapshot();
  failOnce(`gym_saved_draft_${retained.recoveryId}`);
  assert.equal(app.restoreSavedDraft(retained.recoveryId), false);
  assert.deepEqual(snapshot(), before);
});

test('imported archived overlaps cannot invalidate active work, including snapshot-only identities', () => {
  for (const snapshotOnly of [false, true]) {
    const {app, draft, activate, archive} = setup();
    activate(draft('active', 0, 125));
    const incoming = archive(app.session);
    if (snapshotOnly) delete incoming.sessionId;
    const plan = app.prepareBackupImport({history: [incoming]});
    assert.equal(plan.summary.overlapping, 1);
    assert.equal(app.applyBackupImport(plan), true);
    assert.equal(app.history.length, 0);
    assert.equal(app.session.id, 'active');
    assert.equal(app.loadSession().id, 'active');
  }
});

test('duplicate archive IDs keep local records and drafts already archived cannot double-count', () => {
  const {app, draft, archive} = setup();
  const session = draft('archived'), record = archive(session);
  app.history = [record];
  const changed = {...clone(record), dayTitle: 'Conflicting imported title'};
  const plan = app.prepareBackupImport({history: [changed], sessions: [session]});
  assert.equal(plan.summary.duplicates, 1);
  assert.equal(app.applyBackupImport(plan), true);
  assert.equal(app.history[0].dayTitle, record.dayTitle);
  const retained = app.getSavedDrafts().find(item => item.session.id === 'archived');
  assert.ok(retained);
  assert.equal(app.restoreSavedDraft(retained.recoveryId), false);
  assert.equal(app.history.length, 1);
  assert.match(app.renderRecoveryDrafts(), /already saved in Progress/);
});

test('unknown imported days remain listed and exported for later recovery', () => {
  const {app, draft} = setup();
  const incoming = draft('unknown'); incoming.dayId = 'custom-program-day';
  assert.equal(app.importData(JSON.stringify({history: [], sessions: [incoming]})), true);
  const retained = app.getSavedDrafts().find(item => item.session.id === 'unknown');
  assert.ok(retained);
  assert.equal(app.restoreSavedDraft(retained.recoveryId), false);
  assert.match(app.renderRecoveryDrafts(), /Restore this draft’s program/);
  assert.equal(app.createBackupData().savedDrafts[0].dayId, 'custom-program-day');
});

test('replacing the program retains active local days absent from the imported program', () => {
  const {app, draft, activate} = setup();
  activate(draft('local-removed-day', 0, 125));
  const original = clone(app.session);
  const routine = clone(app.routine.slice(1));
  assert.equal(app.importData(JSON.stringify({history: [], routine}), {restoreSettings: true}), true);
  const retained = app.getSavedDrafts().find(item => item.session.id === original.id);
  assert.ok(retained, 'the removed day must be visible in Recovery drafts');
  assert.deepEqual(clone(retained.session), original);
  assert.match(app.renderRecoveryDrafts(), /Restore this draft’s program/);
});

test('routine repair is staged with the import and a late failure rolls all keys back', () => {
  const {app, draft, snapshot, failOnce} = setup();
  const routine = clone(app.routine), exercise = routine[2].exercises[0];
  exercise.name = 'Incline Dumbbell Bench Press';
  delete exercise.equipmentRepairVersion;
  const imported = draft('legacy-db', 2, 40), rows = imported.logs[exercise.id];
  rows.forEach(row => {delete row.exerciseName; row.weight = 40;});
  const before = snapshot();
  const plan = app.prepareBackupImport({routine, history: [], sessions: [imported]}, {restoreSettings: true});
  assert.deepEqual(snapshot(), before);
  const staged = JSON.parse(plan.writes.get(app.getSessionKey(imported.dayId)));
  assert.equal(staged.logs[exercise.id][0].exerciseName, 'Incline Dumbbell Bench Press');
  assert.equal(staged.logs[exercise.id][0].weight, 40);
  failOnce(app.storageKeys.routineRev);
  assert.equal(app.applyBackupImport(plan), false);
  assert.deepEqual(snapshot(), before);
  assert.equal(app.applyBackupImport(plan), true);
  assert.match(app.routine[2].exercises[0].name, /Smith/);
  assert.equal(app.loadSession(2).logs[exercise.id][0].exerciseName, 'Incline Dumbbell Bench Press');
});

test('stale previews reject both browser storage and in-memory changes without overwriting them', () => {
  for (const changeMemory of [false, true]) {
    const {app, values, draft, snapshot} = setup();
    const plan = app.prepareBackupImport({history: [], sessions: [draft()]});
    if (changeMemory) app.session.logs[app.routine[0].exercises[0].id][0].weight = 999;
    else values.set('external-change', 'keep');
    const changed = snapshot();
    assert.equal(app.applyBackupImport(plan), false);
    assert.deepEqual(snapshot(), changed);
    assert.match(app.toast, /Preview the backup again/);
  }
});

test('backup settings keep local matches by default and replace only after explicit selection', () => {
  const {app} = setup();
  app.exerciseNotes = {Lift: 'Local note'};
  app.wakeLockEnabled = false;
  const data = {history: [], exerciseNotes: {Lift: 'Backup note', New: 'New note'}, wakeLockEnabled: true};
  assert.equal(app.importData(JSON.stringify(data)), true);
  assert.equal(app.exerciseNotes.Lift, 'Local note');
  assert.equal(app.exerciseNotes.New, 'New note');
  assert.equal(app.wakeLockEnabled, false);
  assert.equal(app.importData(JSON.stringify(data), {restoreSettings: true}), true);
  assert.equal(app.exerciseNotes.Lift, 'Backup note');
  assert.equal(app.wakeLockEnabled, true);
});

test('export includes unsaved current edits even when local storage is full and uses honest wording', () => {
  const {app, values, failOnce, exported} = setup();
  const ex = app.routine[0].exercises[0];
  app.session.logs[ex.id][0].weight = 147.5;
  failOnce(app.storageKeys.lastBackupTime);
  assert.equal(app.exportData(), true);
  assert.equal(exported().sessions.find(session => session.id === app.session.id).logs[ex.id][0].weight, 147.5);
  assert.equal(values.has(app.storageKeys.lastBackupTime), false);
  assert.match(app.toast, /Download requested/);
  assert.doesNotMatch(app.toast, /successfully|backed up/i);
});

test('failed download leaves export timestamp unchanged and import never claims a new export', () => {
  const {app, values, failDownload} = setup();
  values.set(app.storageKeys.lastBackupTime, '12345');
  failDownload();
  assert.equal(app.exportData(), false);
  assert.equal(values.get(app.storageKeys.lastBackupTime), '12345');
  assert.match(app.toast, /Could not request/);
  assert.equal(app.importData(JSON.stringify({version: '2.4', history: []})), true);
  assert.equal(values.get(app.storageKeys.lastBackupTime), '12345');
  assert.match(app.getBackupStatusText(), /Last export requested/);
});

test('reserved recovery IDs stay visible and repeat imports remain deduplicated', () => {
  const {app, draft} = setup();
  const incoming = {...draft('for_workout'), recoveryId: 'for_slot'};
  assert.equal(app.importData(JSON.stringify({history: [], savedDrafts: [incoming]})), true);
  assert.equal(app.getSavedDrafts().length, 1);
  assert.equal(app.getSavedDrafts()[0].session.id, 'for_workout');
  assert.equal(app.importData(JSON.stringify({history: [], savedDrafts: [incoming]})), true);
  assert.equal(app.getSavedDrafts().length, 1);
});

test('separate dated anonymous legacy workouts keep distinct logical identities after finishing one', () => {
  const {app, draft, activate} = setup(); activate(draft('current'));
  const one=draft(undefined), two=draft(undefined);
  delete one.id; delete two.id;
  one.startTime=one.createdAt='2026-10-01T17:00:00Z';
  two.startTime=two.createdAt='2026-10-08T17:00:00Z';
  const data={history: [], sessions:[one,two]};
  assert.equal(app.importData(JSON.stringify(data)),true);
  const recovered=app.getSavedDrafts(); assert.equal(recovered.length,2);
  assert.notEqual(recovered[0].session.id,recovered[1].session.id);
  assert.equal(app.importData(JSON.stringify(data)),true);assert.equal(app.getSavedDrafts().length,2);
  assert.equal(app.restoreSavedDraft(recovered[0].recoveryId),true);
  assert.equal(app.finishSession(),true);
  assert.equal(app.restoreSavedDraft(recovered[1].recoveryId),true);
});

test('imported recovery loads never replace an available normal progression baseline', () => {
  const {app}=setup(); const name=app.routine[0].exercises[0].name;
  app.lastWeights={[name]:{date:'2026-10-01',sets:[{weight:100,reps:8}]}};
  const recovery={date:'2026-10-20',deload:true,sets:[{weight:80,reps:8}]};
  assert.equal(app.importData(JSON.stringify({history:[],lastWeights:{[name]:recovery}})),true);
  assert.equal(app.lastWeights[name].sets[0].weight,100);
  assert.equal(app.importData(JSON.stringify({history:[{id:'recovery',date:'2026-10-20',deload:true,exercises:{[name]:{sets:recovery.sets}}}],lastWeights:{[name]:{...recovery,deload:false}}})),true);
  assert.equal(app.lastWeights[name].sets[0].weight,100);
});

test('older imported equipment is reconciled before it can show a new machine label or setup', () => {
  const {app,draft}=setup();const routine=clone(app.routine), ex=routine[2].exercises[0];
  ex.name='Incline Dumbbell Bench Press';
  const incoming=draft('old-equipment',2,40);
  incoming.logs[ex.id].forEach(set=>{set.exerciseName=ex.name;set.weight=40;});
  assert.equal(app.importData(JSON.stringify({routine,history:[],sessions:[incoming]})),true);
  const restored=app.loadSession(2),view=Object.assign(Object.create(app),{session:restored});
  assert.equal(view.getEffectiveExerciseName(ex.id,app.routine[2].exercises[0]),ex.name);
  assert.equal(restored.logs[ex.id][0].weight,40);
  const count=app.getSavedDrafts().length;
  assert.equal(app.importData(JSON.stringify({routine,history:[],sessions:[incoming]})),true);
  assert.equal(app.getSavedDrafts().length,count);
});

test('deliberate routine replacement preserves the original equipment of active and retained drafts', () => {
  const {app,draft,activate}=setup();const current=draft('smith-active',2,90);activate(current);
  const routine=clone(app.routine), ex=routine[2].exercises[0],original=ex.name;
  ex.name='Incline Dumbbell Bench Press';ex.equipmentRepairVersion=1;
  assert.equal(app.importData(JSON.stringify({routine,history:[]}),{restoreSettings:true}),true);
  assert.equal(app.routine[2].exercises[0].name,ex.name);
  assert.equal(app.getEffectiveExerciseName(ex.id,app.routine[2].exercises[0]),original);
  assert.equal(app.session.logs[ex.id][0].weight,90);
});

test('malformed skipped metadata is rejected before any storage mutation', () => {
  const {app,draft,snapshot}=setup();
  for(const flag of [true,'yes']) {
    const incoming=draft('invalid');const set=Object.values(incoming.logs)[0][0];set.skipped=flag;
    const before=snapshot();assert.throws(()=>app.prepareBackupImport({sessions:[incoming]}),/sessions/);assert.deepEqual(snapshot(),before);
  }
});
