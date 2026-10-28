'use strict';

// Test-data guard.
//
// The rule is: a test case carries data that looks like the real thing -- real
// Vietnamese names, real-looking amounts, real branch names -- and never
// placeholder text. Vague "test123"/"abc"/"Nguyen Van A" data hides the very
// bugs evidence is meant to catch, so this check fails the run early.

const fs = require('node:fs');

const BANNED = [
  'Nguyen Van A',
  'Nguyễn Văn A',
  'Nguyen Van B',
  'Nguyễn Văn B',
  'John Doe',
  'Jane Doe',
  'test user',
  'testuser',
  'test_user',
  'test@example.com',
  'foo bar',
  'lorem ipsum',
];

const BANNED_PATTERN = /^(test|abc|demo|sample|example|x{3,}|123+)+\d*$/i;

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function violations(casesFile) {
  const data = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const cases = Array.isArray(data) ? data : data.cases || [];
  const problems = [];

  for (const testCase of cases) {
    const id = testCase.id || '(khong ma)';
    const name = String(testCase.name || '');
    if (!name.trim()) problems.push(id + ': thieu ten case');
    if (BANNED_PATTERN.test(name.trim())) {
      problems.push(id + ': ten case la placeholder ("' + name + '"), doi thanh tinh huong that');
    }

    for (const text of collectStrings({ name, body: testCase.body, expect: testCase.expect })) {
      const hit = BANNED.find((b) => text.toLowerCase().includes(b.toLowerCase()));
      if (hit) problems.push(id + ': du lieu chua placeholder "' + hit + '"');
    }

    for (const text of collectStrings({ body: testCase.body })) {
      if (BANNED_PATTERN.test(text.trim())) {
        problems.push(id + ': gia tri "' + text + '" trong body la placeholder');
      }
    }
  }
  return problems;
}

module.exports = { violations, BANNED, BANNED_PATTERN };
