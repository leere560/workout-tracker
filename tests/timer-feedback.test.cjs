const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('touch users can see when the minimum rest becomes available', () => {
  let now = 1000000;
  const context = vm.createContext({ document: { addEventListener() {} }, Date: class extends Date { static now() { return now; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8') + '\nglobalThis.App = WorkoutApp;', context);
  const app = Object.create(context.App.prototype);
  app.timer = { startedAt: now, minimumDuration: 120 };
  assert.equal(app.getMinimumRestLabel(), 'Minimum rest: 2:00 left');
  now += 90000;
  assert.equal(app.getMinimumRestLabel(), 'Minimum rest: 0:30 left');
  now += 30000;
  assert.equal(app.getMinimumRestLabel(), 'Minimum rest complete');
  app.timer = { startedAt: now, minimumDuration: 0 };
  assert.equal(app.getMinimumRestLabel(), 'Superset rest');
});
