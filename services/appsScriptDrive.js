const path = require('path');

function hasDriveUploadConfig() {
  return Boolean(process.env.GOOGLE_APPS_SCRIPT_UPLOAD_URL);
}

function safeStoredFilename(originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const base = path.basename(originalName || 'receipt', ext)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'receipt';
  const date = new Date().toISOString().slice(0, 10);
  return `${date}_${Date.now()}_${base}${ext}`;
}

async function uploadReceiptToDrive(file, storedFilename) {
  if (!hasDriveUploadConfig()) {
    return null;
  }

  const payload = {
    filename: storedFilename,
    original_filename: file.originalname,
    mime_type: file.mimetype,
    file_base64: file.buffer.toString('base64')
  };

  const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Google Drive upload returned invalid response: ${text.slice(0, 200)}`);
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Google Drive upload failed with status ${response.status}`);
  }

  return {
    fileId: data.file_id || data.id || null,
    webViewLink: data.web_view_link || data.webViewLink || data.url || null,
    storedFilename
  };
}

module.exports = {
  hasDriveUploadConfig,
  safeStoredFilename,
  uploadReceiptToDrive
};
