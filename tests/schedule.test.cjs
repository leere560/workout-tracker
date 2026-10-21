const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { DEFAULT_ROUTINE } = require('../routine-data.js');
const clone = value => JSON.parse(JSON.stringify(value));
const local = (day, hour = 12) => new Date(2026, 9, day, hour);

function setup() {
  const values = new Map();
  const context = vm.createContext({ console, Date, document: { addEventListener() {} }, localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../routine-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + ';globalThis.App = WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, { routine: clone(DEFAULT_ROUTINE), history: [], storageKeys: { currentSessionPrefix: 'gym_session_', legacyCurrentSession: 'legacy' } });
  const save = (index, fields = {}) => {
    const day = app.routine[index];
    const session = { id: `draft-${index}`, dayId: day.id, logs: { set: [{ weight: 100, reps: 8, completed: false }] }, ...fields };
    values.set(app.getSessionKey(day.id), JSON.stringify(session));
    return session;
  };
  const finish = (index, date = local(21), fields = {}) => {
    const record = { dayId: app.routine[index].id, dayTitle: app.routine[index].title, date: date.toISOString(), ...fields };
    app.history.push(record);
    return record;
  };
  return { app, values, save, finish };
}

test('schedule chooses today or the next scheduled day for every weekday', () => {
  const { app } = setup();
  [4, 0, 0, 1, 1, 2, 3].forEach((expected, index) => {
    assert.equal(app.getSuggestedDayIndex(local(19 + index)), expected);
    assert.equal(app.getResumeDayIndex(local(19 + index)), expected);
  });
});

test('confirmed completion, including early completion, skips the matching workout this week', () => {
  const { app, finish } = setup();
  finish(0, local(21), { totalCompletedSets: 1 });
  assert.equal(app.getResumeDayIndex(local(21)), 1);
  assert.equal(app.getSuggestedDayIndex(local(22)), 1);
  finish(1, local(21), { totalCompletedSets: 1 });
  assert.equal(app.getSuggestedDayIndex(local(21)), 2);
  app.history = [];
  finish(4, local(19));
  assert.equal(app.getSuggestedDayIndex(local(19)), 0);
});

test('missed workouts do not displace the next schedule and old weeks never skip a new occurrence', () => {
  const { app, finish } = setup();
  assert.equal(app.getSuggestedDayIndex(local(22)), 1);
  for (let index = 0; index < 5; index++) finish(index, local(19));
  assert.equal(app.getSuggestedDayIndex(local(21)), 4);
  assert.equal(app.getSuggestedDayIndex(local(25)), 4);
  assert.equal(app.getSuggestedDayIndex(local(26)), 4);
  assert.equal(app.getSuggestedDayIndex(local(28)), 0);
});

test('history uses stable day ID, then snapshot ID, then exact titles only', () => {
  const { app, finish } = setup();
  finish(0, local(21), { dayId: undefined, sessionSnapshot: { dayId: app.routine[0].id } });
  assert.equal(app.getSuggestedDayIndex(local(21)), 1);
  app.history = [{ dayTitle: 'Wed - Upper A', date: '2026-10-21' }];
  assert.equal(app.getSuggestedDayIndex(local(21)), 1);
  app.history[0].dayTitle = 'Wed';
  assert.equal(app.getSuggestedDayIndex(local(21)), 0);
  app.history = [{ dayId: 'removed-day', dayTitle: app.routine[0].title, sessionSnapshot: { dayId: app.routine[0].id }, date: '2026-10-21' }];
  assert.equal(app.getSuggestedDayIndex(local(21)), 0);
  app.routine[0].title = 'My chest workout';
  app.history = [{ dayTitle: 'Wed - Upper A', date: '2026-10-21' }];
  assert.equal(app.getSuggestedDayIndex(local(21)), 1);
});

test('schedule resolves stable IDs after reordering or renaming and accepts custom weekday prefixes', () => {
  const { app } = setup();
  app.routine.reverse();
  app.routine.forEach(day => { day.title = 'My edited title'; });
  assert.equal(app.getSuggestedDayIndex(local(21)), 4);
  assert.equal(app.getSuggestedDayIndex(local(19)), 0);
  app.routine = [{ id: 'custom', title: 'Tuesday - Custom', exercises: [] }, { id: 'free', title: 'Any day', exercises: [] }];
  assert.equal(app.getSuggestedDayIndex(local(19)), 0);
  assert.equal(app.getSuggestedDayIndex(local(21)), 0);
  app.routine = [{ id: 'free', title: 'Any day', exercises: [] }];
  assert.equal(app.getResumeDayIndex(local(21)), 0);
});

test('old Monday drafts and automatic save timestamps do not override Wednesday', () => {
  const { app, values, save } = setup();
  save(4, { startTime: local(19).toISOString(), updatedAt: local(21).toISOString(), createdAt: local(21).toISOString() });
  values.set('gym_last_active_day_v1', app.routine[4].id);
  assert.equal(app.getResumeDayIndex(local(21)), 0);
  save(4, { lastInteractionAt: local(19).toISOString(), startTime: local(21).toISOString() });
  assert.equal(app.getResumeDayIndex(local(21)), 0);
  save(4, { lastInteractionAt: null, startTime: local(21).toISOString() });
  assert.equal(app.getResumeDayIndex(local(21)), 0);
});

test('today actual activity resumes an off-schedule workout with most recent activity winning', () => {
  const { app, values, save } = setup();
  save(1, { lastInteractionAt: local(21, 10).toISOString() });
  save(4, { lastInteractionAt: local(21, 9).toISOString() });
  values.set('gym_last_active_day_v1', app.routine[4].id);
  assert.equal(app.getResumeDayIndex(local(21)), 1);
  save(4, { lastInteractionAt: local(21, 10).toISOString() });
  assert.equal(app.getResumeDayIndex(local(21)), 4);
  values.delete('gym_last_active_day_v1');
  assert.equal(app.getResumeDayIndex(local(21)), 1);
});

test('legacy activity uses today start or completed set times, including warmups, without requiring IDs', () => {
  const { app, save } = setup();
  save(1, { id: undefined, startTime: local(21).toISOString() });
  assert.equal(app.getResumeDayIndex(local(21)), 1);
  save(1, { startTime: local(19).toISOString(), logs: { set: [{ completed: true, completedAt: local(21).toISOString() }] } });
  assert.equal(app.getResumeDayIndex(local(21)), 1);
  save(1, { startTime: local(19).toISOString(), warmups: { set: [{ completed: true, completedAt: local(21).toISOString() }] } });
  assert.equal(app.getResumeDayIndex(local(21)), 1);
  save(1, { startTime: local(19).toISOString(), warmups: { set: [{ completed: false, completedAt: local(21).toISOString() }] } });
  assert.equal(app.getResumeDayIndex(local(21)), 0);
});

test('archived session IDs cannot resume and reopening by removing the archive restores eligibility', () => {
  const { app, save, finish } = setup();
  const session = save(1, { lastInteractionAt: local(21).toISOString() });
  finish(1, local(21), { sessionId: session.id });
  assert.equal(app.getResumeDayIndex(local(21)), 0);
  app.history = [];
  assert.equal(app.getResumeDayIndex(local(21)), 1);
});

test('legacy storage is considered only without a matching day-specific draft', () => {
  const { app, values, save } = setup();
  const session = save(1, { id: undefined, startTime: local(21).toISOString() });
  values.delete(app.getSessionKey(session.dayId));
  values.set('legacy', JSON.stringify(session));
  assert.equal(app.getResumeDayIndex(local(21)), 1);
  save(1, { logs: {}, initialLogs: {}, lastInteractionAt: null });
  assert.equal(app.getResumeDayIndex(local(21)), 0);
});

test('selection ignores malformed timestamps and storage without mutating date, routine, history or drafts', () => {
  const { app, values, save } = setup();
  save(4, { lastInteractionAt: 'bad', startTime: local(21).toISOString() });
  values.set(app.getSessionKey(app.routine[1].id), '{broken');
  app.history = [{ dayId: app.routine[0].id, date: 'not-a-date' }, null];
  const before = JSON.stringify({ values: [...values], routine: app.routine, history: app.history });
  const now = local(21, 23), time = now.getTime();
  assert.equal(app.getResumeDayIndex(now), 0);
  assert.equal(now.getTime(), time);
  assert.equal(JSON.stringify({ values: [...values], routine: app.routine, history: app.history }), before);
  assert.equal(app.getLocalDateKey('2026-02-30'), null);
  assert.equal(app.getLocalDateKey(null), null);
  assert.equal(app.getLocalWeekKey('bad'), null);
});

test('local week boundaries and calendar iteration work across both daylight-saving transitions', () => {
  const script = `
    const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
    const context = vm.createContext({ console, Date, document: { addEventListener() {} } });
    vm.runInContext(fs.readFileSync('routine-data.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('app.js', 'utf8') + ';globalThis.App=WorkoutApp;globalThis.routine=DEFAULT_ROUTINE;', context);
    const app = Object.create(context.App.prototype); app.routine = context.routine; app.history = [];
    assert.equal(app.getLocalDateKey(new Date('2026-10-26T04:59:59Z')), '2026-10-25');
    assert.equal(app.getLocalWeekKey(new Date('2026-10-26T04:59:59Z')), '2026-10-19');
    assert.equal(app.getLocalWeekKey(new Date('2026-10-26T05:00:00Z')), '2026-10-26');
    for (const [month, sunday] of [[2, 8], [10, 1]]) {
      const date = new Date(2026, month, sunday, 0, 30);
      app.history = [{dayId: app.routine[3].id, date: date.toISOString()}];
      assert.equal(app.getSuggestedDayIndex(date), 4);
      assert.equal(date.getHours(), 0);
      const monday = new Date(2026, month, sunday + 1, 0, 30);
      assert.equal(app.getLocalWeekKey(monday), app.getLocalDateKey(monday));
      app.history = [{dayId: app.routine[4].id, date: new Date(2026, month, sunday - 6, 12).toISOString()}];
      assert.equal(app.getSuggestedDayIndex(monday), 4);
    }
    assert.equal(app.getLocalDateKey('2026-10-19'), '2026-10-19');
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
