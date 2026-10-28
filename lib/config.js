'use strict';

// Configuration and secrets.
//
// Secrets never live in this repository: they are read from one file under the
// tool's home directory with 0600 permissions. The sample file in the repo
// documents the keys and contains no values.

const fs = require('node:fs');
const path = require('node:path');
const { HOME_DIR } = require('./project');

const CONFIG_FILE = path.join(HOME_DIR, 'config.json');
const SECRETS_FILE = path.join(HOME_DIR, 'secrets.json');

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('File cau hinh bi loi JSON: ' + file + ' (' + error.message + ')');
  }
}

function readSecrets() {
  const secrets = { ...readJson(SECRETS_FILE), ...((readJson(CONFIG_FILE).jira) || {}) };
  for (const key of ['baseUrl', 'email', 'apiToken']) {
    if (process.env['JIRA_' + key.replace(/[A-Z]/g, (m) => '_' + m).toUpperCase()]) {
      secrets[key] = process.env['JIRA_' + key.replace(/[A-Z]/g, (m) => '_' + m).toUpperCase()];
    }
  }
  return secrets;
}

function jiraConfigured() {
  const s = readSecrets();
  return Boolean(s.baseUrl && s.email && s.apiToken);
}

function readConfig() {
  return { ...readJson(CONFIG_FILE), jira: readSecrets() };
}

function ensureSecretPermissions() {
  if (!fs.existsSync(SECRETS_FILE)) return;
  const mode = fs.statSync(SECRETS_FILE).mode & 0o777;
  if (mode & 0o077) {
    fs.chmodSync(SECRETS_FILE, 0o600);
    return 'da sua quyen file secrets thanh 600';
  }
  return null;
}

module.exports = { HOME_DIR, CONFIG_FILE, SECRETS_FILE, readConfig, readSecrets, jiraConfigured, ensureSecretPermissions };
