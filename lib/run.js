'use strict';

// Orchestration: cases.json -> collection -> run -> evidence -> Desktop -> Jira.
//
// Each stage is reported, and a stage that cannot run is recorded as skipped
// with its reason. Nothing is written into the target project.

const fs = require('node:fs');
const path = require('node:path');

const { resolveProject, writeState } = require('./project');
const bru = require('./bru');
const evidence = require('./evidence');
const desktop = require('./desktop');
const shot = require('./shot');
const { readConfig, jiraConfigured, ensureSecretPermissions } = require('./config');
const { violations } = require('./testdata');
const { attachFiles } = require('./jira');

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    '-' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds())
  );
}

function readCases(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cases = Array.isArray(data) ? data : data.cases;
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error('File case khong co mang "cases": ' + file);
  }
  for (const [index, c] of cases.entries()) {
    if (!c.id) throw new Error('Case thu ' + (index + 1) + ' thieu "id".');
    if (!c.path) throw new Error('Case ' + c.id + ' thieu "path".');
  }
  return { meta: Array.isArray(data) ? {} : { ticket: data.ticket, baseUrl: data.baseUrl }, cases };
}

function markdownSummary({ ticket, project, results, ranAt, baseUrl, pngNote }) {
  const counts = evidence.summaryOf(results);
  const lines = [
    '# ' + ticket + ' - Bang chung kiem thu API',
    '',
    '- Project: ' + project.name + ' (' + project.root + ')',
    '- Nhanh: ' + (project.branch || '-') + ' @ ' + (project.commit || '-'),
    '- Moi truong: ' + baseUrl,
    '- Thoi diem chay: ' + ranAt,
    '- Ket qua: Pass ' + counts.Pass + ' / Fail ' + counts.Fail + ' / Blocked ' + counts.Blocked,
    '',
    '| Ma | Ten case | Request | HTTP | Ket qua | Ghi chu |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of results) {
    lines.push(
      '| ' + r.id + ' | ' + r.name + ' | ' + (r.method || '') + ' ' + (r.endpoint || '') +
        ' | ' + (r.httpStatus === undefined ? '-' : r.httpStatus) + ' | ' + r.verdict +
        ' | ' + String(r.note || '').replace(/\|/g, '/') + ' |',
    );
  }
  if (pngNote) lines.push('', '> ' + pngNote);
  return lines.join('\n') + '\n';
}

async function run({ casesFile, ticket, baseUrl, token, cwd, attach = false, keepTemp = false }) {
  const project = resolveProject(cwd);
  const config = readConfig();
  const { meta, cases } = readCases(casesFile);

  // Placeholder data is refused before anything runs: a green report built on
  // fake names proves nothing and would be attached to the ticket as evidence.
  const dataProblems = violations(casesFile);
  if (dataProblems.length) {
    const err = new Error(
      'Du lieu test chua dat: dung du lieu gia lap co hinh dang du lieu that ' +
        '(ten nguoi Viet, so tien that), khong dung placeholder.\n  - ' +
        dataProblems.join('\n  - '),
    );
    err.code = 'BAD_TEST_DATA';
    throw err;
  }
  const resolvedTicket = ticket || meta.ticket;
  if (!resolvedTicket) {
    throw new Error('Thieu ma ticket. Truyen --ticket TRUST-123 hoac them "ticket" trong file case.');
  }
  const resolvedBaseUrl = baseUrl || meta.baseUrl || (config.baseUrl || 'http://localhost:3000');
  const ranAt = timestamp();
  const stages = [];

  // Work in a temp area so the project tree is never touched.
  const workDir = path.join(
    require('node:os').tmpdir(),
    'qa-evidence',
    resolvedTicket + '-' + ranAt,
  );
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const collectionDir = path.join(workDir, 'collection');
  const reportFile = path.join(workDir, 'bruno-results.json');

  // Most endpoints here are guarded by a JWT. Running without a token would turn
  // every case into a misleading 401 "Fail", so say so instead.
  const needsAuth = cases.some((c) => c.auth !== false);
  const resolvedToken = token || process.env.QA_EVIDENCE_TOKEN || null;
  if (needsAuth && !resolvedToken) {
    throw new Error(
      'Cac case nay can dang nhap (Bearer token) nhung chua co token.\n' +
        '  Chay:  qa-evidence run ' + resolvedTicket + ' --token <JWT>\n' +
        '  Hoac:  export QA_EVIDENCE_TOKEN=<JWT>\n' +
        '  Endpoint cong khai thi them "auth": false vao case do.',
    );
  }

  bru.writeCollection({
    collectionDir,
    cases,
    baseUrl: resolvedBaseUrl,
    token: resolvedToken,
  });
  stages.push({ stage: 'collection', ok: true, detail: cases.length + ' case' });

  const runResult = bru.runCollection({ collectionDir, reportFile });
  const results = bru.normalizeReport({ reportFile, cases });
  const counts = evidence.summaryOf(results);
  stages.push({
    stage: 'run',
    ok: counts.Fail === 0 && counts.Blocked === 0,
    detail: 'Pass ' + counts.Pass + ' / Fail ' + counts.Fail + ' / Blocked ' + counts.Blocked,
  });

  writeState(project, { lastTicket: resolvedTicket, lastRun: ranAt });

  // Evidence package
  const { dir, previous } = desktop.prepare(resolvedTicket, { timestamp: ranAt });
  const runJson = {
    ticket: resolvedTicket,
    ranAt,
    project: { name: project.name, branch: project.branch, commit: project.commit },
    baseUrl: resolvedBaseUrl,
    counts,
    results,
  };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(runJson, null, 2) + '\n');

  // The backend workbook tool discovers results at .scratch/<ticket>/results.json,
  // not on the Desktop. Keep that copy so the Excel step can pick the run up.
  const scratchDir = path.join(project.root, '.scratch', resolvedTicket);
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.writeFileSync(path.join(scratchDir, 'results.json'), JSON.stringify(runJson, null, 2) + '\n');

  const runHtml = path.join(dir, 'bang-chung-' + ranAt + '.html');
  evidence.writeFile(
    runHtml,
    evidence.renderRunReport({
      ticket: resolvedTicket,
      project,
      results,
      ranAt,
      baseUrl: resolvedBaseUrl,
    }),
  );

  const failures = results.filter((r) => r.verdict !== 'Pass');
  const failureHtml = [];
  for (const item of failures) {
    const file = path.join(dir, 'case-' + desktop.slug(item.id + '-' + item.name) + '.html');
    evidence.writeFile(file, evidence.renderFailureReport({ ticket: resolvedTicket, project, item, ranAt }));
    failureHtml.push(file);
  }

  const pairs = [
    { htmlFile: runHtml, pngFile: runHtml.replace(/\.html$/, '.png') },
    ...failureHtml.map((htmlFile) => ({ htmlFile, pngFile: htmlFile.replace(/\.html$/, '.png') })),
  ];
  const shots = await shot.renderAll(pairs);
  stages.push({
    stage: 'screenshot',
    ok: !shots.skipped,
    detail: shots.skipped ? shots.reason : pairs.length + ' anh PNG',
  });

  fs.writeFileSync(
    path.join(dir, 'bao-cao.md'),
    markdownSummary({
      ticket: resolvedTicket,
      project,
      results,
      ranAt,
      baseUrl: resolvedBaseUrl,
      pngNote: shots.skipped ? 'Khong co anh PNG: ' + shots.reason : undefined,
    }),
  );

  // Jira attach is opt-in and never blocks the local result.
  let jira = { skipped: true, reason: 'Chua bat --attach (them --attach de day len Jira)' };
  if (attach) {
    if (!jiraConfigured()) {
      jira = { skipped: true, reason: 'Chua cau hinh Jira (chay: qa-evidence setup-jira)' };
    } else {
      try {
        const files = [
          path.join(dir, 'results.json'),
          path.join(dir, 'bao-cao.md'),
          runHtml,
          ...shots.pngs,
        ];
        const perm = ensureSecretPermissions();
        if (perm) stages.push({ stage: 'secrets', ok: true, detail: perm });
        jira = { skipped: false, ...(await attachFiles({ ticket: resolvedTicket, files, jira: config.jira })) };
      } catch (error) {
        jira = { skipped: false, error: error.message };
      }
    }
  }
  stages.push({
    stage: 'jira',
    ok: jira.skipped ? null : Boolean(jira.uploaded) && !jira.error,
    detail: jira.skipped ? jira.reason : jira.error || (jira.uploaded || []).length + ' file',
  });

  if (!keepTemp) fs.rmSync(workDir, { recursive: true, force: true });

  return { ticket: resolvedTicket, project, dir, previous, results, counts, stages, jira, ranAt, runResult };
}

module.exports = { run, readCases, timestamp, markdownSummary };
