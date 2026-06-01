const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.get('/workers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT worker_id, name, phone_number
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
    const result = await pool.query(`
      SELECT id, name
      FROM projects
      WHERE COALESCE(active, TRUE) = TRUE
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, active
      FROM categories
      WHERE active = TRUE
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

module.exports = router;
