async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const msg = data && data.error ? data.error : 'Request failed';
    throw new Error(msg);
  }
  return data;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function optionHtml(rows, valueKey, labelKey, selectedValue = '') {
  return rows.map(row => `<option value="${row[valueKey]}" ${String(row[valueKey]) === String(selectedValue) ? 'selected' : ''}>${escapeHtml(row[labelKey] || '')}</option>`).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formParams(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (value !== '') params.append(key, value);
  }
  return params;
}

async function ensureAdmin() {
  const me = await api('/api/me');
  if (!me.isAdmin) window.location.href = '/login.html';
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}
