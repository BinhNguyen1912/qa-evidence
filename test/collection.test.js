'use strict';

// The Bruno GUI exports one bundle JSON; bru run needs a .bru directory tree.
// Both directions are checked against the real bundle the repo ships, so a shape
// change in either the GUI export or the converter shows up as a failing test.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeCollectionTree, selectRequests, slugify } = require('../lib/collection');
const { normalizeCollectionReport } = require('../lib/bru');

const BUNDLE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'trustwow-backend',
  'docs',
  'bruno',
  'trustwow-chat-module.json',
);
const hasBundle = fs.existsSync(BUNDLE);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-evidence-collection-'));
}

function readBundle() {
  return JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
}

function countRequests(node) {
  let n = 0;
  for (const item of node.items || []) {
    if (item.type === 'http-request') n += 1;
    n += countRequests(item);
  }
  return n;
}

test('slugify bo dau tieng Viet va ky tu la', () => {
  assert.equal(slugify('01 Sign In and Store Access Token'), '01-sign-in-and-store-access-token');
  assert.equal(slugify('Đăng nhập'), 'dang-nhap');
  assert.equal(slugify('  ???  '), 'item');
});

test('collection bundle thanh cay .bru dung so request', { skip: !hasBundle }, () => {
  const dir = tmpDir();
  const bundle = readBundle();
  const info = writeCollectionTree(bundle, dir);

  // The count must equal what the GUI bundle declares, not what was attempted:
  // a case that silently failed to write would otherwise still "pass".
  assert.equal(info.requests, countRequests(bundle));
  assert.equal(info.requests, 44);

  // bru run only treats a directory as a collection root when bruno.json exists.
  assert.ok(fs.existsSync(path.join(dir, 'bruno.json')));
  assert.ok(fs.existsSync(path.join(dir, 'collection.bru')));
  assert.deepEqual(info.environments, ['local']);
  assert.ok(fs.existsSync(path.join(dir, 'environments', 'local.bru')));
});

test('request giu nguyen method, body, header va query param', { skip: !hasBundle }, () => {
  const dir = tmpDir();
  writeCollectionTree(readBundle(), dir);

  const signIn = fs.readFileSync(path.join(dir, '00-authentication', '01-sign-in-and-store-access-token.bru'), 'utf8');
  assert.match(signIn, /^post \{/m);
  assert.match(signIn, /content-type: application\/json/i);
  assert.match(signIn, /clientId/);

  const list = fs.readFileSync(path.join(dir, '01-conversations', '01-list-conversations.bru'), 'utf8');
  assert.match(list, /^get \{/m);
  assert.match(list, /params:query/);
  // The GUI keeps query params out of the url, so they must survive the mapping.
  assert.match(list, /limit: \{\{pageLimit\}\}/);
});

test('environment giu day du bien cua collection', { skip: !hasBundle }, () => {
  const dir = tmpDir();
  writeCollectionTree(readBundle(), dir);
  const env = fs.readFileSync(path.join(dir, 'environments', 'local.bru'), 'utf8');
  for (const name of ['baseUrl', 'apiVersion', 'identifier']) {
    assert.ok(env.includes(name + ':'), 'thieu bien ' + name);
  }
  // accessToken is declared secret, so the CLI writes it into vars:secret.
  assert.match(env, /vars:secret \[/);
  assert.match(env, /accessToken/);
});

test('case khop request theo ten, sai ten thi Blocked chu khong Pass', () => {
  const dir = tmpDir();
  const reportFile = path.join(dir, 'report.json');
  fs.writeFileSync(
    reportFile,
    JSON.stringify([
      {
        results: [
          {
            name: '01 List Conversations',
            status: 'pass',
            request: { method: 'GET', url: 'http://x/api/v1/mobile/chat/conversations' },
            response: { status: 200, data: {} },
            testResults: [{ description: 'returns a conversation page', status: 'pass' }],
          },
          {
            name: '05 Update Group',
            status: 'fail',
            request: { method: 'PUT', url: 'http://x/api/v1/mobile/chat/conversations/1' },
            response: { status: 403, data: {} },
            testResults: [{ description: 'HTTP 200', status: 'fail', error: 'expected 403 to equal 200' }],
          },
        ],
      },
    ]),
  );

  const results = normalizeCollectionReport({
    reportFile,
    cases: [
      { id: 'TC01', name: 'Danh sach hoi thoai', request: '01 List Conversations' },
      { id: 'TC02', name: 'Cap nhat nhom', request: '05 Update Group' },
      { id: 'TC03', name: 'Case go sai ten', request: 'Khong Co Request Nay' },
    ],
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].verdict, 'Pass');
  assert.equal(results[1].verdict, 'Fail');
  // Bruno words the failure as the expectation, so the note must lead with what
  // was actually received or the reader takes 200 as the outcome.
  assert.match(results[1].note, /Nhận được HTTP 403/);
  assert.equal(results[1].httpStatus, 403);
  assert.equal(results[2].verdict, 'Blocked');
  assert.match(results[2].note, /Khong Co Request Nay/);
});

test('loc request theo ten, keo theo request san xuat bien va dang nhap', { skip: !hasBundle }, () => {
  const bundle = readBundle();

  // "05 Update Group" reads {{groupConversationId}} and inherits the root bearer
  // token, so a run of just that request would 400 in a way that has nothing to do
  // with the endpoint under test. Both producers must come along.
  const picked = selectRequests(bundle, ['05 Update Group']);
  assert.equal(picked.chain.length, 1);
  assert.deepEqual(picked.added, ['04 Create Group Conversation', '01 Sign In and Store Access Token']);
  assert.equal(picked.paths.length, 3);

  // Collection order, so the sign-in runs before the request that needs the token.
  assert.match(picked.paths[0], /01-sign-in-and-store-access-token/);
  assert.match(picked.paths[1], /04-create-group-conversation/);
  assert.match(picked.paths[2], /05-update-group/);

  // A request that needs nothing but the token still gets the sign-in.
  assert.deepEqual(selectRequests(bundle, ['01 List Conversations']).added, ['01 Sign In and Store Access Token']);

  // Sign-in itself depends on nothing, so it must not pull itself in again.
  assert.deepEqual(selectRequests(bundle, ['01 Sign In and Store Access Token']).added, []);

  // An unknown name selects nothing, which run() turns into a clear error rather
  // than an empty run that reads as "all passed".
  const missing = selectRequests(bundle, ['Khong Co Request Nay']);
  assert.equal(missing.paths.length, 0);
  assert.deepEqual(missing.unmatched, ['Khong Co Request Nay']);
});

test('chi duoc dinh kem ten folder khi ten request trung', () => {
  const request = (name) => ({ type: 'http-request', name, request: { method: 'GET', url: '{{baseUrl}}/x', auth: { mode: 'none' } } });
  const bundle = {
    items: [
      { type: 'folder', name: 'A', items: [request('01 List Things')] },
      { type: 'folder', name: 'B', items: [request('01 List Things')] },
    ],
  };

  // Guessing would attach the wrong request's outcome to the ticket line.
  const ambiguous = selectRequests(bundle, ['01 List Things']);
  assert.equal(ambiguous.paths.length, 0);
  assert.deepEqual(ambiguous.ambiguous, [
    { requested: '01 List Things', candidates: ['a/01-list-things', 'b/01-list-things'] },
  ]);

  assert.deepEqual(selectRequests(bundle, ['b/01 List Things']).paths, ['b/01-list-things.bru']);
});

test('khop theo duong dan, slug va ten viet tat', { skip: !hasBundle }, () => {
  const bundle = readBundle();

  // Folder path, so two folders holding the same request name stay distinguishable.
  assert.deepEqual(selectRequests(bundle, ['01 Conversations/05 Update Group']).chain, ['05 Update Group']);
  // Slug form, so a name typed without spaces still resolves.
  assert.deepEqual(selectRequests(bundle, ['05-update-group']).chain, ['05 Update Group']);
  // A prefix resolves, but an exact name must win over a looser match.
  assert.deepEqual(selectRequests(bundle, ['01 List Con']).chain, ['01 List Conversations']);
  assert.deepEqual(selectRequests(bundle, ['01 List Conversations']).chain, ['01 List Conversations']);
});
