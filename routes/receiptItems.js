const express = require('express');
const { pool } = require('../db');
const { cleanText, cleanNumber, cleanInt, sendCsv, requireGroupBy } = require('./helpers');
const router = express.Router();

const ITEM_GROUPS = {
  project: { sql: "COALESCE(project_name, 'Missing Project')" },
  store: { sql: "COALESCE(store, 'Missing Store')" },
  product_name: { sql: "COALESCE(product_name, 'Missing Product')" },
  product_code: { sql: "COALESCE(product_code, 'Missing Code')" },
  category: { sql: "COALESCE(category_group, category_name, 'Missing Category')" },
  detail_category: { sql: "COALESCE(category_name, 'Missing Detail Category')" },
  account: { sql: "COALESCE(account_code || ' - ' || account_name, 'Missing Account')" },
  worker: { sql: "COALESCE(worker_name, 'Missing Worker')" },
  month: { sql: "COALESCE(TO_CHAR(receipt_date, 'YYYY-MM'), 'Missing Date')" }
};

function buildItemWhere(query) {
  const where = ['1 = 1'];
  const params = [];
  const add = (clause, value) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (query.start_date) add('receipt_date >= ?', query.start_date);
  if (query.end_date) add('receipt_date <= ?', query.end_date);
  if (query.item_id) add('item_id = ?', query.item_id);
  if (query.project_id) add('project_id = ?', query.project_id);
  if (query.worker_id) add('worker_id = ?', query.worker_id);
  if (query.category_id) add('category_id = ?', query.category_id);
  if (query.account_id) add('account_id = ?', query.account_id);
  if (query.product_name) add('product_name ILIKE ?', `%${query.product_name}%`);
  if (query.product_code) add('product_code ILIKE ?', `%${query.product_code}%`);

  return { where: where.join(' AND '), params };
}

async function loadSnapshots(client, projectId, categoryId) {
  const snapshot = {
    project_name: null,
    category_name: null,
    category_group: null,
    category_type: null,
    accounting_type: null,
    account_id: null,
    account_code: null,
    account_name: null
  };

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

router.get('/', async (req, res) => {
  try {
    const group = requireGroupBy(req.query.group_by, ITEM_GROUPS);
    const { where, params } = buildItemWhere(req.query);

    if (group) {
      const result = await pool.query(`
        SELECT ${group.sql} AS group_value,
               COUNT(*)::int AS item_count,
               COALESCE(SUM(quantity), 0)::numeric(12,3) AS total_quantity,
               COALESCE(SUM(item_total), 0)::numeric(12,2) AS total_amount
        FROM receipt_items
        WHERE ${where}
        GROUP BY ${group.sql}
        ORDER BY group_value NULLS LAST
      `, params);
      return res.json({ mode: 'grouped', group_by: req.query.group_by, rows: result.rows });
    }

    const result = await pool.query(`
      SELECT *
      FROM receipt_items
      WHERE ${where}
      ORDER BY receipt_date DESC NULLS LAST, item_id DESC
      LIMIT 1000
    `, params);
    return res.json({ mode: 'list', rows: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to load receipt items' });
  }
});

router.get('/export.csv', async (req, res) => {
  try {
    const { where, params } = buildItemWhere(req.query);
    const result = await pool.query(`SELECT * FROM receipt_items WHERE ${where} ORDER BY receipt_date, item_id`, params);
    return sendCsv(res, 'receipt_items_export.csv', result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to export receipt items');
  }
});

router.patch('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM receipt_items WHERE item_id = $1 FOR UPDATE', [req.params.id]);
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Receipt item not found' });
    }

    const current = currentResult.rows[0];
    const next = {
      product_name: req.body.product_name !== undefined ? cleanText(req.body.product_name) : current.product_name,
      product_code: req.body.product_code !== undefined ? cleanText(req.body.product_code) : current.product_code,
      quantity: req.body.quantity !== undefined ? cleanNumber(req.body.quantity) : current.quantity,
      unit_price: req.body.unit_price !== undefined ? cleanNumber(req.body.unit_price) : current.unit_price,
      item_total: req.body.item_total !== undefined ? cleanNumber(req.body.item_total) : current.item_total,
      project_id: req.body.project_id !== undefined ? cleanInt(req.body.project_id) : current.project_id,
      category_id: req.body.category_id !== undefined ? cleanInt(req.body.category_id) : current.category_id,
      correction_note: req.body.correction_note !== undefined ? cleanText(req.body.correction_note) : current.correction_note
    };
    const snapshot = await loadSnapshots(client, next.project_id, next.category_id);

    const result = await client.query(`
      UPDATE receipt_items SET
        product_name = $1,
        product_code = $2,
        quantity = $3,
        unit_price = $4,
        item_total = $5,
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
        corrected = TRUE,
        correction_note = $16,
        updated_at = NOW()
      WHERE item_id = $17
      RETURNING *
    `, [
      next.product_name, next.product_code, next.quantity, next.unit_price, next.item_total,
      next.project_id, snapshot.project_name,
      next.category_id, snapshot.category_name, snapshot.category_group,
      snapshot.category_type, snapshot.accounting_type,
      snapshot.account_id, snapshot.account_code, snapshot.account_name,
      next.correction_note, req.params.id
    ]);

    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update receipt item' });
  } finally {
    client.release();
  }
});

module.exports = router;
