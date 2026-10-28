'use strict';

// Evidence rendering.
//
// The report is a self-contained HTML document (no network, no CDN) that can be
// opened by a human and rendered to PNG by Playwright. One document per run,
// plus one per failing case so a ticket attachment tells the story by itself.

const fs = require('node:fs');
const path = require('node:path');

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const VERDICT_CLASS = { Pass: 'pass', Fail: 'fail', Blocked: 'blocked' };

function badge(verdict) {
  return '<span class="badge ' + (VERDICT_CLASS[verdict] || 'blocked') + '">' + esc(verdict) + '</span>';
}

function bodyCell(item) {
  if (item.body === undefined) return '<span class="muted">khong co response</span>';
  const text = typeof item.body === 'string' ? item.body : JSON.stringify(item.body, null, 2);
  const clipped = text.length > 1200 ? text.slice(0, 1200) + '\n... (da rut gon)' : text;
  return '<pre>' + esc(clipped) + '</pre>';
}

function caseRow(item) {
  return [
    '<tr>',
    '<td class="mono">' + esc(item.id) + '</td>',
    '<td>' + esc(item.name) + '</td>',
    '<td class="mono">' + esc(item.method || '') + ' ' + esc(item.endpoint || '') + '</td>',
    '<td class="mono">' + esc(item.httpStatus === undefined ? '-' : item.httpStatus) + '</td>',
    '<td>' + badge(item.verdict) + '</td>',
    '<td class="note">' + esc(item.note) + '</td>',
    '</tr>',
  ].join('');
}

function summaryOf(results) {
  const counts = { Pass: 0, Fail: 0, Blocked: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return counts;
}

function documentShell({ title, subtitle, meta, content }) {
  return [
    '<!doctype html>',
    '<html lang="vi"><head><meta charset="utf-8">',
    '<title>' + esc(title) + '</title>',
    '<style>',
    ':root { --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --pass:#047857; --fail:#b91c1c; --blocked:#b45309; }',
    'body { margin:0; padding:32px 40px 56px; font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; color:var(--ink); background:#fff; }',
    'h1 { font-size:22px; margin:0 0 4px; }',
    'h2 { font-size:15px; margin:28px 0 10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }',
    '.sub { color:var(--muted); margin:0 0 20px; }',
    '.meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px 24px; padding:14px 16px; border:1px solid var(--line); border-radius:10px; background:#fafafa; }',
    '.meta div span { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }',
    '.meta div b { font-weight:600; }',
    'table { width:100%; border-collapse:collapse; margin-top:6px; }',
    'th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border-bottom:2px solid var(--line); padding:8px 10px; }',
    'td { border-bottom:1px solid var(--line); padding:10px; vertical-align:top; }',
    '.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }',
    '.muted { color:var(--muted); }',
    '.note { color:var(--muted); font-size:12px; max-width:340px; }',
    '.badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.03em; }',
    '.badge.pass { color:#fff; background:var(--pass); }',
    '.badge.fail { color:#fff; background:var(--fail); }',
    '.badge.blocked { color:#fff; background:var(--blocked); }',
    'pre { margin:0; padding:10px 12px; background:#f6f7f9; border:1px solid var(--line); border-radius:8px; font-size:12px; white-space:pre-wrap; word-break:break-word; }',
    '.stats { display:flex; gap:12px; margin:18px 0 4px; }',
    '.stat { flex:1; border:1px solid var(--line); border-radius:10px; padding:12px 14px; }',
    '.stat b { display:block; font-size:24px; line-height:1.1; }',
    '.stat.pass b { color:var(--pass); } .stat.fail b { color:var(--fail); } .stat.blocked b { color:var(--blocked); }',
    '.foot { margin-top:28px; font-size:11px; color:var(--muted); }',
    '</style></head><body>',
    '<h1>' + esc(title) + '</h1>',
    '<p class="sub">' + esc(subtitle) + '</p>',
    '<div class="meta">' + meta.map((m) => '<div><span>' + esc(m.label) + '</span><b>' + esc(m.value) + '</b></div>').join('') + '</div>',
    content,
    '<p class="foot">Sinh boi qa-evidence &middot; du lieu test la du lieu gia lap co hinh dang du lieu that.</p>',
    '</body></html>',
  ].join('\n');
}

function renderRunReport({ ticket, project, results, ranAt, baseUrl }) {
  const counts = summaryOf(results);
  const meta = [
    { label: 'Ticket', value: ticket },
    { label: 'Project', value: project.name },
    { label: 'Branch', value: project.branch || '-' },
    { label: 'Commit', value: project.commit || '-' },
    { label: 'Moi truong', value: baseUrl },
    { label: 'Thoi diem chay', value: ranAt },
  ];
  const stats =
    '<div class="stats">' +
    ['Pass', 'Fail', 'Blocked']
      .map(
        (k) =>
          '<div class="stat ' + VERDICT_CLASS[k] + '"><span class="muted">' + k +
          '</span><b>' + (counts[k] || 0) + '</b></div>',
      )
      .join('') +
    '</div>';

  const table =
    '<h2>Chi tiet tung case</h2><table><thead><tr>' +
    '<th>Ma</th><th>Ten case</th><th>Request</th><th>HTTP</th><th>Ket qua</th><th>Ghi chu</th>' +
    '</tr></thead><tbody>' +
    results.map(caseRow).join('') +
    '</tbody></table>';

  return documentShell({
    title: ticket + ' - Bang chung kiem thu API',
    subtitle: 'Ket qua chay tu dong bang Bruno tren moi truong local.',
    meta,
    content: stats + table,
  });
}

function renderFailureReport({ ticket, project, item, ranAt }) {
  const meta = [
    { label: 'Ticket', value: ticket },
    { label: 'Case', value: item.id + ' ' + item.name },
    { label: 'Request', value: (item.method || '') + ' ' + (item.endpoint || '') },
    { label: 'HTTP', value: item.httpStatus === undefined ? '-' : item.httpStatus },
    { label: 'Ket qua', value: item.verdict },
    { label: 'Thoi diem chay', value: ranAt },
  ];
  const content =
    '<h2>Ghi chu</h2><pre>' + esc(item.note) + '</pre>' +
    '<h2>Response nhan duoc</h2>' + bodyCell(item) +
    '<h2>Du lieu dau vao</h2><pre>' + esc(JSON.stringify(item.input || {}, null, 2)) + '</pre>';
  return documentShell({
    title: ticket + ' - Case that bai ' + item.id,
    subtitle: item.name,
    meta,
    content,
  });
}

function writeFile(file, html) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return file;
}

module.exports = { renderRunReport, renderFailureReport, writeFile, summaryOf };
