-- UPGRADE-ONLY. Superseded by 006_receipt_processing_updates.sql; on a fresh
-- install run 006 instead. See migrations/README.md.
CREATE TABLE IF NOT EXISTS receipt_uploads (
  id SERIAL PRIMARY KEY,

  worker_id INTEGER,
  project_id INTEGER,

  original_filename TEXT,
  stored_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,

  google_drive_file_id TEXT,
  google_drive_web_view_link TEXT,

  ai_provider TEXT,
  ai_model TEXT,
  ai_status TEXT DEFAULT 'uploaded'
    CHECK (ai_status IN (
      'uploaded',
      'processing',
      'processed',
      'needs_review',
      'ai_failed',
      'db_failed'
    )),

  ai_confidence NUMERIC(5,2),
  ai_raw_json JSONB,
  error_message TEXT,

  receipt_id INTEGER,

  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES receipt_uploads(id),
ADD COLUMN IF NOT EXISTS ai_provider TEXT,
ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS ai_raw_json JSONB,
ADD COLUMN IF NOT EXISTS google_drive_file_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_web_view_link TEXT;

ALTER TABLE receipt_items
ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES receipt_uploads(id);
