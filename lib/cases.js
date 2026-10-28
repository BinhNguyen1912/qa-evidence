'use strict';

// Case discovery: turn a ticket code into a file path.
//
// You type the ticket code, never a path. The search order is fixed and
// predictable, and a miss explains exactly where it looked and what to do.

const fs = require('node:fs');
const path = require('node:path');

const TICKET_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

function isTicketCode(value) {
  return TICKET_PATTERN.test(String(value || '').trim());
}

function normalizeTicket(value) {
  return String(value).trim().toUpperCase();
}

// "TRUST-1166" -> "1166"; folder names like t1072 or trust-741 also match.
function ticketNumber(ticket) {
  const match = /-(\d+)$/.exec(ticket);
  return match ? match[1] : null;
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

function folderMatchesTicket(folderName, ticket) {
  const number = ticketNumber(ticket);
  if (!number) return false;
  // t1072, trust-1072, TRUST-1072-conformance, t-1072 all point at ticket 1072.
  const digits = folderName.match(/\d+/g) || [];
  return digits.includes(number);
}

/**
 * Search order:
 *   1. <project>/.scratch/<TICKET>/cases.json        the documented home
 *   2. <project>/.scratch/<anything>/cases.json      any folder naming the ticket
 *   3. <project>/.qa-evidence/<TICKET>/cases.json    alternative home
 */
function findCasesFile(projectRoot, ticket) {
  const wanted = normalizeTicket(ticket);
  const searched = [];

  const primary = path.join(projectRoot, '.scratch', wanted, 'cases.json');
  searched.push(primary);
  if (fs.existsSync(primary)) return { file: primary, searched, exact: true };

  const scratch = path.join(projectRoot, '.scratch');
  const matches = [];
  for (const folder of listDirs(scratch)) {
    if (!folderMatchesTicket(folder, wanted)) continue;
    const candidate = path.join(scratch, folder, 'cases.json');
    searched.push(candidate);
    if (fs.existsSync(candidate)) matches.push(candidate);
  }
  // Two folders can name the same ticket (t1091, trust-1091-conformance). Picking
  // the alphabetically first one silently would let an edit land in a file the
  // run never reads, so every rival is reported and the run stops.
  if (matches.length === 1) return { file: matches[0], searched, exact: false };
  if (matches.length > 1) return { file: null, searched, exact: false, ambiguous: matches };

  const alt = path.join(projectRoot, '.qa-evidence', wanted, 'cases.json');
  searched.push(alt);
  if (fs.existsSync(alt)) return { file: alt, searched, exact: true };

  return { file: null, searched, exact: false };
}

function ambiguousMessage(ticket, matches) {
  return [
    'Có ' + matches.length + ' thư mục cùng khớp ' + normalizeTicket(ticket) + ':',
    '',
    ...matches.map((file) => '  ' + file),
    '',
    'Tool không tự chọn để tránh chạy nhầm file. Cách xử lý:',
    '',
    '  1. Giữ một thư mục theo tên chuẩn:',
    '       .scratch/' + normalizeTicket(ticket) + '/cases.json',
    '  2. Xoá hoặc đổi tên các thư mục còn lại,',
    '     hoặc gộp nội dung chúng vào thư mục chuẩn.',
  ].join('\n');
}

function notFoundMessage(projectRoot, ticket, searched) {
  const scratch = path.join(projectRoot, '.scratch');
  const nearby = listDirs(scratch);
  const similar = nearby.filter((name) => folderMatchesTicket(name, ticket));
  const target = path.join(scratch, normalizeTicket(ticket), 'cases.json');

  const lines = [
    'Chưa có file case cho ' + normalizeTicket(ticket) + '.',
    '',
    'Tạo file tại đúng chỗ này:',
    '  ' + target,
    '',
  ];

  if (similar.length) {
    lines.push(
      'Thư mục đã có nhưng thiếu cases.json:',
      ...similar.map((name) => '  ' + path.join(scratch, name) + '/'),
      '',
    );
  }

  lines.push(
    'Nội dung tối thiểu:',
    '  {',
    '    "ticket": "' + normalizeTicket(ticket) + '",',
    '    "baseUrl": "http://localhost:3000",',
    '    "cases": [',
    '      {',
    '        "id": "TC01",',
    '        "name": "Tên tình huống bằng tiếng Việt có dấu",',
    '        "method": "GET",',
    '        "path": "/api/v1/mobile/wallet",',
    '        "expect": { "status": 200 }',
    '      }',
    '    ]',
    '  }',
    '',
    'Hoặc để tool tạo file mẫu:  qa-evidence init ' + normalizeTicket(ticket),
    '',
    'Đã tìm ở:',
    ...searched.map((p) => '  ' + p),
  );
  return lines.join('\n');
}

module.exports = {
  isTicketCode,
  normalizeTicket,
  ticketNumber,
  folderMatchesTicket,
  findCasesFile,
  notFoundMessage,
  ambiguousMessage,
};
