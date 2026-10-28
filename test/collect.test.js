'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { collect, mainCheckout, isLinkedWorktree } = require('../lib/collect');

function sh(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-collect-'));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');

  fs.mkdirSync(main, { recursive: true });
  sh(['init', '-q', '-b', 'main'], main);
  sh(['config', 'user.email', 'qa@local'], main);
  sh(['config', 'user.name', 'QA'], main);
  write(path.join(main, 'README.md'), 'x\n');
  sh(['add', '-A'], main);
  sh(['commit', '-q', '-m', 'init'], main);
  sh(['worktree', 'add', '-q', wt, '-b', 'probe'], main);

  return { base, main, wt };
}

test('nhan ra worktree va tro ve dung repo chinh', () => {
  const { main, wt } = fixture();

  assert.strictEqual(fs.realpathSync(mainCheckout(wt)), fs.realpathSync(main));
  assert.strictEqual(isLinkedWorktree(wt), true);
  assert.strictEqual(isLinkedWorktree(main), false);
});

test('gom .scratch va docs/plans tu worktree ve repo chinh', () => {
  const { main, wt } = fixture();
  write(path.join(wt, '.scratch', 'TRUST-1', 'cases.json'), '{"ticket":"TRUST-1"}\n');
  write(path.join(wt, 'docs', 'plans', 'TRUST-1-Plan.md'), '# plan\n');

  const result = collect(wt);

  assert.strictEqual(result.isWorktree, true);
  assert.strictEqual(fs.readFileSync(path.join(main, '.scratch', 'TRUST-1', 'cases.json'), 'utf8'), '{"ticket":"TRUST-1"}\n');
  assert.strictEqual(fs.readFileSync(path.join(main, 'docs', 'plans', 'TRUST-1-Plan.md'), 'utf8'), '# plan\n');
  assert.strictEqual(result.results.length, 2);
});

test('dry-run khong copy file nao', () => {
  const { main, wt } = fixture();
  write(path.join(wt, '.scratch', 'TRUST-2', 'cases.json'), '{"ticket":"TRUST-2"}\n');

  const result = collect(wt, { dryRun: true });

  assert.strictEqual(result.results[0].copied.length, 1);
  assert.strictEqual(fs.existsSync(path.join(main, '.scratch', 'TRUST-2', 'cases.json')), false);
});

test('khong ghi de file repo chinh da co noi dung khac', () => {
  const { main, wt } = fixture();
  write(path.join(main, 'docs', 'plans', 'TRUST-3-Plan.md'), '# ban trong repo chinh\n');
  write(path.join(wt, 'docs', 'plans', 'TRUST-3-Plan.md'), '# ban trong worktree\n');

  const result = collect(wt);

  assert.strictEqual(result.results[0].clashes.length, 1);
  assert.strictEqual(
    fs.readFileSync(path.join(main, 'docs', 'plans', 'TRUST-3-Plan.md'), 'utf8'),
    '# ban trong repo chinh\n',
  );
});

test('file giong het khong bao xung dot va khong copy lai', () => {
  const { main, wt } = fixture();
  write(path.join(main, 'docs', 'plans', 'TRUST-4-Plan.md'), '# giong nhau\n');
  write(path.join(wt, 'docs', 'plans', 'TRUST-4-Plan.md'), '# giong nhau\n');

  const result = collect(wt);

  assert.strictEqual(result.results.length, 0);
});

test('worktree khong co file local nao thi bao rong', () => {
  const { wt } = fixture();

  const result = collect(wt);

  assert.strictEqual(result.results.length, 0);
});

test('chay tu repo chinh thi bao khong phai worktree', () => {
  const { main } = fixture();

  const result = collect(main);

  assert.strictEqual(result.isWorktree, false);
});

test('thu muc khong phai git repo thi bao loi ro rang', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-nogit-'));

  assert.throws(() => collect(dir), (error) => error.code === 'NO_PROJECT');
});
