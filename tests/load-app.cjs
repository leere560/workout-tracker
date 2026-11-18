const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const APP_SCRIPTS = [
  'src/migrations.js',
  'src/storage.js',
  'src/progression.js',
  'src/timer.js',
  'src/view-workout.js',
  'src/view-insights.js',
  'src/view-routine.js',
  'app.js',
];

function loadApp(context, { includeData = false } = {}) {
  const files = includeData ? ['routine-data.js', ...APP_SCRIPTS] : APP_SCRIPTS;
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    const suffix = file === 'app.js' ? '\nglobalThis.App = WorkoutApp;' : '';
    vm.runInContext(code + suffix, context, { filename: file });
  }
  return context.App;
}

module.exports = { loadApp, APP_SCRIPTS };
