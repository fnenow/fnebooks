# Review Notes — v1.2

## Corrected

- Replaced unpinned `latest` dependencies with exact versions and added `package-lock.json`.
- Removed unnecessary permissive CORS.
- Removed fallback production session secret and added environment validation.
- Added temporary protected worker upload login.
- Added login-attempt limiting and constant-time password comparison.
- Added supported receipt MIME validation, one-file limit, 15 MB limit, and safe filenames.
- Fixed transaction paths so validation failures roll back before releasing PostgreSQL clients.
- Changed receipt and item corrections so fields can be intentionally cleared instead of being blocked by `COALESCE`.
- Added admin edit forms for receipts and receipt items.
- Added worker-created categories routed to Review Required.
- Added recent/most-used monthly default project and category selection.
- Added CSV formula-injection protection.
- Corrected missing-project logic to depend on the category's Project Required value.

## Added

- `chart_accounts` table with 69 workbook-linked accounts.
- `account_code_rules` with date-effective ranges and next-code values.
- Automatic account-code generation for new categories/accounts.
- Created-date/source/review filters for newly generated accounts.
- Account edits refresh related receipt and receipt-item snapshots.
- Accounts administration page.
- Account filters and Group By on receipts and receipt items.
- Health check that verifies database access.

## Still pending

- AI receipt extraction and payment-method extraction.
- Direct FNEClock worker session integration.
- Multi-receipt AI batch processing.
- Income transaction tables/pages.
- Object storage migration for receipt files.
- Admin UI to edit account-code rules.


## v1.2.2 fix

- Disabled connect-pg-simple automatic session-table creation.
- Added explicit `user_sessions` table migration with non-conflicting primary key/index names.
- Fixes shared-database error: `relation "session_pkey" already exists`.
