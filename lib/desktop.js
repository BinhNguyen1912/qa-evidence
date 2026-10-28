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
    ? fs.readdirSync(dir).filter((name) => name !== '.DS_Store')
    : [];
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  if (previous.length) {
    fs.writeFileSync(
      path.join(dir, 'runs', timestamp + '-thay-the.json'),
      JSON.stringify({ replacedAt: new Date().toISOString(), previousFiles: previous }, null, 2) + '\n',
    );
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
