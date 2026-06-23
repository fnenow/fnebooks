const express = require('express');
const { pool } = require('../db');
const {
  cleanText,
  cleanNumber,
  cleanInt,
  isIsoDate,
  toIsoDate,
  sendCsv,
  requireGroupBy,
  safeFilename
} = require('./helpers');

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
  // Default to active receipts; allow viewing deactivated ones for reactivation.
  const status = query.status === 'inactive' ? 'inactive' : query.status === 'all' ? 'all' : 'active';
  const where = [];
  if (status === 'active') where.push('active = TRUE');
  else if (status === 'inactive') where.push('active = FALSE');
  const params = [];
  const add = (clause, value) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (where.length === 0) where.push('1 = 1');

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

module.exports = ({ requireAdmin }) => {
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

  router.get('/:id/file', requireAdmin, async (req, res) => {
    try {
      let result = await pool.query(
        'SELECT filename, mime_type, file_data FROM receipt_files WHERE receipt_id = $1',
        [req.params.id]
      );
      // Several receipts from one uploaded file share a single stored file.
      // Fall back to a sibling receipt with the same upload_id.
      if (!result.rows.length) {
        result = await pool.query(`
          SELECT f.filename, f.mime_type, f.file_data
          FROM receipts r
          JOIN receipts sibling ON sibling.upload_id = r.upload_id
          JOIN receipt_files f ON f.receipt_id = sibling.id
          WHERE r.id = $1 AND r.upload_id IS NOT NULL
          LIMIT 1
        `, [req.params.id]);
      }
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
        receipt_date: req.body.receipt_date !== undefined ? cleanText(req.body.receipt_date) : toIsoDate(current.receipt_date),
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

  // Soft deactivate / reactivate. Deactivating a receipt removes it from the
  // balance sheet and spending totals, and deactivates its line items too.
  async function setReceiptActive(req, res, active) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT id FROM receipts WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Receipt not found' });
      }
      const result = await client.query(
        'UPDATE receipts SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [active, req.params.id]
      );
      await client.query(
        'UPDATE receipt_items SET active = $1, updated_at = NOW() WHERE receipt_id = $2',
        [active, req.params.id]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, active, receipt: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      return res.status(500).json({ error: `Failed to ${active ? 'reactivate' : 'deactivate'} receipt` });
    } finally {
      client.release();
    }
  }

  router.post('/:id/deactivate', requireAdmin, (req, res) => setReceiptActive(req, res, false));
  router.post('/:id/reactivate', requireAdmin, (req, res) => setReceiptActive(req, res, true));

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
