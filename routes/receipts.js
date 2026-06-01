const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const {
  cleanText,
  cleanNumber,
  cleanInt,
  isTrue,
  sendCsv,
  requireGroupBy
} = require('./helpers');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const RECEIPT_GROUPS = {
  project: { label: 'project_name', sql: "COALESCE(project_name, 'Missing Project')" },
  worker: { label: 'worker_name', sql: "COALESCE(worker_name, 'Missing Worker')" },
  category: { label: 'category_name', sql: "COALESCE(category_name, 'Missing Category')" },
  store: { label: 'store', sql: "COALESCE(store, 'Missing Store')" },
  payment_method: { label: 'payment_method', sql: "COALESCE(payment_method, 'Missing Payment Method')" },
  follow_up: { label: 'follow_up', sql: "COALESCE(follow_up, 'Missing Follow Up')" },
  month: { label: 'month', sql: "TO_CHAR(receipt_date, 'YYYY-MM')" }
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
  if (query.store) add('store ILIKE ?', `%${query.store}%`);
  if (query.receipt_number) add('receipt_number ILIKE ?', `%${query.receipt_number}%`);
  if (query.payment_method) add('payment_method ILIKE ?', `%${query.payment_method}%`);
  if (query.follow_up) add('follow_up = ?', query.follow_up);
  if (query.corrected === 'yes') where.push('corrected = TRUE');
  if (query.corrected === 'no') where.push('corrected = FALSE');
  if (query.missing_info_only === 'true') where.push('missing_info = TRUE');

  return { where: where.join(' AND '), params };
}

function calculateMissingInfo(data) {
  return !data.receipt_date || !data.store || !data.worker_id || !data.project_id || !data.category_id || data.total === null || data.total === undefined;
}

async function loadNames(client, workerId, projectId, categoryId) {
  const names = { worker_name: null, project_name: null, category_name: null };
  if (workerId) {
    const r = await client.query('SELECT name FROM workers WHERE worker_id = $1 LIMIT 1', [workerId]);
    names.worker_name = r.rows[0]?.name || null;
  }
  if (projectId) {
    const r = await client.query('SELECT name FROM projects WHERE id = $1 LIMIT 1', [projectId]);
    names.project_name = r.rows[0]?.name || null;
  }
  if (categoryId) {
    const r = await client.query('SELECT name FROM categories WHERE id = $1 LIMIT 1', [categoryId]);
    names.category_name = r.rows[0]?.name || null;
  }
  return names;
}

module.exports = ({ requireAdmin }) => {
  const router = express.Router();

  // Admin list and group-by report.
  router.get('/', requireAdmin, async (req, res) => {
    try {
      const group = requireGroupBy(req.query.group_by, RECEIPT_GROUPS);
      const { where, params } = buildReceiptWhere(req.query);

      if (group) {
        const sql = `
          SELECT ${group.sql} AS group_value,
                 COUNT(*)::int AS receipt_count,
                 COALESCE(SUM(total), 0)::numeric(12,2) AS total_amount,
                 COALESCE(SUM(tax), 0)::numeric(12,2) AS total_tax
          FROM receipts
          WHERE ${where}
          GROUP BY ${group.sql}
          ORDER BY group_value NULLS LAST
        `;
        const result = await pool.query(sql, params);
        return res.json({ mode: 'grouped', group_by: req.query.group_by, rows: result.rows });
      }

      const result = await pool.query(`
        SELECT *
        FROM receipts
        WHERE ${where}
        ORDER BY receipt_date DESC NULLS LAST, id DESC
        LIMIT 500
      `, params);
      res.json({ mode: 'list', rows: result.rows });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Failed to load receipts' });
    }
  });

  router.get('/export.csv', requireAdmin, async (req, res) => {
    try {
      const { where, params } = buildReceiptWhere(req.query);
      const result = await pool.query(`SELECT * FROM receipts WHERE ${where} ORDER BY receipt_date, id`, params);
      sendCsv(res, 'receipts_export.csv', result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).send('Failed to export receipts');
    }
  });

  // Worker upload/manual create. Active immediately. Admin can correct later.
  router.post('/', upload.single('receipt_file'), async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

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
        payment_method: cleanText(req.body.payment_method),
        follow_up: cleanText(req.body.follow_up),
        note: cleanText(req.body.note),
        ai_confidence: cleanNumber(req.body.ai_confidence)
      };

      if (data.follow_up && !['reimburse', 'collect'].includes(data.follow_up)) {
        return res.status(400).json({ error: 'follow_up must be reimburse or collect' });
      }

      const names = await loadNames(client, data.worker_id, data.project_id, data.category_id);
      const missingInfo = calculateMissingInfo(data);

      const receiptResult = await client.query(`
        INSERT INTO receipts (
          receipt_number, receipt_date, worker_id, worker_name, store,
          project_id, project_name, category_id, category_name,
          subtotal, tax, total, payment_method, follow_up, note,
          source_file_name, source_mime_type, ai_confidence, missing_info
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING *
      `, [
        data.receipt_number, data.receipt_date || null, data.worker_id, names.worker_name, data.store,
        data.project_id, names.project_name, data.category_id, names.category_name,
        data.subtotal, data.tax, data.total, data.payment_method, data.follow_up, data.note,
        req.file?.originalname || null, req.file?.mimetype || null, data.ai_confidence, missingInfo
      ]);

      const receipt = receiptResult.rows[0];

      if (req.file) {
        await client.query(`
          INSERT INTO receipt_files (receipt_id, filename, mime_type, size_bytes, file_data)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (receipt_id) DO UPDATE SET
            filename = EXCLUDED.filename,
            mime_type = EXCLUDED.mime_type,
            size_bytes = EXCLUDED.size_bytes,
            file_data = EXCLUDED.file_data
        `, [receipt.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer]);
      }

      let items = [];
      if (req.body.items_json) {
        try {
          items = JSON.parse(req.body.items_json);
          if (!Array.isArray(items)) items = [];
        } catch (err) {
          items = [];
        }
      }

      for (const item of items) {
        await client.query(`
          INSERT INTO receipt_items (
            receipt_id, receipt_number, receipt_date, store, worker_id, worker_name,
            product_name, product_code, quantity, unit_price, item_total,
            project_id, project_name, category_id, category_name
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
          receipt.id, receipt.receipt_number, receipt.receipt_date, receipt.store, receipt.worker_id, receipt.worker_name,
          cleanText(item.product_name), cleanText(item.product_code), cleanNumber(item.quantity), cleanNumber(item.unit_price), cleanNumber(item.item_total),
          receipt.project_id, receipt.project_name, receipt.category_id, receipt.category_name
        ]);
      }

      await client.query('COMMIT');
      res.json({ ok: true, receipt });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Failed to create receipt' });
    } finally {
      client.release();
    }
  });

  router.get('/:id/file', requireAdmin, async (req, res) => {
    try {
      const result = await pool.query('SELECT filename, mime_type, file_data FROM receipt_files WHERE receipt_id = $1', [req.params.id]);
      if (!result.rows.length) return res.status(404).send('File not found');
      const file = result.rows[0];
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${file.filename || 'receipt'}"`);
      res.send(file.file_data);
    } catch (err) {
      console.error(err);
      res.status(500).send('Failed to load file');
    }
  });

  router.patch('/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM receipts WHERE id = $1', [req.params.id]);
      if (!current.rows.length) return res.status(404).json({ error: 'Receipt not found' });

      const body = req.body;
      const workerId = body.worker_id !== undefined ? cleanInt(body.worker_id) : current.rows[0].worker_id;
      const projectId = body.project_id !== undefined ? cleanInt(body.project_id) : current.rows[0].project_id;
      const categoryId = body.category_id !== undefined ? cleanInt(body.category_id) : current.rows[0].category_id;
      const names = await loadNames(client, workerId, projectId, categoryId);

      const followUp = body.follow_up !== undefined ? cleanText(body.follow_up) : current.rows[0].follow_up;
      if (followUp && !['reimburse', 'collect'].includes(followUp)) {
        return res.status(400).json({ error: 'follow_up must be reimburse or collect' });
      }

      const nextData = {
        receipt_date: body.receipt_date !== undefined ? cleanText(body.receipt_date) : current.rows[0].receipt_date,
        store: body.store !== undefined ? cleanText(body.store) : current.rows[0].store,
        worker_id: workerId,
        project_id: projectId,
        category_id: categoryId,
        total: body.total !== undefined ? cleanNumber(body.total) : current.rows[0].total
      };
      const missingInfo = calculateMissingInfo(nextData);

      const result = await client.query(`
        UPDATE receipts SET
          receipt_number = COALESCE($1, receipt_number),
          receipt_date = COALESCE($2, receipt_date),
          worker_id = $3,
          worker_name = $4,
          store = COALESCE($5, store),
          project_id = $6,
          project_name = $7,
          category_id = $8,
          category_name = $9,
          subtotal = COALESCE($10, subtotal),
          tax = COALESCE($11, tax),
          total = COALESCE($12, total),
          payment_method = COALESCE($13, payment_method),
          follow_up = $14,
          note = COALESCE($15, note),
          corrected = TRUE,
          correction_note = COALESCE($16, correction_note),
          missing_info = $17,
          updated_at = NOW()
        WHERE id = $18
        RETURNING *
      `, [
        body.receipt_number !== undefined ? cleanText(body.receipt_number) : null,
        body.receipt_date !== undefined ? cleanText(body.receipt_date) : null,
        workerId, names.worker_name,
        body.store !== undefined ? cleanText(body.store) : null,
        projectId, names.project_name,
        categoryId, names.category_name,
        body.subtotal !== undefined ? cleanNumber(body.subtotal) : null,
        body.tax !== undefined ? cleanNumber(body.tax) : null,
        body.total !== undefined ? cleanNumber(body.total) : null,
        body.payment_method !== undefined ? cleanText(body.payment_method) : null,
        followUp,
        body.note !== undefined ? cleanText(body.note) : null,
        body.correction_note !== undefined ? cleanText(body.correction_note) : null,
        missingInfo,
        req.params.id
      ]);

      // Keep receipt_items denormalized report fields aligned with corrected receipt header.
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
          updated_at = NOW()
        WHERE receipt_id = $10
      `, [
        result.rows[0].receipt_number, result.rows[0].receipt_date, result.rows[0].store,
        result.rows[0].worker_id, result.rows[0].worker_name,
        result.rows[0].project_id, result.rows[0].project_name,
        result.rows[0].category_id, result.rows[0].category_name,
        req.params.id
      ]);

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Failed to update receipt' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      await pool.query('UPDATE receipts SET active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to deactivate receipt' });
    }
  });

  return router;
};
