'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const excel = require('../lib/excel');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-excel-'));
}

function fakeTool(root, body) {
  const dir = path.join(root, 'docs', 'tools', 'testcase-excel');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tc-excel'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(dir, 'index.js'), body);
  return dir;
}

test('writtenFile picks the check-marked line, not the backup above it', () => {
  const output = [
    '• Đích       : docs/test-excel/a-20261028.xlsx',
    '• Backup     : docs/test-excel/a.backup-1.xlsx',
    '✓ docs/test-excel/a-20261028.xlsx — 1 case',
  ].join('\n');
  assert.strictEqual(excel.writtenFile(output), 'docs/test-excel/a-20261028.xlsx');
});

test('writtenFile prefers the result even when backup prints after it', () => {
  const output = [
    '✓ docs/test-excel/main.xlsx — 2 case',
    '• Backup     : docs/test-excel/main.backup-2.xlsx',
  ].join('\n');
  assert.strictEqual(excel.writtenFile(output), 'docs/test-excel/main.xlsx');
});

test('writtenFile returns null when the tool printed no result line', () => {
  assert.strictEqual(excel.writtenFile('• Đích : x.xlsx\n'), null);
  assert.strictEqual(excel.writtenFile(''), null);
});

test('findTool reports a missing tool instead of guessing a path', () => {
  const root = tmpdir();
  assert.strictEqual(excel.findTool(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('build refuses a checkout with no tool, with its own error code', () => {
  const root = tmpdir();
  assert.throws(
    () => excel.build(root, 'TRUST-1', {}),
    (error) => error.code === 'NO_EXCEL_TOOL',
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('build passes the ticket and the explicit design file to the tool', () => {
  const root = tmpdir();
  // Echo the argv so the test can assert what the child actually received.
  fakeTool(root, 'console.log("ARGV " + process.argv.slice(2).join(" "));\n');
  const result = excel.build(root, 'TRUST-1008', { design: '/abs/cases.json' });
  assert.match(result.output, /ARGV .*--ticket TRUST-1008/);
  assert.match(result.output, /--design \/abs\/cases\.json/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('build surfaces the tool error text instead of a bare exit code', () => {
  const root = tmpdir();
  fakeTool(root, 'console.error("Khong doc duoc case nao"); process.exit(1);\n');
  assert.throws(
    () => excel.build(root, 'TRUST-1', {}),
    (error) => error.code === 'EXCEL_FAILED' && /Khong doc duoc case nao/.test(error.message),
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('toolRoot falls back to the main checkout for a linked worktree', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
  assert.strictEqual(excel.findTool(root), null);
  assert.strictEqual(excel.toolRoot(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});
