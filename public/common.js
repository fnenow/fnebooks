async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = data && data.error ? data.error : 'Request failed';
    throw new Error(message);
  }
  return data;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : value;
}

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function optionHtml(rows, valueKey, labelKey, selectedValue = '') {
  return rows.map(row => `<option value="${escapeHtml(row[valueKey])}" ${String(row[valueKey]) === String(selectedValue) ? 'selected' : ''}>${escapeHtml(row[labelKey] || '')}</option>`).join('');
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
  if (!me.isAdmin) {
    window.location.href = '/login.html';
    throw new Error('Admin login required');
  }
  return me;
}

async function ensureUploader() {
  const me = await api('/api/me');
  if (!me.canUpload) {
    window.location.href = '/upload-login.html';
    throw new Error('Worker upload login required');
  }
  return me;
}

async function logout(destination = '/login.html') {
  await api('/api/logout', { method: 'POST' });
  window.location.href = destination;
}

function showPageMessage(text, type = 'notice') {
  const element = document.getElementById('message');
  if (element) element.innerHTML = `<div class="notice ${type === 'error' ? 'error' : ''}">${escapeHtml(text)}</div>`;
}
