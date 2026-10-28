'use strict';

/**
 * Project resolution: work out which codebase a run belongs to, without ever
 * writing into that codebase. Everything the tool needs is derived from the
 * current working directory and cached in the tool's own state directory.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const HOME_DIR = process.env.QA_EVIDENCE_HOME || path.join(os.homedir(), '.qa-evidence');
const STATE_DIR = path.join(HOME_DIR, 'state');

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Walk up from `start` until a directory containing package.json is found. */
function findProjectRoot(start) {
  const gitRoot = git(['rev-parse', '--show-toplevel'], start);
  if (gitRoot) return gitRoot;

  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readPackageJson(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Shape the run needs. Every field is optional; a missing one degrades the
 * report, never throws.
 */
function resolveProject(cwd = process.cwd()) {
  const root = findProjectRoot(cwd);
  if (!root) {
    const err = new Error(
      'Không tìm thấy project quanh thư mục hiện tại. Chạy lệnh bên trong thư mục ' +
        'project, hoặc truyền --project <duong-dan>.',
    );
    err.code = 'NO_PROJECT';
    throw err;
  }

  const pkg = readPackageJson(root) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const commit = git(['rev-parse', '--short', 'HEAD'], root);

  return {
    root,
    name: pkg.name || path.basename(root),
    isNestJs: Boolean(deps['@nestjs/core']),
    hasBrunoDir: fs.existsSync(path.join(root, 'docs', 'bruno')),
    hasTcExcel: fs.existsSync(path.join(root, 'docs', 'tools', 'testcase-excel', 'tc-excel')),
    branch,
    commit,
    dirty: Boolean(git(['status', '--porcelain'], root)),
  };
}

/** Stable per-project id so state files never collide across checkouts. */
function projectKey(project) {
  return crypto.createHash('sha256').update(project.root).digest('hex').slice(0, 12);
}

function statePath(project) {
  return path.join(STATE_DIR, projectKey(project) + '.json');
}

function readState(project) {
  const file = statePath(project);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(project, patch) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const next = { ...readState(project), ...patch, root: project.root };
  fs.writeFileSync(statePath(project), JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = {
  HOME_DIR,
  STATE_DIR,
  resolveProject,
  findProjectRoot,
  projectKey,
  statePath,
  readState,
  writeState,
};
