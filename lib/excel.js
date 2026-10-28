'use strict';

/**
 * Excel bridge: the test-case workbook belongs to the backend repo
 * (docs/tools/testcase-excel), which already reads .scratch/<ticket>/cases.json
 * on its own. This module only locates that tool and runs it, so the local
 * runner never re-implements the workbook.
 *
 * The tool lives under docs/, which is git-ignored: it exists in the main
 * checkout but never in a linked worktree. So the search starts from the main
 * checkout, and the child process runs there too.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mainCheckout } = require('./collect');

const TOOL_DIR = path.join('docs', 'tools', 'testcase-excel');
const LAUNCHER = path.join(TOOL_DIR, 'tc-excel');
const ENTRY = path.join(TOOL_DIR, 'index.js');

function findTool(root) {
  const full = path.join(root, LAUNCHER);
  return fs.existsSync(full) ? full : null;
}

/**
 * The workbook the tool just wrote. Prefer its check-marked success line:
 * a plain "last line ending in .xlsx" would pick the backup copy, which the
 * tool prints just above the result and also ends in .xlsx.
 */
function writtenFile(output) {
  const lines = String(output).split('\n').map((line) => line.trim());
  for (const line of lines) {
    if (!line.startsWith('\u2713')) continue;
    const beforeDash = line.split('\u2014')[0].trim();
    const candidate = beforeDash.split(' ').pop();
    if (candidate.endsWith('.xlsx')) return candidate;
  }
  return null;
}

/**
 * Where the workbook tool actually lives for a checkout: itself when present,
 * else the main checkout (worktrees never carry docs/).
 */
function toolRoot(checkout) {
  if (findTool(checkout)) return checkout;
  const main = mainCheckout(checkout);
  if (main && findTool(main)) return main;
  return null;
}

/**
 * Run the workbook generator for a ticket.
 * Returns { ok, file, output, toolRoot } or throws with a readable message.
 */
function build(checkout, ticket, options) {
  const opts = options || {};
  const root = toolRoot(checkout);
  if (!root) {
    const error = new Error(
      'Khong tim thay ' + LAUNCHER + ' o ca ' + checkout + ' lan repo chinh. ' +
        'Tool Excel nam trong repo backend, khong nam trong qa-evidence.',
    );
    error.code = 'NO_EXCEL_TOOL';
    throw error;
  }

  const args = [path.join(root, ENTRY), '--ticket', ticket];
  if (opts.results) args.push('--results', opts.results);
  if (opts.design) args.push('--design', opts.design);
  if (opts.out) args.push('--out', opts.out);
  if (opts.name) args.push('--name', opts.name);
  if (opts.quiet) args.push('--quiet');
  if (opts.dryRun) args.push('--dry-run');

  let output;
  try {
    output = execFileSync('node', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stdout || '') + String(error.stderr || '');
    const wrapped = new Error('Tool Excel bao loi:\n' + detail.trim());
    wrapped.code = 'EXCEL_FAILED';
    throw wrapped;
  }

  return { ok: true, file: writtenFile(output), output: output, toolRoot: root };
}

module.exports = { build: build, findTool: findTool, writtenFile: writtenFile, toolRoot: toolRoot };
