'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bru = require('../lib/bru');

test('sinh .bru co du meta, method, url va tests', () => {
  const out = bru.buildBruFile({
    id: 'TC01',
    name: 'Xem so du vi payout',
    path: '/api/v1/mobile/wallet',
    method: 'GET',
    expect: { status: 200, body: { balance: 1500000 } },
  });
  assert.match(out, /^meta \{/m);
  assert.match(out, /name: TC01 Xem so du vi payout/);
  assert.match(out, /url: \{\{baseUrl\}\}\/api\/v1\/mobile\/wallet/);
  assert.match(out, /expect\(res\.getStatus\(\)\)\.to\.equal\(200\)/);
  assert.match(out, /expect\(res\.getBody\(\)\["balance"\]\)\.to\.eql\(1500000\)/);
});

test('body JSON duoc sinh khi case co body', () => {
  const out = bru.buildBruFile({
    id: 'TC02',
    name: 'Tao yeu cau rut tien',
    path: '/withdraw',
    method: 'POST',
    body: { amount: 500000, note: 'Rut tien ve Vietcombank' },
    expect: { status: 201 },
  });
  assert.match(out, /post \{/);
  assert.match(out, /body: json/);
  assert.match(out, /"amount": 500000/);
  assert.match(out, /"note": "Rut tien ve Vietcombank"/);
});

test('request status "pass" van la Fail khi test ben trong fail', () => {
  // Bruno bao status cap request la "pass" du assertion fail - day la cai bay.
  const verdict = bru.requestVerdict({
    status: 'pass',
    testResults: [{ description: 'body.ok', status: 'fail', error: 'expected 1 to equal 2' }],
  });
  assert.equal(verdict.verdict, 'Fail');
  assert.match(verdict.reason, /body\.ok/);
});

test('case khong co ket qua tra ve duoc bao la Blocked, khong phai Pass', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const report = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ev-')), 'results.json');
  // Bruno chi tra ve mot case; case TC02 khong he xuat hien trong report.
  fs.writeFileSync(
    report,
    JSON.stringify([
      {
        iterationIndex: 0,
        results: [
          {
            name: 'TC01 Xem so du',
            status: 'pass',
            response: { status: 200, data: { ok: true } },
            testResults: [{ description: 'HTTP 200', status: 'pass' }],
          },
        ],
      },
    ]),
  );

  const results = bru.normalizeReport({
    reportFile: report,
    cases: [
      { id: 'TC01', name: 'Xem so du' },
      { id: 'TC02', name: 'Case bi bo qua' },
    ],
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].verdict, 'Pass');
  assert.equal(results[1].verdict, 'Blocked');
  assert.equal(results[1].pass, false);
});

test('ticket key duoc doc dung tu chuoi', () => {
  const { issueKeyFromTicket } = require('../lib/jira');
  assert.equal(issueKeyFromTicket('trust-1166'), 'TRUST-1166');
  assert.equal(issueKeyFromTicket('TRUST-1166'), 'TRUST-1166');
  assert.equal(issueKeyFromTicket('xem ticket trust-99 giup'), 'TRUST-99');
  assert.equal(issueKeyFromTicket('khong co ma'), null);
});

test('ten file case duoc slug hoa khong dau', () => {
  const { slug } = require('../lib/desktop');
  assert.equal(slug('TC02 Từ chối số tiền âm'), 'tc02-tu-choi-so-tien-am');
});

test('request co dang nhap dung auth none va gui token qua header', () => {
  const bru = require('../lib/bru.js');
  const body = bru.buildBruFile({ id: 'TC01', name: 'x', method: 'GET', path: '/w' });
  // auth:bearer (ke ca rong) lam Bruno ghi de header bang token rong, nen phai la none.
  assert.match(body, /auth: none/);
  assert.doesNotMatch(body, /auth: bearer/);
  assert.match(body, /authorization: Bearer \{\{bearerToken\}\}/);
});

test('request cong khai khong gui header authorization', () => {
  const bru = require('../lib/bru.js');
  const body = bru.buildBruFile({ id: 'TC01', name: 'x', method: 'GET', path: '/p', auth: false });
  assert.doesNotMatch(body, /authorization/);
});

test('token duoc ghi vao environment, khong phai baseUrl', () => {
  const bru = require('../lib/bru.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-bru-'));
  try {
    bru.writeCollection({
      collectionDir: dir,
      cases: [{ id: 'TC01', name: 'x', method: 'GET', path: '/w' }],
      baseUrl: 'http://localhost:3000',
      token: 'JWT-ABC-123',
    });
    const env = fs.readFileSync(path.join(dir, 'environments', 'local.bru'), 'utf8');
    assert.match(env, /baseUrl: http:\/\/localhost:3000/);
    assert.match(env, /bearerToken: JWT-ABC-123/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
