const express = require('express');
const { pool } = require('../db');
const { cleanText, isTrue } = require('./helpers');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, active, created_at, updated_at FROM categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = cleanText(req.body.name);
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const result = await pool.query(
      `INSERT INTO categories (name, active, updated_at)
       VALUES ($1, TRUE, NOW())
       ON CONFLICT (name) DO UPDATE SET active = TRUE, updated_at = NOW()
       RETURNING *`,
      [name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save category' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const name = cleanText(req.body.name);
    const active = req.body.active === undefined ? null : isTrue(req.body.active);
    const result = await pool.query(
      `UPDATE categories
       SET name = COALESCE($1, name),
           active = COALESCE($2, active),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name, active, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

module.exports = router;
