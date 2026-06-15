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
  sendCsv,
  requireGroupBy,
  safeFilename
};
