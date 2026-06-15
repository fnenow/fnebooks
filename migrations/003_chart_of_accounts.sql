-- FNEBooks v1.2 Chart of Accounts and account-code rules upgrade.
-- Run after migration 001/002 when upgrading an existing v1.1 database.

CREATE TABLE IF NOT EXISTS account_code_rules (
  id SERIAL PRIMARY KEY,
  transaction_kind TEXT NOT NULL CHECK (transaction_kind IN ('expense', 'income')),
  accounting_type TEXT NOT NULL,
  code_start INTEGER NOT NULL,
  code_end INTEGER NOT NULL,
  next_code INTEGER NOT NULL,
  increment_by INTEGER NOT NULL DEFAULT 10 CHECK (increment_by > 0),
  code_length INTEGER NOT NULL DEFAULT 4 CHECK (code_length BETWEEN 1 AND 12),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (code_start <= code_end),
  CHECK (next_code >= code_start),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_code_rules_effective
ON account_code_rules(transaction_kind, accounting_type, effective_from);

CREATE TABLE IF NOT EXISTS chart_accounts (
  id SERIAL PRIMARY KEY,
  account_code TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  transaction_kind TEXT NOT NULL CHECK (transaction_kind IN ('expense', 'income')),
  accounting_type TEXT NOT NULL,
  parent_account_id INTEGER REFERENCES chart_accounts(id),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'workbook', 'ai', 'admin')),
  review_status TEXT NOT NULL DEFAULT 'new' CHECK (review_status IN ('new', 'approved', 'needs_review', 'inactive')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES chart_accounts(id);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES chart_accounts(id);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS account_code TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS account_name TEXT;
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES chart_accounts(id);
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS account_code TEXT;
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS account_name TEXT;

INSERT INTO chart_accounts (
  account_code, account_name, transaction_kind, accounting_type,
  normal_balance, source, review_status, active
)
VALUES
  ('5010', 'Electrical & Lighting Materials', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5020', 'Low-Voltage & System Materials', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5030', 'General Construction Materials', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5040', 'Hardware & Consumables', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5050', 'Safety Materials & PPE', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5060', 'Other Project Materials', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5070', 'Employee Labor', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5080', 'Temporary Labor', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5090', 'Subcontractor Service', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5100', 'Engineering, Testing & Inspection', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5110', 'Equipment Rental', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5120', 'Tools & Equipment', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5130', 'Project Repair & Maintenance', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5140', 'Permits, Inspections & Government Fees', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5150', 'Temporary Site Services', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5160', 'Cleanup, Waste & Disposal', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5170', 'Delivery, Freight & Shipping', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5180', 'Plans, Printing & Documentation', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5190', 'Project Transportation & Travel', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5200', 'Project Meals', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5210', 'Project Insurance & Bonds', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5220', 'Warranty & Correction Cost', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('5230', 'Other Project Expense', 'expense', 'Cost of Goods Sold', 'debit', 'workbook', 'approved', TRUE),
  ('6010', 'Vehicle Fuel', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6020', 'Vehicle Repair & Maintenance', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6030', 'Vehicle Registration, Lease & Insurance', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6040', 'Vehicle Parking & Tolls', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6050', 'Office Supplies & Printing', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6060', 'Rent, Storage & Utilities', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6070', 'Facility Repair & Security', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6080', 'Software & Subscriptions', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6090', 'Phone, Internet & IT', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6100', 'Business Insurance', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6110', 'Employee Benefits & Workforce Expense', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6120', 'Accounting, Legal & Consulting', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6130', 'Licenses, Certifications & Filing Fees', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6140', 'Payroll & Business Taxes', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6150', 'Bank, Merchant & Interest Fees', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6160', 'Marketing, Sales & Bid Expense', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6170', 'Training, Education & Safety', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6180', 'Business Meals & Employee Events', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6190', 'Tools, Equipment & Facility Maintenance', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6200', 'Dues & Memberships', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('6210', 'Bad Debt & Other Overhead', 'expense', 'Operating Expense', 'debit', 'workbook', 'approved', TRUE),
  ('1500', 'Asset Purchase', 'expense', 'Fixed Asset', 'debit', 'workbook', 'approved', TRUE),
  ('1100', 'Inventory Purchase', 'expense', 'Current Asset', 'debit', 'workbook', 'approved', TRUE),
  ('1110', 'Prepaid Expense or Deposit', 'expense', 'Current Asset', 'debit', 'workbook', 'approved', TRUE),
  ('2100', 'Loan or Credit Card Payment', 'expense', 'Liability Reduction', 'credit', 'workbook', 'approved', TRUE),
  ('2110', 'Sales Tax or Government Payment', 'expense', 'Liability Reduction', 'credit', 'workbook', 'approved', TRUE),
  ('3100', 'Owner Draw or Contribution', 'expense', 'Equity', 'credit', 'workbook', 'approved', TRUE),
  ('1120', 'Employee Advance', 'expense', 'Current Asset', 'debit', 'workbook', 'approved', TRUE),
  ('9900', 'Charitable Contribution - Review', 'expense', 'Review Required', 'debit', 'workbook', 'approved', TRUE),
  ('9910', 'Uncategorized - Review Required', 'expense', 'Review Required', 'debit', 'workbook', 'approved', TRUE),
  ('4000', 'Contract & Project Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4010', 'Service & Repair Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4020', 'Maintenance, Inspection & Testing Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4030', 'Design & Project Management Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4040', 'Change Order Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4050', 'Material & Equipment Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4060', 'Customer Reimbursement Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('4070', 'Other Project Income', 'income', 'Operating Income', 'credit', 'workbook', 'approved', TRUE),
  ('8000', 'Other Business Income', 'income', 'Other Income', 'credit', 'workbook', 'approved', TRUE),
  ('8010', 'Interest Income', 'income', 'Other Income', 'credit', 'workbook', 'approved', TRUE),
  ('9950', 'Insurance or Asset Sale Proceeds - Review', 'income', 'Review Required', 'credit', 'workbook', 'approved', TRUE),
  ('2000', 'Customer Deposit / Unearned Revenue', 'income', 'Liability', 'credit', 'workbook', 'approved', TRUE),
  ('3000', 'Owner Contribution', 'income', 'Equity', 'credit', 'workbook', 'approved', TRUE),
  ('2010', 'Loan Proceeds', 'income', 'Liability', 'credit', 'workbook', 'approved', TRUE),
  ('2020', 'Sales Tax Collected', 'income', 'Liability', 'credit', 'workbook', 'approved', TRUE),
  ('9960', 'Uncategorized Income - Review Required', 'income', 'Review Required', 'credit', 'workbook', 'approved', TRUE)
ON CONFLICT (account_code) DO UPDATE SET
  account_name = EXCLUDED.account_name,
  transaction_kind = EXCLUDED.transaction_kind,
  accounting_type = EXCLUDED.accounting_type,
  normal_balance = EXCLUDED.normal_balance,
  source = EXCLUDED.source,
  active = EXCLUDED.active,
  updated_at = NOW();

UPDATE categories c
SET account_id = a.id,
    updated_at = NOW()
FROM chart_accounts a
WHERE a.transaction_kind = c.transaction_kind
  AND a.accounting_type = c.accounting_type
  AND a.account_name = c.detail_category
  AND (c.account_id IS NULL OR c.account_id <> a.id);

UPDATE receipts r
SET account_id = a.id,
    account_code = a.account_code,
    account_name = a.account_name,
    updated_at = NOW()
FROM categories c
JOIN chart_accounts a ON a.id = c.account_id
WHERE r.category_id = c.id
  AND (r.account_id IS DISTINCT FROM a.id
       OR r.account_code IS DISTINCT FROM a.account_code
       OR r.account_name IS DISTINCT FROM a.account_name);

UPDATE receipt_items i
SET account_id = a.id,
    account_code = a.account_code,
    account_name = a.account_name,
    updated_at = NOW()
FROM categories c
JOIN chart_accounts a ON a.id = c.account_id
WHERE i.category_id = c.id
  AND (i.account_id IS DISTINCT FROM a.id
       OR i.account_code IS DISTINCT FROM a.account_code
       OR i.account_name IS DISTINCT FROM a.account_name);

INSERT INTO account_code_rules (
  transaction_kind, accounting_type, code_start, code_end, next_code,
  increment_by, code_length, effective_from, active
)
VALUES
  ('expense', 'Current Asset', 1100, 1399, 1130, 10, 4, DATE '2026-01-01', TRUE),
  ('expense', 'Fixed Asset', 1500, 1899, 1510, 10, 4, DATE '2026-01-01', TRUE),
  ('expense', 'Liability Reduction', 2100, 2299, 2120, 10, 4, DATE '2026-01-01', TRUE),
  ('expense', 'Equity', 3100, 3299, 3110, 10, 4, DATE '2026-01-01', TRUE),
  ('expense', 'Cost of Goods Sold', 5000, 5999, 5240, 10, 4, DATE '2026-01-01', TRUE),
  ('expense', 'Operating Expense', 6000, 6999, 6220, 10, 4, DATE '2026-01-01', TRUE),
  ('expense', 'Review Required', 9900, 9949, 9920, 10, 4, DATE '2026-01-01', TRUE),
  ('income', 'Liability', 2000, 2099, 2030, 10, 4, DATE '2026-01-01', TRUE),
  ('income', 'Equity', 3000, 3099, 3010, 10, 4, DATE '2026-01-01', TRUE),
  ('income', 'Operating Income', 4000, 4499, 4080, 10, 4, DATE '2026-01-01', TRUE),
  ('income', 'Other Income', 8000, 8499, 8020, 10, 4, DATE '2026-01-01', TRUE),
  ('income', 'Review Required', 9950, 9999, 9970, 10, 4, DATE '2026-01-01', TRUE)
ON CONFLICT (transaction_kind, accounting_type, effective_from)
DO UPDATE SET
  code_start = EXCLUDED.code_start,
  code_end = EXCLUDED.code_end,
  next_code = GREATEST(account_code_rules.next_code, EXCLUDED.next_code),
  increment_by = EXCLUDED.increment_by,
  code_length = EXCLUDED.code_length,
  active = EXCLUDED.active,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_chart_accounts_kind_type ON chart_accounts(transaction_kind, accounting_type);
CREATE INDEX IF NOT EXISTS idx_chart_accounts_created ON chart_accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_chart_accounts_review ON chart_accounts(review_status, active);
CREATE INDEX IF NOT EXISTS idx_categories_account ON categories(account_id);
CREATE INDEX IF NOT EXISTS idx_receipts_account ON receipts(account_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_account ON receipt_items(account_id);

INSERT INTO app_settings (setting_key, setting_value, setting_type, description, updated_by)
VALUES
  ('account_auto_generation_enabled', 'true', 'boolean', 'Allow the system or AI to create the next account code using active date-effective rules.', 'system'),
  ('new_account_review_status', 'new', 'text', 'Review status assigned to system-generated accounts.', 'system'),
  ('worker_auth_mode', 'shared_password_temporary', 'text', 'Temporary worker upload authentication until FNEClock session integration is connected.', 'system'),
  ('receipt_file_required_for_worker', 'true', 'boolean', 'Workers must include a receipt image or PDF; admins may create a manual record.', 'system')
ON CONFLICT (setting_key) DO NOTHING;


UPDATE app_settings
SET setting_value = 'missing receipt_date/store/worker/category/total; project only when selected category requires project',
    description = 'Rule used to flag missing receipt information with category-based project requirements.',
    updated_at = NOW()
WHERE setting_key = 'missing_info_rule';

