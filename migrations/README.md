# FNEBooks migrations

These are plain SQL files applied by hand (psql / Railway query console). Every
file is idempotent — safe to run more than once (`IF NOT EXISTS`, `ON CONFLICT`).

## Fresh install

Run **`001_fnebooks_schema.sql` only.** It is the canonical, self-contained
schema: base tables, the full AI-friendly category seed, the chart of accounts,
account-code rules, and receipt storage. It already contains everything in
migrations 002 and 003.

Then run the receipt-processing additions:

- `006_receipt_processing_updates.sql` — `receipt_uploads` table plus the
  AI / Google Drive columns on `receipts` and `receipt_items`.

That is enough for a brand-new database.

## Upgrade-only history (do NOT run on a fresh install)

These exist only to bring an older partial database up to the current shape.
They overlap with `001` and are kept for traceability:

| File | Folded into | Purpose |
|------|-------------|---------|
| `002_ai_friendly_categories.sql` | `001` | Adds AI-friendly category columns + seed to a pre-1.2 DB. |
| `003_chart_of_accounts.sql`      | `001` | Adds `chart_accounts` / `account_code_rules` to a pre-1.2 DB. |
| `004_session_table_fix.sql`      | —     | Only if admin login fails with `relation "session_pkey" already exists`. |
| `005_receipt_processing.sql`     | `006` | Earlier `receipt_uploads` shape; superseded by `006`. |

If you run the upgrade files in numeric order on top of `001`, nothing breaks —
they simply no-op where the objects already exist.
