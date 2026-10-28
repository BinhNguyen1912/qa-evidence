'use strict';

// Desktop output: one folder named after the ticket, containing everything a
// reviewer needs. Overwriting an older run is allowed, but existing folders are
// listed so nothing is lost silently.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function desktopDir() {
  return process.env.QA_EVIDENCE_DESKTOP || path.join(os.homedir(), 'Desktop');
}

function ticketFolder(ticket) {
  const clean = String(ticket).toUpperCase().replace(/[^A-Z0-9-]/g, '-');
  return path.join(desktopDir(), clean);
}

function prepare(ticket, { timestamp }) {
  const dir = ticketFolder(ticket);
  const previous = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name !== '.DS_Store' && name !== 'runs')
    : [];
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  if (previous.length) {
    // Keep a record of what was replaced, so a later question about a missing
    // screenshot has an answer.
    fs.writeFileSync(
      path.join(dir, 'runs', timestamp + '-thay-the.json'),
      JSON.stringify({ replacedAt: new Date().toISOString(), previousFiles: previous }, null, 2) + '\n',
    );
    // Delete the previous run's files. Leaving them behind means a stale
    // failure screenshot sits next to a fresh green report, and an attach step
    // that globs the folder would upload both as if they were this run.
    for (const name of previous) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }
  return { dir, previous };
}

function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'case';
}

module.exports = { prepare, ticketFolder, desktopDir, slug };
