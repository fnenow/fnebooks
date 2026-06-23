# FNEBooks v1.2 Reviewed Starter

FNEBooks is a Node.js, Express, and PostgreSQL bookkeeping receipt app designed to share the existing FNEClock `workers` and `projects` tables.

## Included

- Worker receipt image/PDF upload, including many JPGs at once and PDFs that
  contain several receipts (one receipt record is created per detected receipt)
- Spending and accounting balance-sheet reports, broken down by section,
  account, payment method, and month (Balance Sheet page)
- Managed payment methods (add / rename / deactivate / delete) with a picker on
  the upload and receipt-edit forms and inline payment-method change on the
  receipts list
- Receipt soft deactivation that also deactivates the receipt's line items, so
  spending and balance-sheet totals stay correct
- Temporary protected worker upload login
- Admin login stored in PostgreSQL sessions
- Receipts admin page with filters, Group By, CSV export, full correction form, Follow Up, file viewing, and soft deactivation
- Receipt Items page with filters, Group By, CSV export, and item correction form
- AI-friendly category master from the supplied workbook:
  - 53 expense categories
  - 16 income categories
- Chart of Accounts:
  - 69 seeded accounts linked to the workbook categories
  - Date-effective account-code rules
  - Automatic next-code generation for new categories/accounts
  - Account review status and created-date filters
  - Updating an account refreshes related receipt and item account snapshots
- Settings table and admin page
- Recent or most-used-this-month project/category defaults by worker
- Worker-added categories automatically placed under Review Required

## Important design rules

- Receipt upload uses expense categories only. Income categories are ready for a future income module.
- A project is only treated as missing when the selected category has `project_required = Yes`.
- Payment method is reserved for AI extraction. Card payments should store only the final four digits.
- `follow_up` is admin-managed and limited to `reimburse` or `collect`.
- Corrections set `corrected = true`; there is no correction-history table.
- Reports are provided through filters and Group By rather than a separate Reports page.
- Account codes are stored as text. The seeded rules use four digits, but the schema supports other lengths.

## Security changes in this reviewed version

- Secrets are required from environment variables; no production fallback secret is used.
- Worker upload is protected by `WORKER_UPLOAD_PASSWORD` unless `ALLOW_PUBLIC_UPLOAD=true` is explicitly set.
- Permissive CORS was removed because the app uses same-origin pages and APIs.
- Login attempts are rate-limited in memory.
- Password comparison uses constant-time comparison.
- Receipt files are limited to one file, 15 MB, and supported image/PDF MIME types.
- CSV exports protect against spreadsheet formula injection.
- Common security headers are added.

The shared worker password is only a temporary bridge. Replace it with the existing FNEClock worker session/login when that interface is ready.

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
ADMIN_PASSWORD=your-admin-password
WORKER_UPLOAD_PASSWORD=your-worker-upload-password
SESSION_SECRET=use-at-least-32-random-characters
ALLOW_PUBLIC_UPLOAD=false
NODE_ENV=development
PORT=3000
PG_POOL_MAX=10
```

Do not commit `.env`.

## Database setup

### Fresh database

Run only:

```bash
psql "$DATABASE_URL" -f migrations/001_fnebooks_schema.sql
```

Then run the receipt-processing and reporting additions:

```bash
psql "$DATABASE_URL" -f migrations/006_receipt_processing_updates.sql
psql "$DATABASE_URL" -f migrations/007_spending_balance_payment_methods.sql
```

The fresh migration creates the FNEBooks tables, category master, Chart of Accounts, account-code rules, and settings. It creates fallback `workers` and `projects` tables only when those FNEClock tables do not already exist. Migration 007 adds the managed payment methods, receipt-item deactivation, and the balance-sheet view.

### Upgrade from the original v1.0 starter

```bash
psql "$DATABASE_URL" -f migrations/002_ai_friendly_categories.sql
psql "$DATABASE_URL" -f migrations/003_chart_of_accounts.sql
```

### Upgrade from v1.1 AI categories

```bash
psql "$DATABASE_URL" -f migrations/003_chart_of_accounts.sql
```

Migrations are written to be safe to rerun, but always make a database backup before changing a production database.

## Validate and start

```bash
npm test
npm start
```

Pages:

- `/upload-login.html` — temporary worker upload login
- `/upload_receipt.html` — receipt upload
- `/login.html` — admin login
- `/receipts.html` — receipt administration
- `/receipt_items.html` — receipt-item administration
- `/balance_sheet.html` — spending and accounting balance sheet
- `/categories.html` — category administration
- `/accounts.html` — Chart of Accounts and code rules
- `/payment_methods.html` — manage payment methods
- `/settings.html` — settings
- `/health` — app and database health check

## Railway variables

Set these in the FNEBooks service Variables tab:

```text
DATABASE_URL=public PostgreSQL URL when the database remains in the separate FNEClock Railway project
ADMIN_PASSWORD=strong admin password
WORKER_UPLOAD_PASSWORD=strong shared worker upload password
SESSION_SECRET=long random value of at least 32 characters
ALLOW_PUBLIC_UPLOAD=false
NODE_ENV=production
PG_POOL_MAX=10
```

Start command:

```bash
npm start
```

## Current limits

- AI receipt reading and payment-method extraction require a `GEMINI_API_KEY`.
  Without it, uploads are still saved and each file becomes one receipt entered
  from the form fields.
- FNEClock worker authentication is not connected yet.
- Income categories and accounts exist, but the income transaction page/table is not built.
- Receipt files are stored in PostgreSQL for the first version; object storage should be considered as volume grows.
- Account-code rules can be viewed but not edited in the current UI; they can be maintained through SQL until a rules editor is added.

## Reference files

- `reference/FNEBooks_Categories_AI_Friendly_Expense_Income.xlsx`
- `data/category_master.json`
- `data/chart_accounts_seed.json`
- `data/category_seed.sql`


## v1.2.2 session-table fix

FNEBooks uses a dedicated `user_sessions` table. If an older deployment shows `relation "session_pkey" already exists` after login, update the code to v1.2.2 and run:

```bash
psql "$DATABASE_URL" -f migrations/004_session_table_fix.sql
```

This avoids conflicts with another app using a generic `session` table in the shared PostgreSQL database.

## v1.3.0 batch upload, balance sheet, and payment methods

Run `migrations/007_spending_balance_payment_methods.sql` after upgrading.

- Upload many JPGs in one submission, and upload a PDF that contains several
  receipts. Each detected receipt becomes its own receipt record. This also
  fixes the `invalid input syntax for type json` error that happened when the
  AI returned more than one receipt for a file (a top-level JSON array was being
  stored into a JSONB column as a Postgres array literal).
- New Balance Sheet page with spending and accounting totals by section,
  account, payment method, and month. Totals are computed from active receipts,
  so recording, editing, deactivating, deleting, or changing a payment method
  updates them immediately.
- Manage payment methods (add, rename, deactivate, delete). Renaming keeps
  existing receipts in sync. The upload and edit forms use the managed list, and
  the payment method can be changed inline on the receipts list.
- Deactivating a receipt now also deactivates its line items, and deactivated
  receipts/items are excluded from reports until reactivated.
- Fixed a date-handling bug where editing a receipt without changing its date
  (for example the inline Follow Up or payment-method change) could fail format
  validation because PostgreSQL returns dates as objects.
