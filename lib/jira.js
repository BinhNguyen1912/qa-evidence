'use strict';

// Jira Cloud REST v3: attach evidence files to an issue.
//
// Endpoint: POST /rest/api/3/issue/{issueIdOrKey}/attachments
// Requires the X-Atlassian-Token: no-check header and multipart field "file".
// Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
};

function basicAuth(email, apiToken) {
  return 'Basic ' + Buffer.from(email + ':' + apiToken).toString('base64');
}

function issueKeyFromTicket(ticket) {
  // TRUST-1166 -> TRUST-1166; anything already key-shaped passes through.
  const match = /([A-Z][A-Z0-9]+-\d+)/i.exec(String(ticket || ''));
  return match ? match[1].toUpperCase() : null;
}

async function attachFiles({ ticket, files, jira, fetchImpl = fetch }) {
  const issueKey = issueKeyFromTicket(ticket);
  if (!issueKey) {
    throw new Error('Khong doc duoc ma ticket tu "' + ticket + '" (can dang TRUST-123).');
  }
  if (!jira || !jira.baseUrl || !jira.email || !jira.apiToken) {
    throw new Error(
      'Chua cau hinh Jira. Tao file secrets voi baseUrl/email/apiToken ' +
        '(xem config.example.json de biet ten truong).',
    );
  }

  const existing = files.filter((f) => fs.existsSync(f));
  if (!existing.length) return { issueKey, uploaded: [], skipped: files };

  const form = new FormData();
  for (const file of existing) {
    const buffer = fs.readFileSync(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    form.append('file', new Blob([buffer], { type }), path.basename(file));
  }

  const url = jira.baseUrl.replace(/\/+$/, '') + '/rest/api/3/issue/' + issueKey + '/attachments';
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(jira.email, jira.apiToken),
      'X-Atlassian-Token': 'no-check',
      Accept: 'application/json',
    },
    body: form,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error('Jira tu choi (' + response.status + '): ' + text.slice(0, 400));
  }
  const uploaded = JSON.parse(text).map((a) => ({ id: a.id, filename: a.filename, size: a.size }));
  return { issueKey, uploaded, skipped: files.filter((f) => !fs.existsSync(f)) };
}

module.exports = { attachFiles, issueKeyFromTicket };
