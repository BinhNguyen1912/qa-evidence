'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cases = require('../lib/cases');
const { findCasesFile, isTicketCode, folderMatchesTicket, ticketNumber } = cases;

function projectWith(folders) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cases-'));
  for (const [folder, hasCases] of Object.entries(folders)) {
    const dir = path.join(root, '.scratch', folder);
    fs.mkdirSync(dir, { recursive: true });
    if (hasCases) fs.writeFileSync(path.join(dir, 'cases.json'), '{"cases":[]}');
  }
  return root;
}

test('nhan dien ma ticket', () => {
  assert.equal(isTicketCode('TRUST-1166'), true);
  assert.equal(isTicketCode('trust-99'), true);
  assert.equal(isTicketCode('TRUST'), false);
  assert.equal(isTicketCode('1166'), false);
});

test('tim thay file trong thu muc dung ten ticket', () => {
  const root = projectWith({ 'TRUST-1166': true });
  const found = findCasesFile(root, 'trust-1166');
  assert.ok(found.file.endsWith(path.join('TRUST-1166', 'cases.json')));
  assert.equal(found.exact, true);
});

test('tim thay ca trong thu muc dat ten kieu cu t1072', () => {
  const root = projectWith({ t1072: true, t1091: false });
  const found = findCasesFile(root, 'TRUST-1072');
  assert.ok(found.file.includes('t1072'));
  assert.equal(found.exact, false);
});

test('khop dung so ticket, khong khop lan sang so khac', () => {
  assert.equal(folderMatchesTicket('trust-1072-conformance', 'TRUST-1072'), true);
  assert.equal(folderMatchesTicket('trust-1072-conformance', 'TRUST-107'), false);
  assert.equal(folderMatchesTicket('t70', 'TRUST-705'), false);
});

test('lay dung so tu ma ticket', () => {
  assert.equal(ticketNumber('TRUST-1166'), '1166');
  assert.equal(ticketNumber('tr-7'), '7');
  assert.equal(ticketNumber('TRUST'), null);
});

test('bao ro da tim o dau khi khong thay file', () => {
  const root = projectWith({ 'trust-1166': false });
  const found = findCasesFile(root, 'TRUST-1166');
  assert.equal(found.file, null);
  assert.ok(found.searched.length >= 2);
  assert.ok(found.searched.some((p) => p.includes('TRUST-1166')));
});

test('khong nham thu muc cua ticket khac', () => {
  const root = projectWith({ 'TRUST-1167': true });
  const found = findCasesFile(root, 'TRUST-1166');
  assert.equal(found.file, null);
});

test('hai thu muc cung khop mot ticket thi bao loi, khong tu chon', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cases-'));
  try {
    for (const folder of ['t1091', 'trust-1091-conformance']) {
      fs.mkdirSync(path.join(root, '.scratch', folder), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.scratch', folder, 'cases.json'),
        JSON.stringify({ ticket: 'TRUST-1091', cases: [] }),
      );
    }
    const found = cases.findCasesFile(root, 'TRUST-1091');
    assert.equal(found.file, null, 'khong duoc tu chon mot trong hai');
    assert.equal(found.ambiguous.length, 2);
    assert.match(cases.ambiguousMessage('TRUST-1091', found.ambiguous), /2 thư mục cùng khớp/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ten thu muc chuan duoc uu tien hon ten cu', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cases-'));
  try {
    fs.mkdirSync(path.join(root, '.scratch', 'TRUST-1091'), { recursive: true });
    fs.mkdirSync(path.join(root, '.scratch', 't1091'), { recursive: true });
    fs.writeFileSync(path.join(root, '.scratch', 'TRUST-1091', 'cases.json'), '{}');
    fs.writeFileSync(path.join(root, '.scratch', 't1091', 'cases.json'), '{}');
    const found = cases.findCasesFile(root, 'TRUST-1091');
    assert.match(found.file, /TRUST-1091/);
    assert.equal(found.exact, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
