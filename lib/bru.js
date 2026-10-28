'use strict';

// .bru generation and execution.
//
// A ticket's test cases live in one JSON file (cases.json). This module turns
// that file into a real Bruno collection, runs it through the official
// @usebruno/cli, and normalises the report into the shape the Excel exporter
// already understands.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BRU_BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'bru');

// Bruno's .bru syntax is block based; keep the writer boring and explicit.
function dictBlock(tag, entries) {
  const lines = Object.entries(entries)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => '  ' + k + ': ' + v);
  if (!lines.length) return null;
  return tag + ' {\n' + lines.join('\n') + '\n}';
}

function textBlock(tag, body) {
  if (body === undefined || body === null || body === '') return null;
  return tag + ' {\n' + body + '\n}';
}

function jsonPathAccessor(jsonPath) {
  return jsonPath
    .split('.')
    .map((key) => '[' + JSON.stringify(key) + ']')
    .join('');
}

function assertionSnippet(testCase) {
  const checks = [];
  const expected = testCase.expect || {};

  if (expected.status !== undefined) {
    checks.push(
      '  test(' + JSON.stringify('HTTP ' + expected.status) + ', function() {\n' +
        '    expect(res.getStatus()).to.equal(' + expected.status + ');\n' +
        '  });',
    );
  }

  for (const [jsonPath, value] of Object.entries(expected.body || {})) {
    checks.push(
      '  test(' + JSON.stringify('body.' + jsonPath) + ', function() {\n' +
        '    expect(res.getBody()' + jsonPathAccessor(jsonPath) + ')' +
        '.to.eql(' + JSON.stringify(value) + ');\n' +
        '  });',
    );
  }

  for (const [jsonPath, value] of Object.entries(expected.notBody || {})) {
    checks.push(
      '  test(' + JSON.stringify('body.' + jsonPath + ' khac') + ', function() {\n' +
        '    expect(res.getBody()' + jsonPathAccessor(jsonPath) + ')' +
        '.to.not.eql(' + JSON.stringify(value) + ');\n' +
        '  });',
    );
  }

  if (!checks.length) return null;
  return 'tests {\n' + checks.join('\n\n') + '\n}';
}

function buildBruFile(testCase) {
  const method = String(testCase.method || 'GET').toLowerCase();
  const blocks = [
    textBlock(
      'meta',
      [
        '  name: ' + (testCase.id + ' ' + (testCase.name || '')).trim(),
        '  type: http',
        '  seq: ' + (testCase.seq || 1),
      ].join('\n'),
    ),
    textBlock(
      method,
      [
        '  url: {{baseUrl}}' + testCase.path,
        '  body: ' + (testCase.body ? 'json' : 'none'),
        // Always "none": an empty auth:bearer block makes Bruno override the
        // authorization header with an empty token. The header carries the JWT.
        '  auth: none',
      ].join('\n'),
    ),
    dictBlock('headers', {
      'content-type': testCase.body ? 'application/json' : undefined,
      // Bruno substitutes {{bearerToken}} from the environment file. The
      // auth:bearer block was tried first and proved unreliable: the literal
      // placeholder reached the server.
      ...(testCase.auth === false ? {} : { authorization: 'Bearer {{bearerToken}}' }),
      ...(testCase.headers || {}),
    }),
    testCase.body ? textBlock('body:json', JSON.stringify(testCase.body, null, 2)) : null,
    method === 'get' && testCase.query ? dictBlock('params:query', testCase.query) : null,
    assertionSnippet(testCase),
  ].filter(Boolean);

  return blocks.join('\n\n') + '\n';
}

function writeCollection({ collectionDir, cases, baseUrl, token, environment = 'local' }) {
  fs.mkdirSync(path.join(collectionDir, 'environments'), { recursive: true });
  fs.writeFileSync(
    path.join(collectionDir, 'bruno.json'),
    JSON.stringify(
      {
        version: '1',
        name: path.basename(collectionDir),
        type: 'collection',
        ignore: ['node_modules'],
      },
      null,
      2,
    ) + '\n',
  );
  // The token is written into the temp environment file, never into the project.
  // secretVars keeps it out of the results report.
  const vars = ['  baseUrl: ' + baseUrl];
  if (token) vars.push('  bearerToken: ' + token);
  fs.writeFileSync(
    path.join(collectionDir, 'environments', environment + '.bru'),
    'vars {\n' + vars.join('\n') + '\n}\n',
  );

  for (const [index, testCase] of cases.entries()) {
    const seq = index + 1;
    const file = path.join(
      collectionDir,
      String(seq).padStart(2, '0') + '-' + testCase.id + '.bru',
    );
    fs.writeFileSync(file, buildBruFile({ ...testCase, seq }));
  }
  return collectionDir;
}

// Run the collection. Bruno exits non-zero when a test fails, so the report
// file -- not the exit code -- is the source of truth.
function runCollection({ collectionDir, environment = 'local', reportFile }) {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  let ok = true;
  try {
    execFileSync(BRU_BIN, ['run', '.', '--env', environment, '--reporter-json', reportFile], {
      cwd: collectionDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    ok = false;
    if (!fs.existsSync(reportFile)) {
      throw new Error('Bruno khong tao duoc report: ' + (error.stderr || error.message));
    }
  }
  return { ok, reportFile };
}

// Bruno marks a request "pass" even when a test inside it failed.
// Turn one failed assertion into a sentence that names the observed value
// first, so the reader cannot take the expectation for the outcome.
function describeFailure(assertion, result) {
  const description = String(assertion.description || '').trim();
  const error = String(assertion.error || '').trim();
  const actual = result.response && result.response.status;
  const wantsStatus = /^HTTP\s+(\d+)$/i.exec(description);

  if (wantsStatus) {
    return 'Nhận được HTTP ' + actual + ', cần HTTP ' + wantsStatus[1];
  }
  if (/expected/i.test(error)) {
    return description + ': ' + error.replace(/\s+/g, ' ');
  }
  return (description ? description + ': ' : '') + error;
}

function requestVerdict(result) {
  const tests = [...(result.testResults || []), ...(result.assertionResults || [])];
  const failed = tests.filter((t) => t.status === 'fail');
  if (failed.length) {
    // Bruno words a failure as "<description>: <chai error>". The description
    // is the expectation ("HTTP 200"), so pasting it verbatim next to the real
    // status reads backwards ("HTTP 500: expected 200 to equal 500" looks like
    // 500 was wanted). State actual vs expected instead.
    return {
      verdict: 'Fail',
      reason: failed.map((t) => describeFailure(t, result)).join('; '),
    };
  }
  if (result.skipped) return { verdict: 'Blocked', reason: result.error || 'skipped' };
  if (result.error) return { verdict: 'Fail', reason: String(result.error) };
  if (tests.length) return { verdict: 'Pass', reason: tests.map((t) => t.description).join(', ') };

  const status = result.response && result.response.status;
  if (typeof status === 'number' && status < 400) {
    return { verdict: 'Pass', reason: 'HTTP ' + status };
  }
  return { verdict: 'Fail', reason: 'HTTP ' + status };
}

// Normalise Bruno's report into the contract tc-excel consumes:
// { ranAt, branch, commit, results: [{ id, name, status, body, pass, who, note }] }
function normalizeReport({ reportFile, cases }) {
  const raw = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const iterations = Array.isArray(raw) ? raw : [raw];
  const flat = iterations.flatMap((it) => it.results || []);

  const byId = new Map();
  for (const result of flat) {
    const idMatch = /^(TC\d+)/i.exec(String(result.name || ''));
    const id = idMatch ? idMatch[1].toUpperCase() : String(result.name || '');
    const { verdict, reason } = requestVerdict(result);
    const httpStatus =
      result.response && typeof result.response.status === 'number'
        ? result.response.status
        : undefined;
    // Bruno echoes the file name, which we build as "<id> <name>". The id has
    // its own column, so showing it again reads as "TC01 TC01 Health ...".
    const rawName = String(result.name || '').trim();
    const displayName = rawName.replace(/^TC\d+\s+/i, '').trim() || rawName;

    byId.set(id, {
      id,
      name: displayName,
      endpoint: result.request && result.request.url ? result.request.url : '',
      method: result.request && result.request.method ? result.request.method : '',
      httpStatus,
      verdict,
      pass: verdict === 'Pass',
      body: result.response ? result.response.data : undefined,
      who: 'qa-evidence',
      note: reason,
    });
  }

  // A case that never produced a result was not run: report it as Blocked so a
  // missing result can never be mistaken for a pass.
  return cases.map(
    (c) =>
      byId.get(c.id) || {
        id: c.id,
        name: c.name || '',
        verdict: 'Blocked',
        pass: false,
        who: 'qa-evidence',
        note: 'Bruno khong tra ve ket qua cho case nay (collection dung hoac file loi).',
      },
  );
}

/**
 * Normalise a run of the team's own Bruno collection into the tc-excel contract.
 *
 * A collection-backed case names one request in `request` instead of carrying its
 * own path and assertions, so matching is by request name. Every test inside that
 * request counts toward the case: a request whose assertions all passed is a Pass,
 * and any failed assertion is reported with the actual value first, because Bruno's
 * assertion description is the expectation and reads backwards next to a failure.
 *
 * @param {{reportFile: string, cases: Array<object>}} options
 * @returns {Array<object>} one result per declared case, in declaration order
 */
function normalizeCollectionReport({ reportFile, cases }) {
  const raw = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const iterations = Array.isArray(raw) ? raw : [raw];
  const flat = iterations.flatMap((it) => it.results || []);

  // A run can execute the same request more than once (loops, retries); keep the
  // last result per name, which is the one whose assertions reflect the final state.
  const byRequest = new Map();
  for (const result of flat) {
    const key = String(result.name || '').trim().toLowerCase();
    if (key) byRequest.set(key, result);
  }

  const findResult = (testCase) => {
    const wanted = String(testCase.request || '').trim().toLowerCase();
    if (byRequest.has(wanted)) return byRequest.get(wanted);
    // Allow a partial match so "05 Share Post" finds "05 Share Post to Conversations".
    for (const [name, result] of byRequest) {
      if (name.includes(wanted) || wanted.includes(name)) return result;
    }
    return undefined;
  };

  return cases.map((testCase) => {
    const result = findResult(testCase);
    if (!result) {
      return {
        id: testCase.id,
        name: testCase.name || testCase.request || '',
        verdict: 'Blocked',
        pass: false,
        who: 'qa-evidence',
        note: 'Khong tim thay request "' + testCase.request + '" trong collection Bruno.',
      };
    }

    const { verdict, reason } = requestVerdict(result);
    const httpStatus =
      result.response && typeof result.response.status === 'number'
        ? result.response.status
        : undefined;

    return {
      id: testCase.id,
      name: testCase.name || String(result.name || '').replace(/^\d+\s+/, ''),
      endpoint: result.request && result.request.url ? result.request.url : '',
      method: result.request && result.request.method ? result.request.method : '',
      httpStatus,
      verdict,
      pass: verdict === 'Pass',
      body: result.response ? result.response.data : undefined,
      who: 'qa-evidence',
      note: reason,
    };
  });
}

module.exports = {
  writeCollection,
  runCollection,
  normalizeReport,
  normalizeCollectionReport,
  buildBruFile,
  requestVerdict,
};
