const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { uploadReceiptToDrive, safeStoredFilename, hasDriveUploadConfig } = require('../services/appsScriptDrive');
const { extractReceiptWithGemini, hasGeminiConfig } = require('../services/geminiReceipt');
const { cleanText, cleanNumber, cleanInt, isIsoDate } = require('./helpers');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

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

function simpleItems(aiData) {
  return Array.isArray(aiData.items) ? aiData.items.slice(0, 250) : [];
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

module.exports = ({ requireUploader }) => {
  const router = express.Router();

  router.post('/', requireUploader, upload.single('receipt_file'), async (req, res) => {
    const client = await pool.connect();
    try {
      if (!req.file && !req.session.isAdmin) return res.status(400).json({ error: 'A receipt image or PDF is required' });

      const file = req.file || null;
      const drive = file && hasDriveUploadConfig() ? await uploadReceiptToDrive(file, safeStoredFilename(file.originalname)) : null;
      const categories = file && hasGeminiConfig() ? await loadCategories(client) : [];
      const ai = file && hasGeminiConfig() ? await extractReceiptWithGemini(file, categories) : null;
      const aiData = ai?.data || {};
      const categoryId = cleanInt(req.body.category_id) || cleanInt(aiData.category_id) || await findCategoryId(client, aiData.category);
      const row = {
        receipt_number: firstText(req.body.receipt_number, aiData.receipt_number),
        receipt_date: firstText(req.body.receipt_date, aiData.receipt_date),
        worker_id: cleanInt(req.body.worker_id),
        store: firstText(req.body.store, aiData.store),
        project_id: cleanInt(req.body.project_id),
        category_id: categoryId,
        subtotal: firstNumber(req.body.subtotal, aiData.subtotal),
        tax: firstNumber(req.body.tax, aiData.tax),
        total: firstNumber(req.body.total, aiData.total),
        payment_method: cleanPaymentMethod(aiData.payment_method),
        note: firstText(req.body.note, aiData.note),
        ai_confidence: firstNumber(aiData.confidence)
      };
      if (!isIsoDate(row.receipt_date)) return res.status(400).json({ error: 'Receipt date must use YYYY-MM-DD format' });

      await client.query('BEGIN');
      const snap = await snapshot(client, row.worker_id, row.project_id, row.category_id);
      const missingInfo = !row.receipt_date || !row.store || !row.worker_id || !row.category_id || row.total === null || (snap.project_required === 'Yes' && !row.project_id);

      let uploadId = null;
      if (file) {
        const u = await client.query(`
          INSERT INTO receipt_uploads (worker_id, project_id, original_filename, stored_filename, mime_type, file_size, original_file_size, compressed_file_size, google_drive_file_id, google_drive_web_view_link, ai_provider, ai_model, ai_status, ai_confidence, ai_raw_json, processed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING id
        `, [row.worker_id, row.project_id, file.originalname, drive?.storedFilename || file.originalname, file.mimetype, file.size, file.size, file.size, drive?.fileId || null, drive?.webViewLink || null, ai?.provider || null, ai?.model || null, ai ? 'processed' : 'uploaded', row.ai_confidence, ai?.raw || null]);
        uploadId = u.rows[0].id;
      }

      const receiptResult = await client.query(`
        INSERT INTO receipts (receipt_number, receipt_date, worker_id, worker_name, store, project_id, project_name, category_id, category_name, category_group, category_type, accounting_type, account_id, account_code, account_name, subtotal, tax, total, payment_method, follow_up, note, source_file_name, source_mime_type, ai_confidence, ai_provider, ai_model, ai_raw_json, google_drive_file_id, google_drive_web_view_link, upload_id, missing_info)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULL,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING *
      `, [row.receipt_number, row.receipt_date || null, row.worker_id, snap.worker_name, row.store, row.project_id, snap.project_name, row.category_id, snap.category_name, snap.category_group, snap.category_type, snap.accounting_type, snap.account_id, snap.account_code, snap.account_name, row.subtotal, row.tax, row.total, row.payment_method, row.note, file?.originalname || null, file?.mimetype || null, row.ai_confidence, ai?.provider || null, ai?.model || null, ai?.raw || null, drive?.fileId || null, drive?.webViewLink || null, uploadId, missingInfo]);
      const receipt = receiptResult.rows[0];
      if (uploadId) await client.query('UPDATE receipt_uploads SET receipt_id = $1 WHERE id = $2', [receipt.id, uploadId]);

      for (const item of simpleItems(aiData)) {
        await client.query(`
          INSERT INTO receipt_items (receipt_id, upload_id, receipt_number, receipt_date, store, worker_id, worker_name, product_name, product_code, quantity, unit_price, item_total, project_id, project_name, category_id, category_name, category_group, category_type, accounting_type, account_id, account_code, account_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        `, [receipt.id, uploadId, receipt.receipt_number, receipt.receipt_date, receipt.store, receipt.worker_id, receipt.worker_name, cleanText(item.product_name), cleanText(item.product_code), cleanNumber(item.quantity), cleanNumber(item.unit_price), cleanNumber(item.item_total), receipt.project_id, receipt.project_name, receipt.category_id, receipt.category_name, receipt.category_group, receipt.category_type, receipt.accounting_type, receipt.account_id, receipt.account_code, receipt.account_name]);
      }

      await client.query('COMMIT');
      return res.status(201).json({ ok: true, receipt, ai_status: missingInfo || Number(row.ai_confidence || 0) < 80 ? 'needs_review' : 'processed', ai_confidence: row.ai_confidence, google_drive_link: drive?.webViewLink || null });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to process receipt' });
    } finally {
      client.release();
    }
  });

  router.get('/:id/file', async (req, res, next) => {
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
