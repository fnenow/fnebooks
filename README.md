# FNEBooks Starter

This is the first working setup for the FNE bookkeeping receipt app.

## What this version includes

- PostgreSQL tables:
  - `receipts`
  - `receipt_items`
  - `categories`
  - `receipt_files`
  - `app_settings`
- Uses existing FNEClock tables when available:
  - `workers`
  - `projects`
- Admin login saved for 1 month unless logout.
- Receipt upload page.
- Receipts admin page with filters, CSV export, inline Follow Up update, and Group By.
- Receipt Items admin page with filters, CSV export, and Group By.
- Category page: id, name, active, action.
- Settings page placeholder ready for future functions.

## Install locally or in GitHub Codespaces

```bash
npm install
cp .env.example .env
```

Edit `.env` and add your Railway PostgreSQL `DATABASE_URL`, `ADMIN_PASSWORD`, and `SESSION_SECRET`.

## Run database setup

Use Railway shell, psql, TablePlus, or Codespaces terminal:

```bash
psql "$DATABASE_URL" -f migrations/001_fnebooks_schema.sql
```

If `psql` is not installed, open Railway PostgreSQL Query tab and paste the SQL file content there.

## Start the app

```bash
npm start
```

Open:

- `/login.html` for admin login
- `/upload_receipt.html` for receipt upload
- `/receipts.html` for receipt admin
- `/receipt_items.html` for receipt item admin
- `/categories.html` for categories
- `/settings.html` for settings

## Railway deployment

Set these Railway variables:

```text
DATABASE_URL=your Railway PostgreSQL URL
ADMIN_PASSWORD=your admin password
SESSION_SECRET=long random text
NODE_ENV=production
```

Railway start command:

```bash
npm start
```

## Important design notes

- `payment_method` stores only the payment text read by AI or entered by user.
- For card payments, store only the last 4 digits, for example `1234`.
- `follow_up` has only two choices: `reimburse` or `collect`.
- Records become active immediately.
- Admin corrections are marked with `corrected = true`; there is no correction history table.
- Reports are handled through filters plus `Group By`; there is no separate Reports page.
