'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// desktop.js resolves the ticket folder under the real Desktop, so each test
// points HOME at a scratch directory before requiring the module.
function withFakeHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-desktop-'));
  const previous = process.env.HOME;
  process.env.HOME = home;
  delete require.cache[require.resolve('../lib/desktop')];
  try {
    fn(require('../lib/desktop'), path.join(home, 'Desktop'));
  } finally {
    process.env.HOME = previous;
    delete require.cache[require.resolve('../lib/desktop')];
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('prepare deletes the previous run, so stale screenshots cannot be attached', () => {
  withFakeHome((desktop, root) => {
    const first = desktop.prepare('TRUST-1', { timestamp: '20260101-000001' });
    fs.writeFileSync(path.join(first.dir, 'results.json'), '{}\n');
    fs.writeFileSync(path.join(first.dir, 'bang-chung-cu.png'), 'old');

    const second = desktop.prepare('TRUST-1', { timestamp: '20260101-000002' });

    assert.strictEqual(second.dir, first.dir);
    assert.deepStrictEqual(second.previous.sort(), ['bang-chung-cu.png', 'results.json']);
    assert.strictEqual(fs.existsSync(path.join(second.dir, 'bang-chung-cu.png')), false);
    assert.strictEqual(fs.existsSync(root), true);
  });
});

test('prepare keeps the runs/ history folder across runs', () => {
  withFakeHome((desktop) => {
    const first = desktop.prepare('TRUST-2', { timestamp: '20260101-000001' });
    fs.writeFileSync(path.join(first.dir, 'old.png'), 'old');

    desktop.prepare('TRUST-2', { timestamp: '20260101-000002' });
    const runs = fs.readdirSync(path.join(first.dir, 'runs'));

    assert.ok(runs.some((name) => name.endsWith('-thay-the.json')), 'kept the replacement log');
  });
});

test('prepare records the replaced files before deleting them', () => {
  withFakeHome((desktop) => {
    const first = desktop.prepare('TRUST-3', { timestamp: '20260101-000001' });
    fs.writeFileSync(path.join(first.dir, 'gone.png'), 'old');

    const second = desktop.prepare('TRUST-3', { timestamp: '20260101-000002' });
    const log = JSON.parse(
      fs.readFileSync(path.join(second.dir, 'runs', '20260101-000002-thay-the.json'), 'utf8'),
    );

    assert.deepStrictEqual(log.previousFiles, ['gone.png']);
  });
});

test('prepare on a fresh ticket creates the folder without complaining', () => {
  withFakeHome((desktop) => {
    const fresh = desktop.prepare('TRUST-4', { timestamp: '20260101-000001' });
    assert.deepStrictEqual(fresh.previous, []);
    assert.strictEqual(fs.existsSync(fresh.dir), true);
  });
});

test('a second run leaves exactly the files of that run, not the first', () => {
  withFakeHome((desktop) => {
    const first = desktop.prepare('TRUST-5', { timestamp: '20260101-000001' });
    fs.writeFileSync(path.join(first.dir, 'results.json'), '{"run":1}\n');

    const second = desktop.prepare('TRUST-5', { timestamp: '20260101-000002' });
    fs.writeFileSync(path.join(second.dir, 'results.json'), '{"run":2}\n');

    const files = fs.readdirSync(second.dir).filter((name) => name !== 'runs');
    assert.deepStrictEqual(files, ['results.json']);
    assert.match(fs.readFileSync(path.join(second.dir, 'results.json'), 'utf8'), /"run":2/);
  });
});
