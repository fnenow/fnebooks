const express = require('express');
const { pool } = require('../db');
const { uploadReceiptToDrive, safeStoredFilename, hasDriveUploadConfig } = require('../services/appsScriptDrive');
const { extractReceiptsWithGemini, hasGeminiConfig } = require('../services/geminiReceipt');
const { cleanText, cleanNumber, cleanInt, isIsoDate, safeFilename } = require('./helpers');
const { receiveReceiptFiles } = require('../middleware/receiptUpload');
const { optimizeReceiptFile } = require('../services/receiptFileOptimizer');

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text !== null) return text;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = cleanNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function cleanPaymentMethod(value) {
  const text = cleanText(value);
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  const fourDigits = lower.match(/\b\d{4}\b/);
  if (fourDigits) return fourDigits[0];
  if (lower.includes('cash')) return 'cash';
  if (lower.includes('check')) return 'check';
  return 'unknown';
}

function parseItemsJson(value) {
  if (!value) return null;
  let items;
  try {
    items = JSON.parse(value);
  } catch {
    throw Object.assign(new Error('Receipt items data is not valid JSON'), { statusCode: 400 });
  }
  if (!Array.isArray(items)) {
    throw Object.assign(new Error('Receipt items data must be a list'), { statusCode: 400 });
  }
  if (items.length > 250) {
    throw Object.assign(new Error('A receipt cannot contain more than 250 line items'), { statusCode: 400 });
  }
  return items;
}

function aiItems(aiReceipt) {
  return Array.isArray(aiReceipt.items) ? aiReceipt.items.slice(0, 250) : [];
}

async function loadCategories(client) {
  const result = await client.query(`
    SELECT id, type_name, general_category, detail_category, name, ai_clues
    FROM categories
    WHERE active = TRUE AND transaction_kind = 'expense'
    ORDER BY sort_order, type_name, general_category, detail_category
  `);
  return result.rows;
}

async function findCategoryId(client, value) {
  const text = cleanText(value);
  if (!text) return null;
  const result = await client.query(`
    SELECT id FROM categories
    WHERE active = TRUE AND transaction_kind = 'expense'
      AND (LOWER(detail_category) = LOWER($1) OR LOWER(name) = LOWER($1) OR detail_category ILIKE $2 OR name ILIKE $2)
    ORDER BY sort_order
    LIMIT 1
  `, [text, `%${text}%`]);
  return result.rows[0]?.id || null;
}

async function snapshot(client, workerId, projectId, categoryId) {
  const data = { worker_name: null, project_name: null, category_name: null, category_group: null, category_type: null, accounting_type: null, project_required: null, account_id: null, account_code: null, account_name: null };
  if (workerId) {
    const r = await client.query('SELECT name FROM workers WHERE worker_id = $1 LIMIT 1', [workerId]);
    if (!r.rows.length) throw Object.assign(new Error('Selected worker does not exist'), { statusCode: 400 });
    data.worker_name = r.rows[0].name;
  }
  if (projectId) {
    const r = await client.query('SELECT name FROM projects WHERE id = $1 LIMIT 1', [projectId]);
    if (!r.rows.length) throw Object.assign(new Error('Selected project does not exist'), { statusCode: 400 });
    data.project_name = r.rows[0].name;
  }
  if (categoryId) {
    const r = await client.query(`
      SELECT COALESCE(c.detail_category, c.name) AS category_name, c.general_category AS category_group,
             c.type_name AS category_type, c.accounting_type, c.project_required,
             a.id AS account_id, a.account_code, a.account_name
      FROM categories c LEFT JOIN chart_accounts a ON a.id = c.account_id
      WHERE c.id = $1 AND c.transaction_kind = 'expense' LIMIT 1
    `, [categoryId]);
    if (!r.rows.length) throw Object.assign(new Error('Selected expense category does not exist'), { statusCode: 400 });
    Object.assign(data, r.rows[0]);
  }
  return data;
}

// Build one receipt's field set from the request body and/or an AI-extracted
// receipt. When applyManual is true (a single receipt entered by hand) the body
// fields win; for batch uploads we trust the AI values but still attribute the
// receipt to the worker/project chosen on the form.
function buildReceiptFields(body, aiReceipt, applyManual) {
  const ai = aiReceipt || {};
  return {
    receipt_number: applyManual ? firstText(body.receipt_number, ai.receipt_number) : cleanText(ai.receipt_number),
    receipt_date: applyManual ? firstText(body.receipt_date, ai.receipt_date) : cleanText(ai.receipt_date),
    worker_id: cleanInt(body.worker_id),
    store: applyManual ? firstText(body.store, ai.store) : cleanText(ai.store),
    project_id: cleanInt(body.project_id),
    subtotal: applyManual ? firstNumber(body.subtotal, ai.subtotal) : cleanNumber(ai.subtotal),
    tax: applyManual ? firstNumber(body.tax, ai.tax) : cleanNumber(ai.tax),
    total: applyManual ? firstNumber(body.total, ai.total) : cleanNumber(ai.total),
    payment_method: applyManual
      ? firstText(body.payment_method, cleanPaymentMethod(ai.payment_method))
      : cleanPaymentMethod(ai.payment_method),
    note: applyManual ? firstText(body.note, ai.note) : cleanText(ai.note),
    ai_confidence: firstNumber(ai.confidence)
  };
}

// Insert one receipt (plus its line items, and the stored file when needed)
// inside an open transaction. Returns a short summary for the response.
async function createReceipt(client, ctx) {
  const { body, ai, aiReceipt, applyManual, followUp, manualItems, file, drive, uploadId, storeFile } = ctx;

  const row = buildReceiptFields(body, aiReceipt, applyManual);
  const categoryId = (applyManual ? cleanInt(body.category_id) : null)
    || cleanInt(aiReceipt?.category_id)
    || await findCategoryId(client, aiReceipt?.category);
  row.category_id = categoryId;

  if (row.receipt_date && !isIsoDate(row.receipt_date)) {
    if (applyManual) throw Object.assign(new Error('Receipt date must use YYYY-MM-DD format'), { statusCode: 400 });
    row.receipt_date = null;
  }

  const snap = await snapshot(client, row.worker_id, row.project_id, row.category_id);
  const missingInfo = !row.receipt_date || !row.store || !row.worker_id || !row.category_id ||
    row.total === null || (snap.project_required === 'Yes' && !row.project_id);

  const receiptResult = await client.query(`
    INSERT INTO receipts (receipt_number, receipt_date, worker_id, worker_name, store, project_id, project_name, category_id, category_name, category_group, category_type, accounting_type, account_id, account_code, account_name, subtotal, tax, total, payment_method, follow_up, note, source_file_name, source_mime_type, ai_confidence, ai_provider, ai_model, ai_raw_json, google_drive_file_id, google_drive_web_view_link, upload_id, missing_info)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) RETURNING *
  `, [
    row.receipt_number, row.receipt_date || null, row.worker_id, snap.worker_name, row.store,
    row.project_id, snap.project_name, row.category_id, snap.category_name, snap.category_group,
    snap.category_type, snap.accounting_type, snap.account_id, snap.account_code, snap.account_name,
    row.subtotal, row.tax, row.total, row.payment_method, followUp || null, row.note,
    file?.originalname || null, file?.mimetype || null, row.ai_confidence,
    ai?.provider || null, ai?.model || null,
    ai ? JSON.stringify(aiReceipt) : null,
    drive?.fileId || null, drive?.webViewLink || null, uploadId, missingInfo
  ]);
  const receipt = receiptResult.rows[0];

  // Store the original file in PostgreSQL once per uploaded file when Google
  // Drive is not configured. Receipts that share a file resolve it by upload_id.
  if (file && !drive && storeFile) {
    await client.query(`
      INSERT INTO receipt_files (receipt_id, filename, mime_type, size_bytes, file_data)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (receipt_id) DO UPDATE SET
        filename = EXCLUDED.filename,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        file_data = EXCLUDED.file_data
    `, [receipt.id, safeFilename(file.originalname), file.mimetype, file.size, file.buffer]);
  }

  const items = (applyManual && manualItems) ? manualItems : aiItems(aiReceipt || {});
  for (const item of items) {
    await client.query(`
      INSERT INTO receipt_items (receipt_id, upload_id, receipt_number, receipt_date, store, worker_id, worker_name, product_name, product_code, quantity, unit_price, item_total, project_id, project_name, category_id, category_name, category_group, category_type, accounting_type, account_id, account_code, account_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    `, [receipt.id, uploadId, receipt.receipt_number, receipt.receipt_date, receipt.store, receipt.worker_id, receipt.worker_name, cleanText(item.product_name), cleanText(item.product_code), cleanNumber(item.quantity), cleanNumber(item.unit_price), cleanNumber(item.item_total), receipt.project_id, receipt.project_name, receipt.category_id, receipt.category_name, receipt.category_group, receipt.category_type, receipt.accounting_type, receipt.account_id, receipt.account_code, receipt.account_name]);
  }

  const needsReview = missingInfo || Number(row.ai_confidence || 0) < 80;
  return {
    receipt,
    id: receipt.id,
    source_file_name: file?.originalname || null,
    ai_status: needsReview ? 'needs_review' : 'processed',
    ai_confidence: row.ai_confidence,
    missing_info: missingInfo,
    google_drive_link: drive?.webViewLink || null
  };
}

module.exports = ({ requireUploader }) => {
  const router = express.Router();

  router.post('/', requireUploader, receiveReceiptFiles, async (req, res) => {
    const client = await pool.connect();
    try {
      const files = req.receiptFiles || [];
      if (!files.length && !req.session.isAdmin) {
        return res.status(400).json({ error: 'A receipt image or PDF is required' });
      }

      const manualItems = parseItemsJson(req.body.items_json);
      const followUp = cleanText(req.body.follow_up);
      if (followUp && !['reimburse', 'collect'].includes(followUp)) {
        return res.status(400).json({ error: 'Follow Up must be reimburse or collect' });
      }

      const useAi = hasGeminiConfig();
      const categories = files.length && useAi ? await loadCategories(client) : [];
      const created = [];

      await client.query('BEGIN');

      if (!files.length) {
        // Admin manual entry without a file: one receipt from the form fields.
        created.push(await createReceipt(client, {
          body: req.body, ai: null, aiReceipt: {}, applyManual: true,
          followUp, manualItems, file: null, drive: null, uploadId: null, storeFile: false
        }));
      } else {
        for (const original of files) {
          const file = await optimizeReceiptFile(original);
          const drive = hasDriveUploadConfig()
            ? await uploadReceiptToDrive(file, safeStoredFilename(file.originalname))
            : null;
          const ai = useAi ? await extractReceiptsWithGemini(file, categories) : null;
          const aiReceipts = ai?.receipts?.length ? ai.receipts : [{}];

          // Only merge the typed form fields when this submission resolves to a
          // single receipt (one file that produced one receipt).
          const applyManual = files.length === 1 && aiReceipts.length === 1;

          const u = await client.query(`
            INSERT INTO receipt_uploads (worker_id, project_id, original_filename, stored_filename, mime_type, file_size, original_file_size, compressed_file_size, compression_quality, image_width, image_height, google_drive_file_id, google_drive_web_view_link, ai_provider, ai_model, ai_status, ai_confidence, ai_raw_json, processed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()) RETURNING id
          `, [cleanInt(req.body.worker_id), cleanInt(req.body.project_id), file.originalname, drive?.storedFilename || file.originalname, file.mimetype, file.size, file.originalSize, file.compressedSize, file.compressionQuality, file.imageWidth, file.imageHeight, drive?.fileId || null, drive?.webViewLink || null, ai?.provider || null, ai?.model || null, ai ? 'processed' : 'uploaded', firstNumber(aiReceipts[0]?.confidence), ai ? JSON.stringify(ai.raw) : null]);
          const uploadId = u.rows[0].id;

          let storeFile = Boolean(file) && !drive; // store DB file once per file
          for (const aiReceipt of aiReceipts) {
            const summary = await createReceipt(client, {
              body: req.body, ai, aiReceipt, applyManual,
              followUp, manualItems: applyManual ? manualItems : null,
              file, drive, uploadId, storeFile
            });
            storeFile = false;
            created.push(summary);
          }
        }
      }

      await client.query('COMMIT');
      const first = created[0] || null;
      return res.status(201).json({
        ok: true,
        count: created.length,
        receipt: first?.receipt || null,
        receipts: created.map(c => c.receipt),
        results: created.map(({ receipt, ...rest }) => rest),
        ai_status: first?.ai_status || null,
        ai_confidence: first?.ai_confidence ?? null,
        google_drive_link: first?.google_drive_link || null
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to process receipt' });
    } finally {
      client.release();
    }
  });

  router.get('/:id/file', requireUploader, async (req, res, next) => {
    try {
      const result = await pool.query('SELECT google_drive_web_view_link FROM receipts WHERE id = $1', [req.params.id]);
      if (result.rows[0]?.google_drive_web_view_link) return res.redirect(result.rows[0].google_drive_web_view_link);
      return next();
    } catch (err) {
      return next(err);
    }
  });

  return router;
};
