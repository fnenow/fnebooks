const express = require('express');
const { pool } = require('../db');
const {
  cleanText,
  cleanNumber,
  cleanInt,
  isIsoDate,
  sendCsv,
  requireGroupBy,
  safeFilename
} = require('./helpers');
const { receiveReceiptFile, optimizeReceiptFile } = require('../middleware/receiptUpload');

const RECEIPT_GROUPS = {
  project: { sql: "COALESCE(project_name, 'Missing Project')" },
  worker: { sql: "COALESCE(worker_name, 'Missing Worker')" },
  category: { sql: "COALESCE(category_group, category_name, 'Missing Category')" },
  detail_category: { sql: "COALESCE(category_name, 'Missing Detail Category')" },
  account: { sql: "COALESCE(account_code || ' - ' || account_name, 'Missing Account')" },
  store: { sql: "COALESCE(store, 'Missing Store')" },
  payment_method: { sql: "COALESCE(payment_method, 'Missing Payment Method')" },
  follow_up: { sql: "COALESCE(follow_up, 'Missing Follow Up')" },
  month: { sql: "COALESCE(TO_CHAR(receipt_date, 'YYYY-MM'), 'Missing Date')" }
};

function buildReceiptWhere(query) {
  const where = ['active = TRUE'];
  const params = [];
  const add = (clause, value) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (query.start_date) add('receipt_date >= ?', query.start_date);
  if (query.end_date) add('receipt_date <= ?', query.end_date);
  if (query.worker_id) add('worker_id = ?', query.worker_id);
  if (query.project_id) add('project_id = ?', query.project_id);
  if (query.category_id) add('category_id = ?', query.category_id);
  if (query.account_id) add('account_id = ?', query.account_id);
  if (query.store) add('store ILIKE ?', `%${query.store}%`);
  if (query.receipt_number) add('receipt_number ILIKE ?', `%${query.receipt_number}%`);
  if (query.payment_method) add('payment_method ILIKE ?', `%${query.payment_method}%`);
  if (query.follow_up) add('follow_up = ?', query.follow_up);
  if (query.corrected === 'yes') where.push('corrected = TRUE');
  if (query.corrected === 'no') where.push('corrected = FALSE');
  if (query.missing_info_only === 'true') where.push('missing_info = TRUE');

  return { where: where.join(' AND '), params };
}

function calculateMissingInfo(data, categoryMeta = {}) {
  const projectRequired = categoryMeta.project_required === 'Yes';
  return !data.receipt_date || !data.store || !data.worker_id || !data.category_id ||
    data.total === null || data.total === undefined ||
    (projectRequired && !data.project_id);
}

async function loadSnapshots(client, workerId, projectId, categoryId) {
  const snapshot = {
    worker_name: null,
    project_name: null,
    category_name: null,
    category_group: null,
    category_type: null,
    accounting_type: null,
    project_required: null,
    account_id: null,
    account_code: null,
    account_name: null
  };

  if (workerId) {
    const result = await client.query('SELECT name FROM workers WHERE worker_id = $1 LIMIT 1', [workerId]);
    if (!result.rows.length) {
      const err = new Error('Selected worker does not exist');
      err.statusCode = 400;
      throw err;
    }
    snapshot.worker_name = result.rows[0].name;
  }

  if (projectId) {
    const result = await client.query('SELECT name FROM projects WHERE id = $1 LIMIT 1', [projectId]);
    if (!result.rows.length) {
      const err = new Error('Selected project does not exist');
      err.statusCode = 400;
      throw err;
    }
    snapshot.project_name = result.rows[0].name;
  }

  if (categoryId) {
    const result = await client.query(`
      SELECT COALESCE(c.detail_category, c.name) AS category_name,
             c.general_category AS category_group,
             c.type_name AS category_type,
             c.accounting_type,
             c.project_required,
             a.id AS account_id,
             a.account_code,
             a.account_name
      FROM categories c
      LEFT JOIN chart_accounts a ON a.id = c.account_id
      WHERE c.id = $1 AND c.transaction_kind = 'expense'
      LIMIT 1
    `, [categoryId]);
    if (!result.rows.length) {
      const err = new Error('Selected expense category does not exist');
      err.statusCode = 400;
      throw err;
    }
    Object.assign(snapshot, result.rows[0]);
  }

  return snapshot;
}

function parseItems(value) {
  if (!value) return [];
  let items;
  try {
    items = JSON.parse(value);
  } catch {
    const err = new Error('Receipt items data is not valid JSON');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(items)) {
    const err = new Error('Receipt items data must be a list');
    err.statusCode = 400;
    throw err;
  }
  if (items.length > 250) {
    const err = new Error('A receipt cannot contain more than 250 line items');
    err.statusCode = 400;
    throw err;
  }
  return items;
}

module.exports = ({ requireAdmin, requireUploader }) => {
  const router = express.Router();

  router.get('/', requireAdmin, async (req, res) => {
    try {
      const group = requireGroupBy(req.query.group_by, RECEIPT_GROUPS);
      const { where, params } = buildReceiptWhere(req.query);

      if (group) {
        const result = await pool.query(`
          SELECT ${group.sql} AS group_value,
                 COUNT(*)::int AS receipt_count,
                 COALESCE(SUM(total), 0)::numeric(12,2) AS total_amount,
                 COALESCE(SUM(tax), 0)::numeric(12,2) AS total_tax
          FROM receipts
          WHERE ${where}
          GROUP BY ${group.sql}
          ORDER BY group_value NULLS LAST
        `, params);
        return res.json({ mode: 'grouped', group_by: req.query.group_by, rows: result.rows });
      }

      const result = await pool.query(`
        SELECT *
        FROM receipts
        WHERE ${where}
        ORDER BY receipt_date DESC NULLS LAST, id DESC
        LIMIT 500
      `, params);
      return res.json({ mode: 'list', rows: result.rows });
    } catch (err) {
      console.error(err);
      return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to load receipts' });
    }
  });

  router.get('/export.csv', requireAdmin, async (req, res) => {
    try {
      const { where, params } = buildReceiptWhere(req.query);
      const result = await pool.query(`SELECT * FROM receipts WHERE ${where} ORDER BY receipt_date, id`, params);
      return sendCsv(res, 'receipts_export.csv', result.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).send('Failed to export receipts');
    }
  });

  router.post('/', requireUploader, receiveReceiptFile, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!req.file && !req.session.isAdmin) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A receipt image or PDF is required' });
      }

      const data = {
        receipt_number: cleanText(req.body.receipt_number),
        receipt_date: cleanText(req.body.receipt_date),
        worker_id: cleanInt(req.body.worker_id),
        store: cleanText(req.body.store),
        project_id: cleanInt(req.body.project_id),
        category_id: cleanInt(req.body.category_id),
        subtotal: cleanNumber(req.body.subtotal),
        tax: cleanNumber(req.body.tax),
        total: cleanNumber(req.body.total),
        note: cleanText(req.body.note),
        ai_confidence: cleanNumber(req.body.ai_confidence),
        payment_method: cleanText(req.body.payment_method)
      };

      if (!isIsoDate(data.receipt_date)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Receipt date must use YYYY-MM-DD format' });
      }
      const items = parseItems(req.body.items_json);
      const snapshot = await loadSnapshots(client, data.worker_id, data.project_id, data.category_id);
      const missingInfo = calculateMissingInfo(data, snapshot);

      const receiptResult = await client.query(`
        INSERT INTO receipts (
          receipt_number, receipt_date, worker_id, worker_name, store,
          project_id, project_name, category_id, category_name,
          category_group, category_type, accounting_type,
          account_id, account_code, account_name,
          subtotal, tax, total, payment_method, follow_up, note,
          source_file_name, source_mime_type, ai_confidence, missing_info
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULL,$20,$21,$22,$23,$24)
        RETURNING *
      `, [
        data.receipt_number, data.receipt_date || null, data.worker_id, snapshot.worker_name, data.store,
        data.project_id, snapshot.project_name, data.category_id, snapshot.category_name,
        snapshot.category_group, snapshot.category_type, snapshot.accounting_type,
        snapshot.account_id, snapshot.account_code, snapshot.account_name,
        data.subtotal, data.tax, data.total, data.payment_method, data.note,
        req.file?.originalname || null, req.file?.mimetype || null, data.ai_confidence, missingInfo
      ]);

      const receipt = receiptResult.rows[0];
      if (req.file) {
        const storedFile = await optimizeReceiptFile(req.file);
        await client.query(`
          INSERT INTO receipt_files (receipt_id, filename, mime_type, size_bytes, file_data)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (receipt_id) DO UPDATE SET
            filename = EXCLUDED.filename,
            mime_type = EXCLUDED.mime_type,
            size_bytes = EXCLUDED.size_bytes,
            file_data = EXCLUDED.file_data
        `, [receipt.id, safeFilename(storedFile.originalname), storedFile.mimetype, storedFile.size, storedFile.buffer]);
      }

      for (const item of items) {
        await client.query(`
          INSERT INTO receipt_items (
            receipt_id, receipt_number, receipt_date, store, worker_id, worker_name,
            product_name, product_code, quantity, unit_price, item_total,
            project_id, project_name, category_id, category_name,
            category_group, category_type, accounting_type,
            account_id, account_code, account_name
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        `, [
          receipt.id, receipt.receipt_number, receipt.receipt_date, receipt.store, receipt.worker_id, receipt.worker_name,
          cleanText(item.product_name), cleanText(item.product_code), cleanNumber(item.quantity), cleanNumber(item.unit_price), cleanNumber(item.item_total),
          receipt.project_id, receipt.project_name, receipt.category_id, receipt.category_name,
          receipt.category_group, receipt.category_type, receipt.accounting_type,
          receipt.account_id, receipt.account_code, receipt.account_name
        ]);
      }

      await client.query('COMMIT');
      return res.status(201).json({ ok: true, receipt });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create receipt' });
    } finally {
      client.release();
    }
  });

  router.get('/:id/file', requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT filename, mime_type, file_data FROM receipt_files WHERE receipt_id = $1',
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).send('File not found');
      const file = result.rows[0];
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename(file.filename || 'receipt')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(file.file_data);
    } catch (err) {
      console.error(err);
      return res.status(500).send('Failed to load file');
    }
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM receipts WHERE id = $1', [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Receipt not found' });
      return res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load receipt' });
    }
  });

  router.patch('/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query('SELECT * FROM receipts WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!currentResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Receipt not found' });
      }

      const current = currentResult.rows[0];
      const next = {
        receipt_number: req.body.receipt_number !== undefined ? cleanText(req.body.receipt_number) : current.receipt_number,
        receipt_date: req.body.receipt_date !== undefined ? cleanText(req.body.receipt_date) : current.receipt_date,
        worker_id: req.body.worker_id !== undefined ? cleanInt(req.body.worker_id) : current.worker_id,
        store: req.body.store !== undefined ? cleanText(req.body.store) : current.store,
        project_id: req.body.project_id !== undefined ? cleanInt(req.body.project_id) : current.project_id,
        category_id: req.body.category_id !== undefined ? cleanInt(req.body.category_id) : current.category_id,
        subtotal: req.body.subtotal !== undefined ? cleanNumber(req.body.subtotal) : current.subtotal,
        tax: req.body.tax !== undefined ? cleanNumber(req.body.tax) : current.tax,
        total: req.body.total !== undefined ? cleanNumber(req.body.total) : current.total,
        follow_up: req.body.follow_up !== undefined ? cleanText(req.body.follow_up) : current.follow_up,
        payment_method: req.body.payment_method !== undefined ? cleanText(req.body.payment_method) : current.payment_method,
        note: req.body.note !== undefined ? cleanText(req.body.note) : current.note,
        correction_note: req.body.correction_note !== undefined ? cleanText(req.body.correction_note) : current.correction_note
      };

      if (!isIsoDate(next.receipt_date)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Receipt date must use YYYY-MM-DD format' });
      }
      if (next.follow_up && !['reimburse', 'collect'].includes(next.follow_up)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Follow Up must be reimburse or collect' });
      }

      const snapshot = await loadSnapshots(client, next.worker_id, next.project_id, next.category_id);
      const missingInfo = calculateMissingInfo(next, snapshot);
      const result = await client.query(`
        UPDATE receipts SET
          receipt_number = $1,
          receipt_date = $2,
          worker_id = $3,
          worker_name = $4,
          store = $5,
          project_id = $6,
          project_name = $7,
          category_id = $8,
          category_name = $9,
          category_group = $10,
          category_type = $11,
          accounting_type = $12,
          account_id = $13,
          account_code = $14,
          account_name = $15,
          subtotal = $16,
          tax = $17,
          total = $18,
          follow_up = $19,
          payment_method = $20,
          note = $21,
          corrected = TRUE,
          correction_note = $22,
          missing_info = $23,
          updated_at = NOW()
        WHERE id = $24
        RETURNING *
      `, [
        next.receipt_number, next.receipt_date || null,
        next.worker_id, snapshot.worker_name, next.store,
        next.project_id, snapshot.project_name,
        next.category_id, snapshot.category_name, snapshot.category_group,
        snapshot.category_type, snapshot.accounting_type,
        snapshot.account_id, snapshot.account_code, snapshot.account_name,
        next.subtotal, next.tax, next.total, next.follow_up, next.payment_method, next.note,
        next.correction_note, missingInfo, req.params.id
      ]);

      const receipt = result.rows[0];
      await client.query(`
        UPDATE receipt_items SET
          receipt_number = $1,
          receipt_date = $2,
          store = $3,
          worker_id = $4,
          worker_name = $5,
          project_id = $6,
          project_name = $7,
          category_id = $8,
          category_name = $9,
          category_group = $10,
          category_type = $11,
          accounting_type = $12,
          account_id = $13,
          account_code = $14,
          account_name = $15,
          updated_at = NOW()
        WHERE receipt_id = $16
      `, [
        receipt.receipt_number, receipt.receipt_date, receipt.store,
        receipt.worker_id, receipt.worker_name,
        receipt.project_id, receipt.project_name,
        receipt.category_id, receipt.category_name,
        receipt.category_group, receipt.category_type, receipt.accounting_type,
        receipt.account_id, receipt.account_code, receipt.account_name,
        receipt.id
      ]);

      await client.query('COMMIT');
      return res.json(receipt);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update receipt' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT id, upload_id FROM receipts WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Receipt not found' });
      }

      await client.query('DELETE FROM receipts WHERE id = $1', [req.params.id]);
      if (current.rows[0].upload_id) {
        await client.query(
          `UPDATE receipt_uploads
           SET receipt_id = NULL, ai_status = 'db_failed', error_message = 'Receipt deleted by admin'
           WHERE id = $1`,
          [current.rows[0].upload_id]
        );
      }
      await client.query('COMMIT');
      return res.json({ ok: true, deleted: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete receipt' });
    } finally {
      client.release();
    }
  });

  return router;
};
