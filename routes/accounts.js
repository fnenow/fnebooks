const express = require('express');
const { pool } = require('../db');
const { cleanText, isTrue } = require('./helpers');
const { createAccount, syncAccountSnapshots } = require('../services/accounts');

const router = express.Router();

function buildWhere(query) {
  const where = ['1 = 1'];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (query.created_from) add('created_at::date >= ?', query.created_from);
  if (query.created_to) add('created_at::date <= ?', query.created_to);
  if (query.transaction_kind) add('transaction_kind = ?', query.transaction_kind);
  if (query.accounting_type) add('accounting_type = ?', query.accounting_type);
  if (query.source) add('source = ?', query.source);
  if (query.review_status) add('review_status = ?', query.review_status);
  if (query.active === 'true') where.push('active = TRUE');
  if (query.active === 'false') where.push('active = FALSE');
  if (query.search) {
    params.push(`%${query.search}%`);
    const index = params.length;
    where.push(`(account_code ILIKE $${index} OR account_name ILIKE $${index})`);
  }

  return { where: where.join(' AND '), params };
}

router.get('/', async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query);
    const result = await pool.query(`
      SELECT a.*,
             COUNT(c.id)::int AS category_count
      FROM chart_accounts a
      LEFT JOIN categories c ON c.account_id = a.id
      WHERE ${where}
      GROUP BY a.id
      ORDER BY a.account_code
      LIMIT 1000
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

router.get('/rules', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM account_code_rules
      ORDER BY transaction_kind, accounting_type, effective_from DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load account-code rules' });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await createAccount(client, { ...req.body, source: req.body.source || 'admin' });
    await client.query('COMMIT');
    res.status(201).json(account);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create account' });
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM chart_accounts WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found' });
    }
    const current = currentResult.rows[0];
    const next = {
      account_code: req.body.account_code !== undefined ? cleanText(req.body.account_code) : current.account_code,
      account_name: req.body.account_name !== undefined ? cleanText(req.body.account_name) : current.account_name,
      accounting_type: req.body.accounting_type !== undefined ? cleanText(req.body.accounting_type) : current.accounting_type,
      normal_balance: req.body.normal_balance !== undefined ? cleanText(req.body.normal_balance) : current.normal_balance,
      review_status: req.body.review_status !== undefined ? cleanText(req.body.review_status) : current.review_status,
      active: req.body.active !== undefined ? isTrue(req.body.active) : current.active
    };

    if (!next.account_code || !next.account_name || !next.accounting_type) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Code, name, and accounting type are required' });
    }
    if (!['debit', 'credit'].includes(next.normal_balance)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Normal balance must be debit or credit' });
    }
    if (!['new', 'approved', 'needs_review', 'inactive'].includes(next.review_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid review status' });
    }

    const result = await client.query(`
      UPDATE chart_accounts SET
        account_code = $1,
        account_name = $2,
        accounting_type = $3,
        normal_balance = $4,
        review_status = $5,
        active = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [
      next.account_code, next.account_name, next.accounting_type,
      next.normal_balance, next.review_status, next.active, req.params.id
    ]);

    await syncAccountSnapshots(client, Number(req.params.id));
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(500).json({ error: 'Failed to update account' });
  } finally {
    client.release();
  }
});

module.exports = router;
