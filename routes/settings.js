const express = require('express');
const { pool } = require('../db');
const { cleanText } = require('./helpers');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_settings ORDER BY setting_key');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/:setting_key', async (req, res) => {
  try {
    const key = req.params.setting_key;
    const value = cleanText(req.body.setting_value);
    const type = cleanText(req.body.setting_type) || 'text';
    const description = cleanText(req.body.description);
    const result = await pool.query(`
      INSERT INTO app_settings (setting_key, setting_value, setting_type, description, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, 'admin', NOW())
      ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        setting_type = EXCLUDED.setting_type,
        description = COALESCE(EXCLUDED.description, app_settings.description),
        updated_by = 'admin',
        updated_at = NOW()
      RETURNING *
    `, [key, value, type, description]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

module.exports = router;
