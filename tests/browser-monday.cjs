const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const data = vm.runInNewContext(fs.readFileSync(path.join(root, 'routine-data.js'), 'utf8') + ';({routine: DEFAULT_ROUTINE, retired: RETIRED_MONDAY_ABDUCTION});');
const oldRoutine = JSON.parse(JSON.stringify(data.routine));
const monday = oldRoutine.find(day => day.id === 'mon__lower_b');
monday.exercises = monday.exercises.filter(ex => ex.id !== 'mon__lower_b_ex_adduction');
monday.exercises.filter(ex => ['mon__lower_b_ex2', 'mon__lower_b_ex5'].includes(ex.id)).forEach(ex => {ex.superset = null;});
delete monday.adductionSupersetVersion;
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
        Object.assign(draft.logs.mon__lower_b_ex2[0], {weight: 180, reps: 8, completed: true, needsBaseline: false});
        draft.lastInteractionAt = '2026-11-08T17:00:00Z';
        localStorage.clear(); localStorage.setItem(app.storageKeys.routine, JSON.stringify(routine));
        localStorage.setItem(app.getSessionKey(draft.dayId), JSON.stringify(draft));
        localStorage.setItem('gym_last_active_day_v1', draft.dayId);
      }, oldRoutine);
      await page.reload(); await page.selectOption('#workoutDayPicker', '4');
      const state = await page.evaluate(() => {
        const d = app.routine[4], press = d.exercises.find(ex => ex.id === 'mon__lower_b_ex2'), calf = d.exercises.find(ex => ex.id === 'mon__lower_b_ex5'), abd = d.exercises.find(ex => ex.id === 'mon__lower_b_ex_back_ext'), add = d.exercises.find(ex => ex.id === 'mon__lower_b_ex_adduction');
        return {abd, add, count: app.getWorkingSetCounts().total, pressRest: app.getRestSeconds(press), calfRest: app.getRestSeconds(calf), pressSuperset: press.superset, calfSuperset: calf.superset, saved: app.session.logs.mon__lower_b_ex2[0], rows: app.session.logs.mon__lower_b_ex_adduction, overflow: document.documentElement.scrollWidth > innerWidth};
      });
      assert.equal(state.abd.name, 'Seated Hip Abduction'); assert.equal(state.abd.sets, 2); assert.equal(state.abd.targetReps, '12–20');
      assert.equal(state.add.name, 'Seated Hip Adduction'); assert.equal(state.add.sets, 2); assert.equal(state.add.targetReps, '12–20');
      assert.equal(state.count, 20); assert.equal(state.pressRest, 90); assert.equal(state.calfRest, 90);
      assert.equal(state.pressSuperset.id, 'lower_b_leg_press_calf'); assert.equal(state.calfSuperset.id, 'lower_b_leg_press_calf');
      assert.equal(state.saved.weight, 180); assert.equal(state.saved.completed, true); assert.equal(state.rows.length, 2); assert.equal(state.overflow, false);
      const summary = page.locator('.workout-overview > summary'); if (!await page.locator('.workout-overview').evaluate(el => el.open)) await summary.click();
      await page.locator('.overview-exercise[data-exid="mon__lower_b_ex_adduction"]').click();
      assert.equal(await page.locator('.exercise-name').textContent(), 'Seated Hip Adduction'); assert.equal(await page.locator('.set-row').count(), 2);
      await page.reload(); assert.equal(await page.evaluate(() => app.session.logs.mon__lower_b_ex2[0].weight), 180);
      assert.deepEqual(errors, []); console.log(`${width}px: added adduction, 90s superset rests, reload and saved progress passed`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
