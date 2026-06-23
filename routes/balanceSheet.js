const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Standard ordering for the balance-sheet sections.
const SECTION_ORDER = ['Assets', 'Liabilities', 'Equity', 'Expenses', 'Income', 'Unclassified'];

function buildWhere(query) {
  const where = [];
  const params = [];
  const add = (clause, value) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (query.start_date) add('receipt_date >= ?', query.start_date);
  if (query.end_date) add('receipt_date <= ?', query.end_date);
  if (query.worker_id) add('worker_id = ?', query.worker_id);
  if (query.project_id) add('project_id = ?', query.project_id);
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Aggregated accounting balance sheet plus spending and payment-method
// breakdowns, all derived from active receipts via v_receipt_accounting. Any
// create / edit / deactivate / delete / payment-method change is reflected
// immediately because the figures are computed from current data.
router.get('/', async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query);

    const [sections, byAccount, byPaymentMethod, byMonth] = await Promise.all([
      pool.query(`
        SELECT balance_section,
               COUNT(*)::int AS receipt_count,
               COALESCE(SUM(total), 0)::numeric(14,2) AS total_amount,
               COALESCE(SUM(tax), 0)::numeric(14,2) AS total_tax
        FROM v_receipt_accounting ${where}
        GROUP BY balance_section
      `, params),
      pool.query(`
        SELECT balance_section, accounting_type,
               COALESCE(account_code, 'N/A') AS account_code,
               COALESCE(account_name, category_name, 'Unclassified') AS account_name,
               COUNT(*)::int AS receipt_count,
               COALESCE(SUM(total), 0)::numeric(14,2) AS total_amount
        FROM v_receipt_accounting ${where}
        GROUP BY balance_section, accounting_type, account_code, account_name
        ORDER BY balance_section, account_code
      `, params),
      pool.query(`
        SELECT payment_method,
               COUNT(*)::int AS receipt_count,
               COALESCE(SUM(total), 0)::numeric(14,2) AS total_amount
        FROM v_receipt_accounting ${where}
        GROUP BY payment_method
        ORDER BY total_amount DESC
      `, params),
      pool.query(`
        SELECT COALESCE(TO_CHAR(receipt_date, 'YYYY-MM'), 'No Date') AS month,
               COALESCE(SUM(total) FILTER (WHERE balance_section = 'Expenses'), 0)::numeric(14,2) AS spending,
               COALESCE(SUM(total), 0)::numeric(14,2) AS total_amount
        FROM v_receipt_accounting ${where}
        GROUP BY month
        ORDER BY month DESC
        LIMIT 24
      `, params)
    ]);

    const sectionRows = sections.rows.slice().sort(
      (a, b) => SECTION_ORDER.indexOf(a.balance_section) - SECTION_ORDER.indexOf(b.balance_section)
    );
    const sectionTotal = name => Number(sectionRows.find(r => r.balance_section === name)?.total_amount || 0);

    res.json({
      sections: sectionRows,
      by_account: byAccount.rows,
      by_payment_method: byPaymentMethod.rows,
      by_month: byMonth.rows,
      summary: {
        spending: sectionTotal('Expenses'),
        income: sectionTotal('Income'),
        assets: sectionTotal('Assets'),
        liabilities: sectionTotal('Liabilities'),
        equity: sectionTotal('Equity'),
        unclassified: sectionTotal('Unclassified'),
        recorded_total: sectionRows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load balance sheet' });
  }
});

module.exports = router;
