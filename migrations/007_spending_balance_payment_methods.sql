-- Spending ledger view, accounting balance sheet, managed payment methods,
-- and receipt-item soft deactivation.
-- Safe to run more than once.

-- 1) Receipt items can be soft-deactivated together with their receipt.
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;
UPDATE receipt_items SET active = TRUE WHERE active IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipt_items_active ON receipt_items(active);

-- Helpful filters for the balance sheet / spending aggregations.
CREATE INDEX IF NOT EXISTS idx_receipts_active ON receipts(active);
CREATE INDEX IF NOT EXISTS idx_receipts_payment_method ON receipts(payment_method);

-- 2) Managed list of payment methods (cash, check, bank, card last-4, etc.).
CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('cash', 'check', 'card', 'bank', 'other')),
  last4 TEXT,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Receipts already store payment_method as text; match on the lowercased name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_name ON payment_methods(LOWER(name));

INSERT INTO payment_methods (name, kind, sort_order)
VALUES
  ('cash', 'cash', 10),
  ('check', 'check', 20),
  ('unknown', 'other', 90)
ON CONFLICT (LOWER(name)) DO NOTHING;

-- 3) Accounting view used by spending reports and the balance sheet.
-- Every active receipt is one accounting line. The balance section follows the
-- category's accounting_type so the figures roll up into standard buckets.
CREATE OR REPLACE VIEW v_receipt_accounting AS
SELECT
  r.id AS receipt_id,
  r.receipt_date,
  r.worker_id,
  r.worker_name,
  r.project_id,
  r.project_name,
  r.store,
  r.category_id,
  r.category_name,
  r.category_group,
  r.category_type,
  r.account_id,
  r.account_code,
  r.account_name,
  r.accounting_type,
  COALESCE(NULLIF(TRIM(r.payment_method), ''), 'unknown') AS payment_method,
  COALESCE(r.subtotal, 0) AS subtotal,
  COALESCE(r.tax, 0) AS tax,
  COALESCE(r.total, 0) AS total,
  CASE
    WHEN r.accounting_type IN ('Current Asset', 'Fixed Asset') THEN 'Assets'
    WHEN r.accounting_type IN ('Liability', 'Liability Reduction') THEN 'Liabilities'
    WHEN r.accounting_type = 'Equity' THEN 'Equity'
    WHEN r.accounting_type IN ('Cost of Goods Sold', 'Operating Expense') THEN 'Expenses'
    WHEN r.accounting_type IN ('Operating Income', 'Other Income') THEN 'Income'
    ELSE 'Unclassified'
  END AS balance_section
FROM receipts r
WHERE r.active = TRUE;
