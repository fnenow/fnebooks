function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) ? n : null;
}

function isTrue(value) {
  return value === true || value === 'true' || value === '1' || value === 1 || value === 'on';
}

function isIsoDate(value) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

// pg returns DATE columns as JS Date objects. Normalize a stored value (Date,
// ISO string, or 'YYYY-MM-DD') back to a 'YYYY-MM-DD' string, or null.
function toIsoDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Prevent spreadsheet formula execution when a CSV is opened.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
  if (!rows.length) return res.send('\uFEFF');

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))
  ].join('\n');
  return res.send(`\uFEFF${csv}`);
}

function requireGroupBy(value, allowed) {
  if (!value) return null;
  if (!allowed[value]) {
    const err = new Error('Invalid group_by');
    err.statusCode = 400;
    throw err;
  }
  return allowed[value];
}

function safeFilename(value) {
  return String(value || 'file')
    .replace(/[\r\n"]/g, '_')
    .replace(/[^a-zA-Z0-9._() -]/g, '_')
    .slice(0, 180);
}

module.exports = {
  cleanText,
  cleanNumber,
  cleanInt,
  isTrue,
  isIsoDate,
  toIsoDate,
  sendCsv,
  requireGroupBy,
  safeFilename
};
