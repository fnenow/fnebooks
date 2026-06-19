-- Receipt processing compatibility updates
-- Safe to run more than once.

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
    CHECK (ai_status IN ('uploaded','processing','processed','needs_review','ai_failed','db_failed')),
  ai_confidence NUMERIC(5,2),
  ai_raw_json JSONB,
  error_message TEXT,
  receipt_id INTEGER,
  original_file_size INTEGER,
  compressed_file_size INTEGER,
  compression_quality INTEGER DEFAULT 75,
  image_width INTEGER,
  image_height INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE receipt_uploads
ADD COLUMN IF NOT EXISTS original_file_size INTEGER,
ADD COLUMN IF NOT EXISTS compressed_file_size INTEGER,
ADD COLUMN IF NOT EXISTS compression_quality INTEGER DEFAULT 75,
ADD COLUMN IF NOT EXISTS image_width INTEGER,
ADD COLUMN IF NOT EXISTS image_height INTEGER;

ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES receipt_uploads(id),
ADD COLUMN IF NOT EXISTS ai_provider TEXT,
ADD COLUMN IF NOT EXISTS ai_model TEXT,
ADD COLUMN IF NOT EXISTS ai_raw_json JSONB,
ADD COLUMN IF NOT EXISTS google_drive_file_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_web_view_link TEXT;

ALTER TABLE receipt_items
ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES receipt_uploads(id);

CREATE INDEX IF NOT EXISTS idx_receipt_uploads_status_created
ON receipt_uploads(ai_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipts_upload_id
ON receipts(upload_id);

CREATE INDEX IF NOT EXISTS idx_receipt_items_upload_id
ON receipt_items(upload_id);
