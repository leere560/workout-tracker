const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('the existing schedule, exercises, prescribed sets and rep ranges are preserved', () => {
  const routine = vm.runInNewContext(read('routine-data.js') + '; DEFAULT_ROUTINE;');
  const actual = routine.map(d => ({ id: d.id, title: d.title, exercises: d.exercises.map(e => ({
    id: e.id, name: e.name, sets: e.sets, targetReps: e.targetReps
  })) }));
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(read('tests/fixtures/original-program.json')));
});

test('all published release assets exist and the script versions match the worker', () => {
  const handlers = {};
  const assets = vm.runInNewContext(read('sw.js') + '; ASSETS_TO_CACHE;', {
    self: { addEventListener: (name, fn) => { handlers[name] = fn; } }
  });
  for (const asset of assets) {
    const filename = asset === './' ? 'index.html' : asset.replace('./', '').split('?')[0];
    assert.ok(fs.existsSync(path.join(root, filename)), filename);
  }
  const html = read('index.html');
  const scripts = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css)\?v=\d+)"/g)].map(m => './' + m[1]);
  for (const script of scripts) assert.ok(assets.includes(script), script + ' must be precached');
  const version = /const CACHE_NAME = 'workout-tracker-v(\d+)'/.exec(read('sw.js'))[1];
  assert.ok(read('app.js').includes(`Build v${version}`), 'Settings must display the installed release version');
});

test('service worker waits for explicit update and preserves unrelated caches', async () => {
  const currentCache = /const CACHE_NAME = '([^']+)'/.exec(read('sw.js'))[1];
  const handlers = {};
  const deleted = [];
  let skips = 0;
  let claimed = 0;
  const context = {
    self: {
      addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: () => { skips++; }, clients: { claim: async () => { claimed++; } }
    },
    caches: {
      open: async () => ({ addAll: async () => {} }),
      keys: async () => ['unrelated-cache', 'workout-tracker-old', currentCache],
      delete: async key => { deleted.push(key); }
    }
  };
  vm.runInNewContext(read('sw.js'), context);
  let completion;
  handlers.install({ waitUntil: promise => { completion = promise; } });
  await completion;
  assert.equal(skips, 0);
  handlers.message({ data: { type: 'APPLY_UPDATE' } });
  assert.equal(skips, 1);
  handlers.activate({ waitUntil: promise => { completion = promise; } });
  await completion;
  assert.deepEqual(deleted, ['workout-tracker-old']);
  assert.equal(claimed, 1);
});

test('offline navigation returns the installed release shell', async () => {
  const handlers = {};
  const shell = { html: 'installed release' };
  let requested;
  vm.runInNewContext(read('sw.js'), {
    URL,
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: { open: async () => ({ match: async request => request === './index.html' ? shell : undefined }) },
    fetch: async () => { throw Error('offline'); }
  });
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/?launch=1' }, respondWith: p => { requested = p; } });
  assert.equal(await requested, shell);
});
