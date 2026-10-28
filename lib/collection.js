'use strict';

/**
 * Convert a Bruno GUI collection bundle (one JSON file holding every folder,
 * request and environment) into the `.bru` directory tree that `bru run` reads.
 *
 * The GUI's "export collection" JSON and the CLI disagree on shape: the bundle
 * nests requests under `items[].items[]` with bodies in `request.body.{mode,json}`,
 * while `jsonToBruV2` expects a flat `{meta, http, headers, body, tests}` object
 * per request. `openCollectionToBruno` from @usebruno/converters returns empty
 * folders for this bundle, so the mapping is done here.
 */

const fs = require('node:fs');
const path = require('node:path');

const { jsonToBruV2, envJsonToBruV2 } = require('@usebruno/lang');

const BODY_MODES = ['json', 'text', 'xml', 'html', 'sparql', 'formUrlEncoded', 'multipartForm', 'graphql'];

function slugify(text) {
  return (
    String(text)
      .replace(/[đĐ]/g, (ch) => (ch === 'đ' ? 'd' : 'D'))
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'item'
  );
}

/** Params the GUI keeps in `request.params` become a `.bru` `params:` block. */
function paramsBlock(request) {
  const list = (request.params || []).filter((p) => p && p.enabled !== false && p.name);
  if (!list.length) return null;
  const rows = list.map((p) => '  ' + p.name + ': ' + (p.value === undefined ? '' : p.value));
  return 'params:query {\n' + rows.join('\n') + '\n}\n';
}

function authMode(request) {
  const mode = request.auth && request.auth.mode;
  return mode && mode !== 'inherit' ? mode : 'inherit';
}

function bodyOf(request) {
  const body = request.body || {};
  const mode = body.mode || 'none';
  if (mode === 'none' || !BODY_MODES.includes(mode)) return null;
  const content = body[mode];
  if (content === undefined || content === null || content === '') return null;
  return { mode, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) };
}

function requestToItem(node) {
  const request = node.request || {};
  const body = bodyOf(request);
  const item = {
    meta: { name: node.name || 'Untitled', type: 'http', seq: String(node.seq || 1) },
    http: {
      method: String(request.method || 'GET').toLowerCase(),
      url: request.url || '',
      body: body ? body.mode : 'none',
      auth: authMode(request),
    },
    headers: (request.headers || [])
      .filter((h) => h && h.name)
      .map((h) => ({ name: h.name, value: h.value === undefined ? '' : String(h.value), enabled: h.enabled !== false })),
  };
  if (body) item.body = { [body.mode]: body.content };
  if (request.tests) item.tests = request.tests;
  const script = request.script || {};
  if (script.req || script.res) {
    item.script = Object.assign({}, script.req ? { req: script.req } : {}, script.res ? { res: script.res } : {});
  }
  return item;
}

/**
 * Variables a request reads from the environment ({{name}} anywhere in it).
 *
 * A request with "auth: inherit" reads nothing in its own definition but still
 * needs the token the collection root injects, so the root bearer token counts as
 * used here; otherwise a filtered run would drop the sign-in that produces it.
 */
function varsUsedBy(node) {
  const request = node.request || {};
  const text = [
    request.url || '',
    JSON.stringify(request.body || {}),
    JSON.stringify(request.headers || []),
    JSON.stringify(request.params || {}),
  ].join(' ');
  const used = new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  if (authMode(request) === 'inherit') used.add('accessToken');
  return used;
}

function writeRequest(dir, node) {
  let bru = jsonToBruV2(requestToItem(node));
  // jsonToBruV2 has no notion of GUI query params, so append them by hand.
  const extra = paramsBlock(node.request || {});
  if (extra) bru += '\n' + extra;
  const file = path.join(dir, slugify(node.name) + '.bru');
  fs.writeFileSync(file, bru);
  return file;
}

function writeFolder(dir, node) {
  const folderDir = path.join(dir, slugify(node.name));
  fs.mkdirSync(folderDir, { recursive: true });
  fs.writeFileSync(path.join(folderDir, 'folder.bru'), 'meta {\n  name: ' + (node.name || 'Untitled') + '\n}\n');
  for (const child of node.items || []) {
    if (child.type === 'folder') writeFolder(folderDir, child);
    else if (child.type === 'http-request') writeRequest(folderDir, child);
  }
  return folderDir;
}

function collectionRoot(bundle) {
  const auth = (bundle.root && bundle.root.request && bundle.root.request.auth) || null;
  const lines = ['meta {', '  name: ' + (bundle.name || 'Collection'), '}', ''];
  if (auth && auth.mode && auth.mode !== 'none') {
    lines.push('auth {', '  mode: ' + auth.mode, '}', '');
    const detail = auth[auth.mode];
    if (auth.mode === 'bearer' && detail && detail.token) {
      lines.push('auth:bearer {', '  token: ' + detail.token, '}', '');
    }
  }
  return lines.join('\n');
}

function writeEnvironments(dir, environments) {
  const envDir = path.join(dir, 'environments');
  fs.mkdirSync(envDir, { recursive: true });
  for (const env of environments || []) {
    const vars = (env.variables || [])
      .filter((v) => v && v.name)
      .map((v) => ({
        name: v.name,
        value: v.value === undefined ? '' : String(v.value),
        enabled: v.enabled !== false,
        secret: !!v.secret,
      }));
    fs.writeFileSync(path.join(envDir, slugify(env.name) + '.bru'), envJsonToBruV2({ variables: vars }));
  }
}

/**
 * @param {object} bundle parsed GUI collection bundle
 * @param {string} outDir directory to write the `.bru` tree into
 * @returns {{dir: string, requests: number, environments: string[]}}
 */
function writeCollectionTree(bundle, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // bru run treats a directory as a collection root only when bruno.json is there.
  fs.writeFileSync(
    path.join(outDir, 'bruno.json'),
    JSON.stringify({ version: '1', name: bundle.name || 'Collection', type: 'collection', ignore: ['node_modules', '.git'] }, null, 2),
  );
  fs.writeFileSync(path.join(outDir, 'collection.bru'), collectionRoot(bundle));
  for (const node of bundle.items || []) {
    if (node.type === 'folder') writeFolder(outDir, node);
    else if (node.type === 'http-request') writeRequest(outDir, node);
  }
  // Count what actually landed on disk so a mapping failure cannot pass silently.
  const countBru = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => {
      // environments/ holds variable files, not requests, so it must not be walked.
      if (e.isDirectory()) return e.name === 'environments' ? n : n + countBru(path.join(d, e.name));
      const isRequest = e.name.endsWith('.bru') && e.name !== 'folder.bru' && e.name !== 'collection.bru';
      return n + (isRequest ? 1 : 0);
    }, 0);
  writeEnvironments(outDir, bundle.environments);
  return {
    dir: outDir,
    requests: countBru(outDir),
    environments: (bundle.environments || []).map((e) => slugify(e.name)),
  };
}

/**
 * Run the converted collection through the official CLI.
 *
 * "bru run" exits non-zero whenever any test fails, so the JSON report — not the
 * exit code — is the source of truth, exactly as for generated collections.
 *
 * @param {{collectionDir: string, environment: string, reportFile: string, vars?: object}} options
 * @returns {{ok: boolean, reportFile: string, stdout: string}}
 */
function runCollectionTree({ collectionDir, environment, reportFile, vars = {}, paths = [] }) {
  const { execFileSync } = require('node:child_process');
  const bruBin = path.join(__dirname, '..', 'node_modules', '.bin', 'bru');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });

  // Paths come from selectRequests: naming them keeps the run to the requests the
  // cases need, which is the difference between a 3-request run and all 44.
  const args = ['run', '--env', environment, '--reporter-json', reportFile];
  if (paths.length) args.push(...paths);
  else args.splice(1, 0, '-r');
  // Overrides keep the committed collection untouched: a real run points the
  // same requests at whatever host and token the caller supplies.
  for (const [name, value] of Object.entries(vars)) {
    if (value !== undefined && value !== null && value !== '') {
      args.push('--env-var', name + '=' + value);
    }
  }

  let stdout = '';
  let ok = true;
  try {
    stdout = execFileSync(bruBin, args, {
      cwd: collectionDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    ok = false;
    stdout = String(error.stdout || '');
    if (!fs.existsSync(reportFile)) {
      throw new Error('Bruno khong tao duoc report: ' + (error.stderr || error.message));
    }
  }
  return { ok, reportFile, stdout };
}

/** Variables a request publishes for the ones after it (bru.setEnvVar). */
function varsSetBy(node) {
  const script = (node.request || {}).script || {};
  const text = String(script.res || '') + String(script.req || '');
  return new Set([...text.matchAll(/setEnvVar\(\s*['"]([\w]+)['"]/g)].map((m) => m[1]));
}

/**
 * Walk the bundle in execution order, keeping the requests whose names were asked
 * for plus every earlier request that publishes a variable they read.
 *
 * Without the producers a filtered run looks broken rather than skipped: "05
 * Update Group" reads {{groupConversationId}}, which only "04 Create Group
 * Conversation" sets, so running 05 alone would 400 for a reason that has nothing
 * to do with the code under test.
 *
 * @param {object} bundle parsed GUI collection bundle
 * @param {string[]} wanted request names, matched case-insensitively
 * @returns {{paths: string[], chain: string[], added: string[]}}
 */
function selectRequests(bundle, wanted) {
  const ordered = [];
  const walk = (node, folders) => {
    for (const item of node.items || []) {
      if (item.type === 'folder') {
        walk(item, folders.concat(slugify(item.name)));
      } else if (item.type === 'http-request') {
        const slug = slugify(item.name);
        ordered.push({
          node: item,
          name: String(item.name || ''),
          folders,
          file: folders.concat(slug).join('/') + '.bru',
          path: folders.concat(slug).join('/'),
        });
      }
    }
  };
  walk(bundle, []);

  const normalize = (text) =>
    String(text)
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => slugify(part))
      .filter(Boolean)
      .join('/');

  // Matching runs in tiers, narrowest first, so "05 Update Group" still finds
  // "05 Update Group Conversation" while an exact name is never overridden by a
  // looser match elsewhere in the collection.
  const tiers = [
    (entry, key) => entry.path === key,
    (entry, key) => slugify(entry.name) === key,
    (entry, key) => slugify(entry.name).startsWith(key),
    (entry, key) => slugify(entry.name).includes(key),
    (entry, key) => key.includes(slugify(entry.name)),
  ];

  const resolve = (requested) => {
    const key = normalize(requested);
    if (!key) return { matches: [] };
    for (const tier of tiers) {
      const matches = ordered.filter((entry) => tier(entry, key));
      if (matches.length) return { matches, key, tier: tiers.indexOf(tier) };
    }
    return { matches: [], key };
  };

  const selected = new Set();
  const chain = [];
  const added = [];
  const unmatched = [];
  const ambiguous = [];

  for (const requested of wanted) {
    const { matches } = resolve(requested);
    if (!matches.length) {
      unmatched.push(String(requested));
      continue;
    }
    if (matches.length > 1) {
      // Two requests can share a name in different folders. Picking one silently
      // would attach the wrong screenshot to the ticket, so ask for the folder.
      ambiguous.push({
        requested: String(requested),
        candidates: matches.map((m) => m.path),
      });
      continue;
    }

    const entry = matches[0];
    if (selected.has(entry.file)) {
      chain.push(entry.name);
      continue;
    }
    selected.add(entry.file);
    chain.push(entry.name);

    // Pull in the nearest producer of each variable this request needs.
    const before = ordered.slice(0, ordered.indexOf(entry));
    for (const variable of varsUsedBy(entry.node)) {
      for (let i = before.length - 1; i >= 0; i -= 1) {
        if (!varsSetBy(before[i].node).has(variable)) continue;
        if (!selected.has(before[i].file)) {
          selected.add(before[i].file);
          added.push(before[i].name);
        }
        break;
      }
    }
  }

  // Keep collection order: the producers must run before their consumers.
  const paths = ordered.filter((entry) => selected.has(entry.file)).map((entry) => entry.file);
  return { paths, chain, added, unmatched, ambiguous };
}

module.exports = { writeCollectionTree, runCollectionTree, selectRequests, slugify };
