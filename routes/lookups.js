const express = require('express');
const { pool } = require('../db');
const { cleanInt, cleanText } = require('./helpers');
const { createAccount } = require('../services/accounts');

const router = express.Router();

router.get('/workers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT worker_id, name
      FROM workers
      WHERE COALESCE(is_active, TRUE) = TRUE
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load workers' });
  }
});

router.get('/projects', async (req, res) => {
  try {
    // FNEClock's projects table may not contain an active column.
    const result = await pool.query('SELECT id, name FROM projects ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const kind = req.query.kind || 'expense';
    if (!['expense', 'income'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be expense or income' });
    }
    const result = await pool.query(`
      SELECT c.id, c.transaction_kind, c.type_name, c.general_category, c.detail_category,
             c.name, c.accounting_type, c.project_type_applicability, c.project_required,
             c.ai_handling, c.account_id, a.account_code, a.account_name,
             CONCAT(c.type_name, ' / ', c.general_category, ' / ', c.detail_category) AS display_name
      FROM categories c
      LEFT JOIN chart_accounts a ON a.id = c.account_id
      WHERE c.active = TRUE AND c.transaction_kind = $1
      ORDER BY c.sort_order, c.type_name, c.general_category, c.detail_category
    `, [kind]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});


router.post('/categories', async (req, res) => {
  const client = await pool.connect();
  try {
    const detail = cleanText(req.body.detail_category || req.body.name);
    if (!detail) return res.status(400).json({ error: 'Category name is required' });
    await client.query('BEGIN');

    const existing = await client.query(`
      SELECT c.id, c.transaction_kind, c.type_name, c.general_category, c.detail_category,
             c.accounting_type, c.project_required, c.ai_handling,
             a.account_code, a.account_name,
             CONCAT(c.type_name, ' / ', c.general_category, ' / ', c.detail_category) AS display_name
      FROM categories c
      LEFT JOIN chart_accounts a ON a.id = c.account_id
      WHERE c.transaction_kind = 'expense' AND LOWER(c.detail_category) = LOWER($1)
      LIMIT 1
    `, [detail]);
    if (existing.rows.length) {
      await client.query('UPDATE categories SET active = TRUE, updated_at = NOW() WHERE id = $1', [existing.rows[0].id]);
      await client.query('COMMIT');
      return res.json(existing.rows[0]);
    }

    const account = await createAccount(client, {
      transaction_kind: 'expense',
      accounting_type: 'Review Required',
      account_name: detail,
      source: 'system',
      review_status: 'needs_review'
    });
    const result = await client.query(`
      INSERT INTO categories (
        transaction_kind, type_name, general_category, detail_category, name,
        accounting_type, project_type_applicability, project_required,
        ai_handling, ai_clues, source, sort_order, active, account_id, updated_at
      ) VALUES (
        'expense', 'User Added', 'Other', $1, $1,
        'Review Required', 'All Project Types', 'Optional',
        'Manual Review', 'Worker-added category; admin review required.',
        'user', 9999, TRUE, $2, NOW()
      )
      RETURNING id, transaction_kind, type_name, general_category, detail_category,
                accounting_type, project_required, ai_handling,
                CONCAT(type_name, ' / ', general_category, ' / ', detail_category) AS display_name
    `, [detail, account.id]);
    await client.query('COMMIT');
    return res.status(201).json({ ...result.rows[0], account_code: account.account_code, account_name: account.account_name });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That category already exists' });
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to add category' });
  } finally {
    client.release();
  }
});

router.get('/payment-methods', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, kind, last4 FROM payment_methods WHERE active = TRUE ORDER BY sort_order, LOWER(name)'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load payment methods' });
  }
});

router.get('/accounts', async (req, res) => {
  try {
    const params = [];
    const where = ['active = TRUE'];
    if (req.query.kind) {
      params.push(req.query.kind);
      where.push(`transaction_kind = $${params.length}`);
    }
    const result = await pool.query(`
      SELECT id, account_code, account_name, transaction_kind, accounting_type
      FROM chart_accounts
      WHERE ${where.join(' AND ')}
      ORDER BY account_code
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

async function settingValue(key, fallback) {
  const result = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = $1', [key]);
  return result.rows[0]?.setting_value || fallback;
}

async function recentValue(workerId, column) {
  const allowed = { project_id: 'project_id', category_id: 'category_id' };
  if (!allowed[column]) return null;
  const result = await pool.query(`
    SELECT ${allowed[column]} AS value
    FROM receipts
    WHERE active = TRUE AND worker_id = $1 AND ${allowed[column]} IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `, [workerId]);
  return result.rows[0]?.value || null;
}

async function mostUsedThisMonth(workerId, column) {
  const allowed = { project_id: 'project_id', category_id: 'category_id' };
  if (!allowed[column]) return null;
  const result = await pool.query(`
    SELECT ${allowed[column]} AS value, COUNT(*)::int AS use_count
    FROM receipts
    WHERE active = TRUE
      AND worker_id = $1
      AND ${allowed[column]} IS NOT NULL
      AND COALESCE(receipt_date, created_at::date) >= DATE_TRUNC('month', CURRENT_DATE)::date
    GROUP BY ${allowed[column]}
    ORDER BY use_count DESC, MAX(created_at) DESC
    LIMIT 1
  `, [workerId]);
  return result.rows[0]?.value || null;
}

router.get('/defaults', async (req, res) => {
  try {
    const workerId = cleanInt(req.query.worker_id);
    if (!workerId) return res.json({ project_id: null, category_id: null });

    const [projectRule, categoryRule] = await Promise.all([
      settingValue('default_project_rule', 'recently_used'),
      settingValue('default_category_rule', 'recently_used')
    ]);

    const projectId = projectRule === 'most_used_this_month'
      ? await mostUsedThisMonth(workerId, 'project_id')
      : await recentValue(workerId, 'project_id');
    const categoryId = categoryRule === 'most_used_this_month'
      ? await mostUsedThisMonth(workerId, 'category_id')
      : await recentValue(workerId, 'category_id');

    res.json({ project_id: projectId, category_id: categoryId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load defaults' });
  }
});

module.exports = router;
