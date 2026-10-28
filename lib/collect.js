'use strict';

/**
 * Collect: copy locally-ignored work product (.scratch/<TICKET>, docs/plans,
 * docs/testcases) from a worktree back into the main checkout before the
 * worktree is removed.
 *
 * Why this exists: those paths are excluded from git, so removing a worktree
 * deletes them without warning and nothing recovers them afterwards.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const AREAS = ['.scratch', 'docs/plans', 'docs/testcases'];

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    return null;
  }
}

function mainCheckout(cwd) {
  const common = git(['rev-parse', '--git-common-dir'], cwd);
  if (!common) return null;
  if (!path.isAbsolute(common)) return git(['rev-parse', '--show-toplevel'], cwd);

  const main = path.dirname(common);
  return git(['rev-parse', '--show-toplevel'], main) ? main : null;
}

function isLinkedWorktree(cwd) {
  const main = mainCheckout(cwd);
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (!main || !top) return false;
  return path.resolve(main) !== path.resolve(top);
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function copyTree(from, to, opts) {
  const dryRun = Boolean(opts && opts.dryRun);
  const files = walk(from);
  const copied = [];
  const clashes = [];

  for (const file of files) {
    const rel = path.relative(from, file);
    const target = path.join(to, rel);

    if (fs.existsSync(target)) {
      if (fs.readFileSync(target).equals(fs.readFileSync(file))) continue;
      clashes.push(rel);
      continue;
    }

    copied.push(rel);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
  }

  return { copied, clashes };
}

function collect(cwd, opts) {
  const dryRun = Boolean(opts && opts.dryRun);
  const areas = (opts && opts.areas) || AREAS;

  const main = mainCheckout(cwd);
  if (!main) {
    const error = new Error('Khong tim thay git repo quanh thu muc hien tai.');
    error.code = 'NO_PROJECT';
    throw error;
  }

  const source = git(['rev-parse', '--show-toplevel'], cwd);
  if (!source) {
    const error = new Error('Thu muc hien tai khong nam trong git work tree.');
    error.code = 'NO_PROJECT';
    throw error;
  }

  const results = [];
  for (const area of areas) {
    const from = path.join(source, area);
    if (!fs.existsSync(from)) continue;

    const to = path.join(main, area);
    const out = copyTree(from, to, { dryRun });
    if (!out.copied.length && !out.clashes.length) continue;
    results.push({ area: area, copied: out.copied, clashes: out.clashes });
  }

  return {
    source: source,
    main: main,
    isWorktree: path.resolve(source) !== path.resolve(main),
    dryRun: dryRun,
    results: results,
  };
}

module.exports = { collect: collect, mainCheckout: mainCheckout, isLinkedWorktree: isLinkedWorktree, copyTree: copyTree, AREAS: AREAS };
