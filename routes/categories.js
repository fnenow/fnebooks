const express = require('express');
const { pool } = require('../db');
const { cleanText, cleanInt, isTrue } = require('./helpers');
const { createAccount, getAccountSnapshot } = require('../services/accounts');

const router = express.Router();

function normalizedCategory(body, current = {}) {
  const detail = cleanText(body.detail_category ?? body.name) || current.detail_category || current.name;
  return {
    transaction_kind: cleanText(body.transaction_kind) || current.transaction_kind || 'expense',
    type_name: cleanText(body.type_name) || current.type_name || 'User Added',
    general_category: cleanText(body.general_category) || current.general_category || 'Other',
    detail_category: detail,
    name: detail,
    accounting_type: cleanText(body.accounting_type) || current.accounting_type || 'Review Required',
    project_type_applicability: cleanText(body.project_type_applicability) || current.project_type_applicability || 'All Project Types',
    project_required: cleanText(body.project_required) || current.project_required || 'Optional',
    ai_handling: cleanText(body.ai_handling) || current.ai_handling || 'Prefill & Review',
    ai_clues: body.ai_clues !== undefined ? cleanText(body.ai_clues) : current.ai_clues,
    sort_order: body.sort_order !== undefined ? cleanInt(body.sort_order) : (current.sort_order || 9999),
    active: body.active === undefined ? (current.active ?? true) : isTrue(body.active),
    account_id: body.account_id !== undefined ? cleanInt(body.account_id) : current.account_id
  };
}

function validateCategory(data) {
  if (!data.detail_category) return 'Detail category is required';
  if (!['expense', 'income'].includes(data.transaction_kind)) return 'Transaction kind must be expense or income';
  if (!['Yes', 'No', 'Optional'].includes(data.project_required)) return 'Project Required must be Yes, No, or Optional';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.query.kind) {
      params.push(req.query.kind);
      where.push(`c.transaction_kind = $${params.length}`);
    }
    if (req.query.active === 'true') where.push('c.active = TRUE');
    if (req.query.active === 'false') where.push('c.active = FALSE');

    const result = await pool.query(`
      SELECT c.id, c.transaction_kind, c.type_name, c.general_category, c.detail_category,
             c.name, c.accounting_type, c.project_type_applicability, c.project_required,
             c.ai_handling, c.ai_clues, c.source, c.sort_order, c.active,
             c.account_id, a.account_code, a.account_name,
             c.created_at, c.updated_at
      FROM categories c
      LEFT JOIN chart_accounts a ON a.id = c.account_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.transaction_kind, c.sort_order, c.type_name, c.general_category, c.detail_category
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const data = normalizedCategory(req.body);
    const validationError = validateCategory(data);
    if (validationError) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: validationError });
    }

    const existingResult = await client.query(`
      SELECT id, account_id
      FROM categories
      WHERE transaction_kind = $1
        AND type_name = $2
        AND general_category = $3
        AND detail_category = $4
      LIMIT 1
    `, [data.transaction_kind, data.type_name, data.general_category, data.detail_category]);

    let accountId = data.account_id || existingResult.rows[0]?.account_id || null;
    if (accountId) {
      await getAccountSnapshot(client, accountId);
    } else {
      const account = await createAccount(client, {
        transaction_kind: data.transaction_kind,
        accounting_type: data.accounting_type,
        account_name: data.detail_category,
        source: 'system',
        review_status: 'new'
      });
      accountId = account.id;
    }

    const result = await client.query(`
      INSERT INTO categories (
        transaction_kind, type_name, general_category, detail_category, name,
        accounting_type, project_type_applicability, project_required,
        ai_handling, ai_clues, source, sort_order, active, account_id, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'user',$11,$12,$13,NOW())
      ON CONFLICT (transaction_kind, type_name, general_category, detail_category)
      DO UPDATE SET
        name = EXCLUDED.name,
        accounting_type = EXCLUDED.accounting_type,
        project_type_applicability = EXCLUDED.project_type_applicability,
        project_required = EXCLUDED.project_required,
        ai_handling = EXCLUDED.ai_handling,
        ai_clues = EXCLUDED.ai_clues,
        account_id = EXCLUDED.account_id,
        active = EXCLUDED.active,
        updated_at = NOW()
      RETURNING *
    `, [
      data.transaction_kind, data.type_name, data.general_category, data.detail_category,
      data.name, data.accounting_type, data.project_type_applicability,
      data.project_required, data.ai_handling, data.ai_clues,
      data.sort_order, data.active, accountId
    ]);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That category or account already exists' });
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save category' });
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Category not found' });
    }

    const data = normalizedCategory(req.body, currentResult.rows[0]);
    const validationError = validateCategory(data);
    if (validationError) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: validationError });
    }
    if (data.account_id) await getAccountSnapshot(client, data.account_id);

    const result = await client.query(`
      UPDATE categories SET
        transaction_kind = $1,
        type_name = $2,
        general_category = $3,
        detail_category = $4,
        name = $5,
        accounting_type = $6,
        project_type_applicability = $7,
        project_required = $8,
        ai_handling = $9,
        ai_clues = $10,
        sort_order = $11,
        active = $12,
        account_id = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `, [
      data.transaction_kind, data.type_name, data.general_category, data.detail_category,
      data.name, data.accounting_type, data.project_type_applicability,
      data.project_required, data.ai_handling, data.ai_clues,
      data.sort_order, data.active, data.account_id, req.params.id
    ]);

    await client.query(`
      UPDATE receipts r
      SET category_name = c.detail_category,
          category_group = c.general_category,
          category_type = c.type_name,
          accounting_type = c.accounting_type,
          account_id = a.id,
          account_code = a.account_code,
          account_name = a.account_name,
          updated_at = NOW()
      FROM categories c
      LEFT JOIN chart_accounts a ON a.id = c.account_id
      WHERE c.id = $1 AND r.category_id = c.id
    `, [req.params.id]);

    await client.query(`
      UPDATE receipt_items i
      SET category_name = c.detail_category,
          category_group = c.general_category,
          category_type = c.type_name,
          accounting_type = c.accounting_type,
          account_id = a.id,
          account_code = a.account_code,
          account_name = a.account_name,
          updated_at = NOW()
      FROM categories c
      LEFT JOIN chart_accounts a ON a.id = c.account_id
      WHERE c.id = $1 AND i.category_id = c.id
    `, [req.params.id]);

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That category already exists' });
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update category' });
  } finally {
    client.release();
  }
});

module.exports = router;
