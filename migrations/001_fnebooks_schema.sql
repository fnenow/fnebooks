-- FNEBooks initial database setup
-- Safe to run more than once.

-- Existing FNEClock tables are expected to exist.
-- These fallback tables are only for a fresh standalone test database.
CREATE TABLE IF NOT EXISTS workers (
  worker_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  receipt_number TEXT,
  receipt_date DATE,
  worker_id INTEGER,
  worker_name TEXT,
  store TEXT,
  project_id INTEGER,
  project_name TEXT,
  category_id INTEGER REFERENCES categories(id),
  category_name TEXT,
  subtotal NUMERIC(12,2),
  tax NUMERIC(12,2),
  total NUMERIC(12,2),
  payment_method TEXT,
  follow_up TEXT CHECK (follow_up IN ('reimburse', 'collect') OR follow_up IS NULL),
  note TEXT,
  source_file_name TEXT,
  source_mime_type TEXT,
  ai_confidence NUMERIC(5,2),
  missing_info BOOLEAN DEFAULT FALSE,
  corrected BOOLEAN DEFAULT FALSE,
  correction_note TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receipt_items (
  item_id SERIAL PRIMARY KEY,
  receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE,
  receipt_number TEXT,
  receipt_date DATE,
  store TEXT,
  worker_id INTEGER,
  worker_name TEXT,
  product_name TEXT,
  product_code TEXT,
  quantity NUMERIC(12,3),
  unit_price NUMERIC(12,2),
  item_total NUMERIC(12,2),
  project_id INTEGER,
  project_name TEXT,
  category_id INTEGER REFERENCES categories(id),
  category_name TEXT,
  corrected BOOLEAN DEFAULT FALSE,
  correction_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store original receipt photo/PDF in Postgres for the first version.
-- Later this can move to S3/Supabase/Railway volume using app_settings.
CREATE TABLE IF NOT EXISTS receipt_files (
  receipt_id INTEGER PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE,
  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  file_data BYTEA,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  setting_type TEXT DEFAULT 'text',
  description TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO categories (name, active)
VALUES
  ('Material', TRUE),
  ('Tool', TRUE),
  ('Fuel', TRUE),
  ('Office', TRUE),
  ('Other', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO app_settings (setting_key, setting_value, setting_type, description, updated_by)
VALUES
  ('receipt_storage', 'postgres', 'text', 'Where uploaded receipt files are stored: postgres now; later s3/supabase/railway_volume.', 'system'),
  ('ai_extraction_enabled', 'false', 'boolean', 'Turn AI receipt extraction on/off.', 'system'),
  ('ai_confidence_threshold', '0.80', 'number', 'Minimum AI confidence before record is considered clean.', 'system'),
  ('default_project_rule', 'recently_used', 'text', 'How upload page pre-fills project: recently_used or most_used_this_month.', 'system'),
  ('default_category_rule', 'recently_used', 'text', 'How upload page pre-fills category.', 'system'),
  ('receipt_number_rule', 'manual_or_ai', 'text', 'Receipt number can be entered manually or filled by AI later.', 'system'),
  ('company_name', 'FNE Services Inc.', 'text', 'Company name for exports/reports.', 'system'),
  ('payment_method_rule', 'ai_text_last4_only', 'text', 'Payment method stores only AI-read text, card last 4 only, cash, check, or unknown.', 'system'),
  ('follow_up_allowed_options', 'reimburse,collect', 'text', 'Allowed follow up values.', 'system'),
  ('missing_info_rule', 'missing receipt_date/store/worker/project/category/total', 'text', 'Rule used to flag missing info.', 'system')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipts_worker ON receipts(worker_id);
CREATE INDEX IF NOT EXISTS idx_receipts_project ON receipts(project_id);
CREATE INDEX IF NOT EXISTS idx_receipts_follow_up ON receipts(follow_up);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_date ON receipt_items(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipt_items_project ON receipt_items(project_id);
