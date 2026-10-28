'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { violations } = require('../lib/testdata');

function write(cases) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-td-')), 'cases.json');
  fs.writeFileSync(file, JSON.stringify({ cases }));
  return file;
}

test('du lieu that voi ten nguoi Viet qua chat luong', () => {
  const file = write([
    {
      id: 'TC01',
      name: 'Rut tien ve Ngan hang Vietcombank chi nhanh Quan 1',
      method: 'POST',
      path: '/withdraw',
      body: { amount: 2500000, accountName: 'Nguyễn Thị Thu Hà', bankCode: 'VCB' },
    },
  ]);
  assert.deepEqual(violations(file), []);
});

test('bat placeholder ten nguoi', () => {
  const file = write([
    {
      id: 'TC02',
      name: 'Tao payout',
      method: 'POST',
      path: '/withdraw',
      body: { accountName: 'Nguyen Van A', amount: 100000 },
    },
  ]);
  const problems = violations(file);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Nguyen Van A/);
});

test('bat gia tri placeholder trong body', () => {
  const file = write([
    { id: 'TC03', name: 'Kiem tra so dien thoai', method: 'POST', path: '/otp', body: { phone: 'test123' } },
  ]);
  const problems = violations(file);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /placeholder/);
});

test('bat ten case rong', () => {
  const file = write([{ id: 'TC04', name: '   ', method: 'GET', path: '/ping' }]);
  assert.match(violations(file)[0], /thieu ten case/);
});
