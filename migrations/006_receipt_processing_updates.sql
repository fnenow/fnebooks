
-- Receipt processing compatibility updates
-- Safe to run more than once.

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

<<<<<<< HEAD
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_status_created
ON receipt_uploads(ai_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipts_upload_id
ON receipts(upload_id);

CREATE INDEX IF NOT EXISTS idx_receipt_items_upload_id
ON receipt_items(upload_id);
=======
>>>>>>> 2209a6b (ok)
