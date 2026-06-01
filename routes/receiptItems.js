const express = require('express');
const { pool } = require('../db');
const { cleanText, cleanNumber, cleanInt, sendCsv, requireGroupBy } = require('./helpers');
const router = express.Router();

const ITEM_GROUPS = {
  project: { sql: "COALESCE(project_name, 'Missing Project')" },
  store: { sql: "COALESCE(store, 'Missing Store')" },
  product_name: { sql: "COALESCE(product_name, 'Missing Product')" },
  product_code: { sql: "COALESCE(product_code, 'Missing Code')" },
  category: { sql: "COALESCE(category_name, 'Missing Category')" },
  worker: { sql: "COALESCE(worker_name, 'Missing Worker')" },
  month: { sql: "TO_CHAR(receipt_date, 'YYYY-MM')" }
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
  if (query.product_name) add('product_name ILIKE ?', `%${query.product_name}%`);
  if (query.product_code) add('product_code ILIKE ?', `%${query.product_code}%`);

  return { where: where.join(' AND '), params };
}

async function loadNames(client, projectId, categoryId) {
  const names = { project_name: null, category_name: null };
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
    res.json({ mode: 'list', rows: result.rows });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to load receipt items' });
  }
});

router.get('/export.csv', async (req, res) => {
  try {
    const { where, params } = buildItemWhere(req.query);
    const result = await pool.query(`SELECT * FROM receipt_items WHERE ${where} ORDER BY receipt_date, item_id`, params);
    sendCsv(res, 'receipt_items_export.csv', result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to export receipt items');
  }
});

router.patch('/:item_id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM receipt_items WHERE item_id = $1', [req.params.item_id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Item not found' });

    const projectId = req.body.project_id !== undefined ? cleanInt(req.body.project_id) : current.rows[0].project_id;
    const categoryId = req.body.category_id !== undefined ? cleanInt(req.body.category_id) : current.rows[0].category_id;
    const names = await loadNames(client, projectId, categoryId);

    const result = await client.query(`
      UPDATE receipt_items SET
        product_name = COALESCE($1, product_name),
        product_code = COALESCE($2, product_code),
        quantity = COALESCE($3, quantity),
        unit_price = COALESCE($4, unit_price),
        item_total = COALESCE($5, item_total),
        project_id = $6,
        project_name = $7,
        category_id = $8,
        category_name = $9,
        corrected = TRUE,
        correction_note = COALESCE($10, correction_note),
        updated_at = NOW()
      WHERE item_id = $11
      RETURNING *
    `, [
      req.body.product_name !== undefined ? cleanText(req.body.product_name) : null,
      req.body.product_code !== undefined ? cleanText(req.body.product_code) : null,
      req.body.quantity !== undefined ? cleanNumber(req.body.quantity) : null,
      req.body.unit_price !== undefined ? cleanNumber(req.body.unit_price) : null,
      req.body.item_total !== undefined ? cleanNumber(req.body.item_total) : null,
      projectId,
      names.project_name,
      categoryId,
      names.category_name,
      req.body.correction_note !== undefined ? cleanText(req.body.correction_note) : null,
      req.params.item_id
    ]);

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update item' });
  } finally {
    client.release();
  }
});

module.exports = router;
