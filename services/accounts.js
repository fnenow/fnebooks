const { cleanText } = require('../routes/helpers');

function defaultNormalBalance(transactionKind, accountingType) {
  if (['Current Asset', 'Fixed Asset', 'Cost of Goods Sold', 'Operating Expense'].includes(accountingType)) {
    return 'debit';
  }
  if (['Liability', 'Liability Reduction', 'Equity', 'Operating Income', 'Other Income'].includes(accountingType)) {
    return 'credit';
  }
  return transactionKind === 'expense' ? 'debit' : 'credit';
}

async function generateNextAccountCode(client, transactionKind, accountingType) {
  const ruleResult = await client.query(`
    SELECT *
    FROM account_code_rules
    WHERE transaction_kind = $1
      AND accounting_type = $2
      AND active = TRUE
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    ORDER BY effective_from DESC, id DESC
    LIMIT 1
    FOR UPDATE
  `, [transactionKind, accountingType]);

  if (!ruleResult.rows.length) {
    const err = new Error(`No active account-code rule for ${transactionKind} / ${accountingType}`);
    err.statusCode = 400;
    throw err;
  }

  const rule = ruleResult.rows[0];
  let next = Number(rule.next_code);
  const end = Number(rule.code_end);
  const increment = Number(rule.increment_by);
  const length = Number(rule.code_length);

  while (next <= end) {
    const code = String(next).padStart(length, '0');
    const exists = await client.query('SELECT 1 FROM chart_accounts WHERE account_code = $1', [code]);
    next += increment;
    if (!exists.rows.length) {
      await client.query(
        'UPDATE account_code_rules SET next_code = $1, updated_at = NOW() WHERE id = $2',
        [next, rule.id]
      );
      return code;
    }
  }

  const err = new Error(`Account-code range is exhausted for ${transactionKind} / ${accountingType}`);
  err.statusCode = 409;
  throw err;
}

async function createAccount(client, input) {
  const transactionKind = cleanText(input.transaction_kind);
  const accountingType = cleanText(input.accounting_type);
  const accountName = cleanText(input.account_name);
  if (!['expense', 'income'].includes(transactionKind)) {
    const err = new Error('Transaction kind must be expense or income');
    err.statusCode = 400;
    throw err;
  }
  if (!accountingType || !accountName) {
    const err = new Error('Accounting type and account name are required');
    err.statusCode = 400;
    throw err;
  }

  const accountCode = cleanText(input.account_code) || await generateNextAccountCode(client, transactionKind, accountingType);
  const normalBalance = cleanText(input.normal_balance) || defaultNormalBalance(transactionKind, accountingType);
  if (!['debit', 'credit'].includes(normalBalance)) {
    const err = new Error('Normal balance must be debit or credit');
    err.statusCode = 400;
    throw err;
  }

  const source = ['system', 'workbook', 'ai', 'admin'].includes(input.source) ? input.source : 'system';
  const reviewStatus = ['new', 'approved', 'needs_review', 'inactive'].includes(input.review_status)
    ? input.review_status
    : (source === 'admin' ? 'approved' : 'new');

  const result = await client.query(`
    INSERT INTO chart_accounts (
      account_code, account_name, transaction_kind, accounting_type,
      normal_balance, source, review_status, active, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
    RETURNING *
  `, [accountCode, accountName, transactionKind, accountingType, normalBalance, source, reviewStatus]);

  return result.rows[0];
}

async function getAccountSnapshot(client, accountId) {
  if (!accountId) {
    return { account_id: null, account_code: null, account_name: null };
  }
  const result = await client.query(
    'SELECT id, account_code, account_name FROM chart_accounts WHERE id = $1 LIMIT 1',
    [accountId]
  );
  if (!result.rows.length) {
    const err = new Error('Account not found');
    err.statusCode = 400;
    throw err;
  }
  return {
    account_id: result.rows[0].id,
    account_code: result.rows[0].account_code,
    account_name: result.rows[0].account_name
  };
}

async function syncAccountSnapshots(client, accountId) {
  await client.query(`
    UPDATE receipts r
    SET account_id = a.id,
        account_code = a.account_code,
        account_name = a.account_name,
        updated_at = NOW()
    FROM categories c
    JOIN chart_accounts a ON a.id = c.account_id
    WHERE c.account_id = $1 AND r.category_id = c.id
  `, [accountId]);

  await client.query(`
    UPDATE receipt_items i
    SET account_id = a.id,
        account_code = a.account_code,
        account_name = a.account_name,
        updated_at = NOW()
    FROM categories c
    JOIN chart_accounts a ON a.id = c.account_id
    WHERE c.account_id = $1 AND i.category_id = c.id
  `, [accountId]);
}

module.exports = {
  createAccount,
  defaultNormalBalance,
  generateNextAccountCode,
  getAccountSnapshot,
  syncAccountSnapshots
};
