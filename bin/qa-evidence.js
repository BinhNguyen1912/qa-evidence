#!/usr/bin/env node
'use strict';

// qa-evidence: local QA evidence runner.
//
// Commands:
//   qa-evidence doctor          check the environment for a run
//   qa-evidence init <TICKET>   create a starter cases.json under .scratch/<TICKET>/
//   qa-evidence setup-jira      store Jira credentials outside the repo
//   qa-evidence run <TICKET>    run Bruno, render evidence, collect into Desktop

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { resolveProject, HOME_DIR, readState } = require('../lib/project');
const { CONFIG_FILE, SECRETS_FILE, jiraConfigured } = require('../lib/config');
const { run } = require('../lib/run');
const casesFrom = require('../lib/cases');
const { browserAvailable } = require('../lib/shot');
const desktop = require('../lib/desktop');
const { collect } = require('../lib/collect');
const excel = require('../lib/excel');
const { attachFiles } = require('../lib/jira');
const { readSecrets } = require('../lib/config');

const USAGE = [
  'qa-evidence - chay test Bruno va sinh bang chung (chi tren may local)',
  '',
  'Cach dung:',
  '  qa-evidence doctor                 kiem tra moi truong',
  '  qa-evidence excel TRUST-123        sinh file Excel test case de review',
  '  qa-evidence run TRUST-123          chay Bruno, chup man hinh, gom bang chung',
  '  qa-evidence jira TRUST-123         day bang chung len Jira',
  '  qa-evidence init TRUST-123         tao file case mau trong .scratch/TRUST-123/',
  '  qa-evidence setup-jira             nhap thong tin Jira (khong luu vao repo)',
  '  qa-evidence collect               gom file local (plans/.scratch) ve repo chinh',
  '  qa-evidence collect --dry-run     xem truoc, khong copy',
  '',
  'Chi can ma ticket, khong can duong dan. Tool tu tim file tai:',
  '  .scratch/TRUST-123/cases.json',
  '',
  'Options cho run:',
  '  --base-url URL    dia chi API local (mac dinh lay tu file case hoac config)',
  '  --token JWT       token dang nhap (hoac dat bien QA_EVIDENCE_TOKEN)',
  '  --attach          day ket qua len Jira sau khi chay',
  '  --no-open         khong tu mo thu muc ket qua bang Finder',
  '  --keep-temp       giu lai collection da sinh de debug',
  '',
  'Vi du:',
  '  cd /duong/dan/den/project-cua-ban',
  '  qa-evidence init TRUST-1166',
  '  qa-evidence run TRUST-1166 --attach',
].join('\n');

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--attach') options.attach = true;
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--write-secrets') options.writeSecrets = true;
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = argv[i + 1];
      i += 1;
    } else positional.push(arg);
  }
  return { options, positional };
}

function cmdDoctor() {
  let project;
  try {
    project = resolveProject(process.cwd());
  } catch (error) {
    console.error('✗ ' + error.message);
    return 1;
  }
  const brunoInstalled = fs.existsSync(
    path.join(__dirname, '..', 'node_modules', '.bin', 'bru'),
  );
  const rows = [
    ['Project', project.name + ' (' + project.root + ')'],
    ['Nhanh / commit', (project.branch || '-') + ' @ ' + (project.commit || '-')],
    ['NestJS', project.isNestJs ? 'co' : 'khong'],
    ['Thu muc docs/bruno', project.hasBrunoDir ? 'co' : 'khong (khong bat buoc)'],
    ['tc-excel cua project', project.hasTcExcel ? 'co' : 'khong'],
    ['Bruno CLI', brunoInstalled ? 'co' : 'THIEU - chay npm install trong repo tool'],
    ['Chromium (playwright)', browserAvailable() ? 'co' : 'THIEU - chay playwright install chromium'],
    ['Thu muc Desktop', desktop.desktopDir()],
    ['Config', fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : 'chua co (chay init)'],
    ['Secrets Jira', jiraConfigured() ? 'da cau hinh' : 'chua cau hinh'],
    ['Lan chay truoc', (readState(project).lastTicket || '-') + ' luc ' + (readState(project).lastRun || '-')],
  ];
  for (const [label, value] of rows) console.log('  ' + label.padEnd(24) + value);
  return 0;
}

function openFolder(dir) {
  // Best-effort: opening Finder is convenience, never a failure.
  try {
    execFileSync('open', [dir], { stdio: 'ignore' });
  } catch {
    /* headless or non-macOS: ignore */
  }
}

const CASES_TEMPLATE = (ticket) => ({
  ticket,
  baseUrl: 'http://localhost:3000',
  cases: [
    {
      id: 'TC01',
      name: 'Xem số dư ví payout của Nguyễn Thị Thu Hà',
      method: 'GET',
      path: '/api/v1/mobile/wallet',
      expect: { status: 200 },
    },
  ],
});

function cmdInitCases(ticket, options) {
  if (!ticket) {
    console.error(
      'Thieu ma ticket.\n\n  qa-evidence init TRUST-1166\n\n' +
        'Lenh nay tao file case mau de ban sua, khong tao project moi.',
    );
    return 2;
  }
  if (!casesFrom.isTicketCode(ticket)) {
    console.error('✗ "' + ticket + '" khong phai ma ticket (can dang TRUST-1166).');
    return 2;
  }

  let project;
  try {
    project = resolveProject(process.cwd());
  } catch (error) {
    console.error('✗ ' + error.message);
    return 2;
  }

  const wanted = casesFrom.normalizeTicket(ticket);
  const existing = casesFrom.findCasesFile(project.root, wanted);
  if (existing.file && !options.force) {
    console.log('• Da co file case: ' + existing.file);
    console.log('  Sua truc tiep file do, hoac them --force de ghi de.');
    return 0;
  }

  const dir = path.join(project.root, '.scratch', wanted);
  const file = path.join(dir, 'cases.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(CASES_TEMPLATE(wanted), null, 2) + '\n');

  console.log('✓ Da tao ' + file);
  console.log('\nSua noi dung case (ten tieng Viet co dau, so tien that), roi chay:');
  console.log('  qa-evidence run ' + wanted);
  return 0;
}

function cmdCollect(options) {
  let result;
  try {
    result = collect(process.cwd(), { dryRun: Boolean(options.dryRun) });
  } catch (error) {
    console.error('✗ ' + error.message);
    return 2;
  }

  if (!result.isWorktree) {
    console.log('• Day la repo chinh (' + result.main + ').');
    console.log('  Khong can gom: file local da nam dung cho.');
    console.log('  Chay lenh nay ben trong worktree truoc khi xoa no.');
    return 0;
  }

  console.log('Worktree : ' + result.source);
  console.log('Repo chinh: ' + result.main);
  console.log(options.dryRun ? '\n(chi xem truoc, khong copy)\n' : '\n');

  if (!result.results.length) {
    console.log('Khong co file local nao de gom (khong co .scratch, docs/plans, docs/testcases).');
    return 0;
  }

  let copiedCount = 0;
  let clashCount = 0;
  for (const item of result.results) {
    const verb = options.dryRun ? 'se gom' : 'da gom';
    console.log(item.area + ':');
    for (const rel of item.copied) {
      console.log('  ' + verb + '  ' + rel);
      copiedCount += 1;
    }
    for (const rel of item.clashes) {
      console.log('  KHAC NOI DUNG (bo qua)  ' + rel);
      clashCount += 1;
    }
  }

  console.log('');
  console.log(
    (options.dryRun ? 'Se copy ' : 'Da copy ') + copiedCount + ' file ve repo chinh.' +
      (clashCount ? ' ' + clashCount + ' file bi bo qua vi da ton tai khac noi dung.' : ''),
  );

  if (clashCount) {
    console.log('\nFile bo qua la file repo chinh dang co ban khac. So sanh roi tu quyet dinh:');
    console.log('  diff <file-trong-worktree> <file-trong-repo-chinh>');
  }

  if (!options.dryRun) {
    console.log('\nXong. Gio co the xoa worktree:');
    console.log('  git worktree remove ' + result.source);
  }
  return 0;
}

function cmdExcel(ticket, options) {
  if (!ticket) {
    console.error('Thieu ma ticket.\n\n  qa-evidence excel TRUST-1166');
    return 2;
  }
  if (!casesFrom.isTicketCode(ticket)) {
    console.error('✗ "' + ticket + '" khong phai ma ticket (can dang TRUST-1166).');
    return 2;
  }

  let project;
  try {
    project = resolveProject(process.cwd());
  } catch (error) {
    console.error('✗ ' + error.message);
    return 2;
  }

  const wanted = casesFrom.normalizeTicket(ticket);

  // First run has no cases file yet: lay down the template so the workbook has
  // something to render, then say plainly that it must be edited and re-run.
  const existing = casesFrom.findCasesFile(project.root, wanted);
  if (existing.ambiguous) {
    // Two rival folders name the same ticket. Seeding would pick one at random
    // and the run would read the other, so stop and let the operator choose.
    console.error('✗ Co nhieu thu muc cung khop ' + wanted + ':');
    for (const file of existing.ambiguous) console.error('    ' + file);
    console.error('  Xoa bot mot thu muc roi chay lai.');
    return 2;
  }

  let seeded = false;
  if (!existing.file) {
    const dir = path.join(project.root, '.scratch', wanted);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(CASES_TEMPLATE(wanted), null, 2) + '\n');
    seeded = true;
  }

  // The workbook tool runs from the main checkout (docs/ is git-ignored, so a
  // worktree has no tool). Point it at this checkout's files explicitly, or it
  // would read the main checkout's .scratch and miss these cases.
  const designFile = options.design || path.join(project.root, '.scratch', wanted, 'cases.json');
  const resultsFile = options.results || path.join(project.root, '.scratch', wanted, 'results.json');

  let result;
  try {
    result = excel.build(project.root, wanted, {
      results: fs.existsSync(resultsFile) ? resultsFile : undefined,
      design: designFile,
      out: options.out,
      // The tool reads the branch of its own cwd (the main checkout), which is
      // not the branch being tested. Name the file after this checkout instead.
      name: options.name || project.branch,
      dryRun: Boolean(options.dryRun),
    });
  } catch (error) {
    console.error('✗ ' + error.message);
    return error.code === 'NO_EXCEL_TOOL' ? 3 : 1;
  }

  if (seeded) {
    console.log('• Chua co file case, da tao mau: .scratch/' + wanted + '/cases.json');
    console.log('  Sua noi dung that trong file do roi chay lai de bang chinh xac.');
    console.log('');
  }

  if (!options.quiet && result.output.trim()) console.log(result.output.trim());
  if (result.file) {
    console.log('');
    console.log('✓ Da sinh: ' + result.file);
    console.log('  Mo kiem tra, sua case neu can, roi chay: qa-evidence run ' + wanted);
  }
  return 0;
}

async function cmdJira(ticket) {
  if (!ticket) {
    console.error('Thieu ma ticket.\n\n  qa-evidence jira TRUST-1166');
    return 2;
  }
  if (!casesFrom.isTicketCode(ticket)) {
    console.error('✗ "' + ticket + '" khong phai ma ticket (can dang TRUST-1166).');
    return 2;
  }

  let project;
  try {
    project = resolveProject(process.cwd());
  } catch (error) {
    console.error('✗ ' + error.message);
    return 2;
  }

  const wanted = casesFrom.normalizeTicket(ticket);
  const dir = desktop.ticketFolder(wanted);
  if (!fs.existsSync(dir)) {
    console.error('✗ Chua co bang chung cho ' + wanted + ': ' + dir);
    console.error('  Chay truoc: qa-evidence run ' + wanted);
    return 2;
  }

  // Attach only work product, never the whole folder: a stray file should not
  // end up on the ticket.
  const names = fs.readdirSync(dir).filter((name) => {
    if (name === '.DS_Store') return false;
    return name.endsWith('.png') || name.endsWith('.md') || name.endsWith('.json') || name.endsWith('.html');
  });
  if (!names.length) {
    console.error('✗ Thu muc ' + dir + ' khong co file de day len.');
    return 2;
  }

  const files = names.map((name) => path.join(dir, name));
  console.log('Dinh day len Jira: ' + wanted);
  for (const file of files) console.log('  ' + path.basename(file));

  let result;
  try {
    result = await attachFiles({ ticket: wanted, files: files, jira: readSecrets() });
  } catch (error) {
    console.error('✗ ' + error.message);
    return 1;
  }

  console.log('');
  console.log('✓ Da day ' + result.uploaded.length + ' file len ' + result.issueKey + '.');
  if (result.skipped.length) {
    console.log('  Bo qua ' + result.skipped.length + ' file khong ton tai.');
  }
  return 0;
}

function cmdSetupJira() {
  const readline = require('node:readline');

  // Prompts must work both for a human typing and for piped answers, so lines
  // are queued instead of relying on readline.question's per-call callback:
  // a piped stdin delivers every line at once and closes immediately.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = [];
  const waiting = [];
  let ended = false;

  rl.on('line', (line) => {
    if (waiting.length) waiting.shift()(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()(null);
  });

  const ask = (question) => {
    process.stdout.write(question);
    if (lines.length) return Promise.resolve(lines.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiting.push(resolve));
  };

  return (async () => {
    console.log('Nhap thong tin Jira. Token duoc luu ngoai repo, quyen 600.\n');
    const rawBaseUrl = await ask('  Dia chi Jira (vd https://congty.atlassian.net): ');
    const rawEmail = await ask('  Email dang nhap: ');
    const rawToken = await ask('  API token: ');
    rl.close();

    if (rawBaseUrl === null || rawEmail === null || rawToken === null) {
      console.error('\n✗ Khong doc duoc day du cau tra loi. Chua luu gi.');
      return 1;
    }

    const baseUrl = rawBaseUrl.trim();
    const email = rawEmail.trim();
    const apiToken = rawToken.trim();

    if (!baseUrl || !email || !apiToken) {
      console.error('\n✗ Thieu thong tin, chua luu gi.');
      return 2;
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      console.error('\n✗ Dia chi Jira phai bat dau bang https://');
      return 2;
    }

    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(
      SECRETS_FILE,
      JSON.stringify({ baseUrl: baseUrl.replace(/\/+$/, ''), email, apiToken }, null, 2) + '\n',
      { mode: 0o600 },
    );
    fs.chmodSync(SECRETS_FILE, 0o600);

    console.log('\n✓ Da luu thong tin Jira (quyen 600, ngoai repo).');
    console.log('  Kiem tra lai: qa-evidence doctor');
    return 0;
  })();
}

async function main(argv) {
  const command = argv[0];
  const { options, positional } = parseArgs(argv.slice(1));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (command === 'doctor') return cmdDoctor();
  if (command === 'setup-jira') return cmdSetupJira();
  if (command === 'excel') return cmdExcel(positional[0], options);
  if (command === 'jira') return cmdJira(positional[0], options);
  if (command === 'init') return cmdInitCases(positional[0], options);
  if (command === 'collect') return cmdCollect(options);

  if (command === 'run') {
    const target = positional[0];
    if (!target) {
      console.error('Thieu ma ticket.\n\n' + USAGE);
      return 2;
    }

    let project;
    try {
      project = resolveProject(process.cwd());
    } catch (error) {
      console.error('✗ ' + error.message);
      return 2;
    }

    // A ticket code alone is enough: the file location is a convention, so
    // nobody has to remember a path.
    let casesFile;
    let ticket;
    if (casesFrom.isTicketCode(target)) {
      ticket = casesFrom.normalizeTicket(target);
      const found = casesFrom.findCasesFile(project.root, ticket);
      if (found.ambiguous) {
        console.error('✗ ' + casesFrom.ambiguousMessage(ticket, found.ambiguous));
        return 2;
      }
      if (!found.file) {
        console.error('✗ ' + casesFrom.notFoundMessage(project.root, ticket, found.searched));
        return 2;
      }
      casesFile = found.file;
      if (!found.exact) console.log('• Dung file: ' + casesFile);
    } else {
      casesFile = path.resolve(target);
      if (!fs.existsSync(casesFile)) {
        console.error('✗ Khong thay file: ' + casesFile);
        return 2;
      }
      ticket = options.ticket;
    }

    let result;
    try {
      result = await run({
        casesFile,
        ticket,
        baseUrl: options.baseUrl,
        token: options.token,
        cwd: project.root,
        attach: Boolean(options.attach),
        keepTemp: Boolean(options.keepTemp),
      });
    } catch (error) {
      console.error('✗ ' + error.message);
      return 1;
    }

    console.log('\n' + result.ticket + ' - ' + result.project.name);
    for (const stage of result.stages) {
      const mark = stage.ok === null ? '•' : stage.ok ? '✓' : '✗';
      console.log('  ' + mark + ' ' + stage.stage.padEnd(12) + stage.detail);
    }
    console.log('\nThu muc bang chung: ' + result.dir);
    for (const r of result.results) {
      console.log('  ' + r.id + '  ' + r.verdict.padEnd(8) + r.name);
    }
    if (result.jira.error) console.log('\nJira: ' + result.jira.error);
    if (result.jira.uploaded) {
      console.log('\nDa day ' + result.jira.uploaded.length + ' file len ' + result.jira.issueKey);
    }
    if (!options.noOpen) openFolder(result.dir);
    return result.counts.Fail || result.counts.Blocked ? 1 : 0;
  }

  console.error('Lenh khong hop le: ' + command + '\n\n' + USAGE);
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('✗ ' + (error && error.message ? error.message : error));
    process.exit(1);
  });
