const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const data = vm.runInNewContext(fs.readFileSync(path.join(root, 'routine-data.js'), 'utf8') + ';({routine: DEFAULT_ROUTINE, retired: RETIRED_MONDAY_ABDUCTION});');
const oldRoutine = JSON.parse(JSON.stringify(data.routine));
const monday = oldRoutine.find(day => day.id === 'mon__lower_b');
monday.exercises.splice(4, 0, JSON.parse(JSON.stringify(data.retired)));
monday.exercises.filter(ex => ['mon__lower_b_ex2', 'mon__lower_b_ex5'].includes(ex.id)).forEach((ex, i) => {ex.superset = {id: 'lower_b_leg_press_calf', tag: i ? '2B' : '2A', rest: '60 sec', restSeconds: 60};});
(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    for (const width of [375, 402, 430]) {
      const context = await browser.newContext({viewport: {width, height: 874}}), page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => {if (['error', 'warning'].includes(e.type())) errors.push(e.text());});
      await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:8766/preview.html');
      await page.evaluate(routine => {
        const oldApp = Object.assign(Object.create(app), {routine, session: null});
        const draft = oldApp.initNewSession(4);
        Object.assign(draft.logs.mon__lower_b_ex_back_ext[0], {weight: 40, reps: 15, completed: true, needsBaseline: false});
        draft.lastInteractionAt = '2026-11-02T17:00:00Z';
        localStorage.clear(); localStorage.setItem(app.storageKeys.routine, JSON.stringify(routine));
        localStorage.setItem(app.getSessionKey(draft.dayId), JSON.stringify(draft));
        localStorage.setItem('gym_last_active_day_v1', draft.dayId);
      }, oldRoutine);
      await page.reload(); await page.selectOption('#workoutDayPicker', '4');
      const state = await page.evaluate(() => {
        const d = app.routine[4], press = d.exercises.find(ex => ex.id === 'mon__lower_b_ex2'), calf = d.exercises.find(ex => ex.id === 'mon__lower_b_ex5');
        return {names: d.exercises.map(ex => ex.name), count: app.getWorkingSetCounts().total, pressRest: app.getRestSeconds(press), calfRest: app.getRestSeconds(calf), pressSuperset: press.superset, calfSuperset: calf.superset, saved: app.session.logs.mon__lower_b_ex_back_ext[0], overflow: document.documentElement.scrollWidth > innerWidth};
      });
      assert.equal(state.names.includes('Seated Hip Abduction'), false); assert.equal(state.count, 17); // 16 planned plus one completed retired set.
      assert.equal(state.pressRest, 180); assert.equal(state.calfRest, 120); assert.equal(state.pressSuperset, null); assert.equal(state.calfSuperset, null);
      assert.equal(state.saved.weight, 40); assert.equal(state.saved.completed, true); assert.equal(state.overflow, false);
      assert.equal(await page.locator('.superset-enabled-input').count(), 0);
      assert.deepEqual(errors, []); console.log(`${width}px: Monday layout, independent rests, and old draft preservation passed`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
