const express = require('express');
const { pool } = require('../db');
const { cleanText, cleanInt, isTrue } = require('./helpers');

const router = express.Router();
const KINDS = ['cash', 'check', 'card', 'bank', 'other'];

// How many active receipts currently reference a payment method (matched on the
// stored payment_method text, case-insensitive).
const USAGE_SELECT = `
  SELECT pm.*, COALESCE(u.uses, 0)::int AS receipt_count
  FROM payment_methods pm
  LEFT JOIN (
    SELECT LOWER(payment_method) AS name, COUNT(*) AS uses
    FROM receipts
    WHERE active = TRUE AND payment_method IS NOT NULL
    GROUP BY LOWER(payment_method)
  ) u ON u.name = LOWER(pm.name)
`;

router.get('/', async (req, res) => {
  try {
    const where = req.query.status === 'all' ? '' : 'WHERE pm.active = TRUE';
    const result = await pool.query(`${USAGE_SELECT} ${where} ORDER BY pm.active DESC, pm.sort_order, LOWER(pm.name)`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load payment methods' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = cleanText(req.body.name);
    if (!name) return res.status(400).json({ error: 'Payment method name is required' });
    const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'other';
    const last4 = cleanText(req.body.last4);
    if (last4 && !/^\d{4}$/.test(last4)) return res.status(400).json({ error: 'Card last 4 must be exactly 4 digits' });
    const note = cleanText(req.body.note);
    const sortOrder = cleanInt(req.body.sort_order) ?? 100;
    const result = await pool.query(`
      INSERT INTO payment_methods (name, kind, last4, note, sort_order, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *
    `, [name, kind, last4, note, sortOrder]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That payment method already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add payment method' });
  }
});

router.patch('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM payment_methods WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment method not found' });
    }
    const current = currentResult.rows[0];
    const name = req.body.name !== undefined ? cleanText(req.body.name) : current.name;
    if (!name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment method name is required' });
    }
    const kind = req.body.kind !== undefined ? (KINDS.includes(req.body.kind) ? req.body.kind : 'other') : current.kind;
    const last4 = req.body.last4 !== undefined ? cleanText(req.body.last4) : current.last4;
    if (last4 && !/^\d{4}$/.test(last4)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Card last 4 must be exactly 4 digits' });
    }
    const note = req.body.note !== undefined ? cleanText(req.body.note) : current.note;
    const active = req.body.active !== undefined ? isTrue(req.body.active) : current.active;
    const sortOrder = req.body.sort_order !== undefined ? (cleanInt(req.body.sort_order) ?? current.sort_order) : current.sort_order;

    // Renaming a method keeps existing receipts in sync so the balance sheet
    // groups them under the new name.
    if (name.toLowerCase() !== current.name.toLowerCase()) {
      await client.query('UPDATE receipts SET payment_method = $1, updated_at = NOW() WHERE LOWER(payment_method) = LOWER($2)', [name, current.name]);
    }
    const result = await client.query(`
      UPDATE payment_methods SET name = $1, kind = $2, last4 = $3, note = $4, active = $5, sort_order = $6, updated_at = NOW()
      WHERE id = $7 RETURNING *
    `, [name, kind, last4, note, active, sortOrder, req.params.id]);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'That payment method already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update payment method' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const found = await pool.query('SELECT name FROM payment_methods WHERE id = $1', [req.params.id]);
    if (!found.rows.length) return res.status(404).json({ error: 'Payment method not found' });
    const used = await pool.query(
      'SELECT 1 FROM receipts WHERE LOWER(payment_method) = LOWER($1) LIMIT 1',
      [found.rows[0].name]
    );
    if (used.rows.length) {
      return res.status(409).json({ error: 'This payment method is used by receipts. Deactivate it instead of deleting.' });
    }
    await pool.query('DELETE FROM payment_methods WHERE id = $1', [req.params.id]);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
});

module.exports = router;
