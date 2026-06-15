-- FNEBooks initial database setup
-- Fresh install: run this file once.
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
  transaction_kind TEXT NOT NULL DEFAULT 'expense',
  type_name TEXT NOT NULL DEFAULT 'User Added',
  general_category TEXT NOT NULL DEFAULT 'Other',
  detail_category TEXT NOT NULL,
  name TEXT NOT NULL,
  accounting_type TEXT NOT NULL DEFAULT 'Review Required',
  project_type_applicability TEXT NOT NULL DEFAULT 'All Project Types',
  project_required TEXT NOT NULL DEFAULT 'Optional',
  ai_handling TEXT NOT NULL DEFAULT 'Prefill & Review',
  ai_clues TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  sort_order INTEGER DEFAULT 9999,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Make a fresh or earlier starter database compatible with the full category model.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS transaction_kind TEXT DEFAULT 'expense';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS type_name TEXT DEFAULT 'User Added';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS general_category TEXT DEFAULT 'Other';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS detail_category TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS accounting_type TEXT DEFAULT 'Review Required';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS project_type_applicability TEXT DEFAULT 'All Project Types';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS project_required TEXT DEFAULT 'Optional';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS ai_handling TEXT DEFAULT 'Prefill & Review';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS ai_clues TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'system';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 9999;

UPDATE categories
SET
  transaction_kind = COALESCE(transaction_kind, 'expense'),
  type_name = COALESCE(type_name, 'User Added'),
  general_category = COALESCE(general_category, 'Other'),
  detail_category = COALESCE(detail_category, name),
  accounting_type = COALESCE(accounting_type, 'Review Required'),
  project_type_applicability = COALESCE(project_type_applicability, 'All Project Types'),
  project_required = COALESCE(project_required, 'Optional'),
  ai_handling = COALESCE(ai_handling, 'Prefill & Review'),
  source = COALESCE(source, 'system'),
  sort_order = COALESCE(sort_order, 9999);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_hierarchy
ON categories(transaction_kind, type_name, general_category, detail_category);

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
  category_group TEXT,
  category_type TEXT,
  accounting_type TEXT,
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
  category_group TEXT,
  category_type TEXT,
  accounting_type TEXT,
  corrected BOOLEAN DEFAULT FALSE,
  correction_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add category hierarchy snapshots when upgrading an earlier starter database.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS category_group TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS category_type TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS accounting_type TEXT;

ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS category_group TEXT;
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS category_type TEXT;
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS accounting_type TEXT;

-- Store original receipt photo/PDF in PostgreSQL for the first version.
-- Later this can move to object storage or a Railway volume using app_settings.
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

UPDATE categories
SET active = FALSE, updated_at = NOW()
WHERE source = 'system'
  AND type_name = 'User Added'
  AND general_category = 'Other'
  AND name IN ('Material', 'Tool', 'Fuel', 'Office', 'Other');

INSERT INTO categories (
  transaction_kind, type_name, general_category, detail_category, name,
  accounting_type, project_type_applicability, project_required,
  ai_handling, ai_clues, source, sort_order, active
)
VALUES
  ('expense', 'Direct Project Cost', 'Materials', 'Electrical & Lighting Materials', 'Electrical & Lighting Materials', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Electrical supply receipts; wire, conduit, fittings, breakers, panels, transformers, fixtures, controls, switches, receptacles, boxes.', 'workbook', 1, TRUE),
  ('expense', 'Direct Project Cost', 'Materials', 'Low-Voltage & System Materials', 'Low-Voltage & System Materials', 'Cost of Goods Sold', 'Low-Voltage Related', 'Yes', 'Auto', 'Fire alarm, nurse call, access control, camera/CCTV, data, communication, smart-home, controls, modules, devices, batteries, cable.', 'workbook', 2, TRUE),
  ('expense', 'Direct Project Cost', 'Materials', 'General Construction Materials', 'General Construction Materials', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Lumber, drywall, concrete, paint, plumbing, HVAC, roofing, doors, patching, and general building materials.', 'workbook', 3, TRUE),
  ('expense', 'Direct Project Cost', 'Materials', 'Hardware & Consumables', 'Hardware & Consumables', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Fasteners, anchors, screws, brackets, tape, labels, sealant, connectors, blades, drill bits, and disposable supplies.', 'workbook', 4, TRUE),
  ('expense', 'Direct Project Cost', 'Materials', 'Safety Materials & PPE', 'Safety Materials & PPE', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Safety glasses, gloves, helmets, vests, barriers, warning signs, fall protection, and project-specific PPE.', 'workbook', 5, TRUE),
  ('expense', 'Direct Project Cost', 'Materials', 'Other Project Materials', 'Other Project Materials', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Project materials that do not clearly fit another material category.', 'workbook', 6, TRUE),
  ('expense', 'Direct Project Cost', 'Labor', 'Employee Labor', 'Employee Labor', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Manual Review', 'Payroll, timesheet, or labor report; combines regular, overtime, prevailing wage, foreman, supervisor, and project-management labor.', 'workbook', 7, TRUE),
  ('expense', 'Direct Project Cost', 'Labor', 'Temporary Labor', 'Temporary Labor', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Staffing-agency or temporary-labor invoice tied to a project.', 'workbook', 8, TRUE),
  ('expense', 'Direct Project Cost', 'Subcontractors', 'Subcontractor Service', 'Subcontractor Service', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Any outside contractor invoice, regardless of trade: electrical, low-voltage, fire alarm, general construction, or other subcontractor.', 'workbook', 9, TRUE),
  ('expense', 'Direct Project Cost', 'Professional Services', 'Engineering, Testing & Inspection', 'Engineering, Testing & Inspection', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Engineer, designer, consultant, commissioning, testing, certification, inspection, or laboratory invoice tied to a project.', 'workbook', 10, TRUE),
  ('expense', 'Direct Project Cost', 'Equipment & Tools', 'Equipment Rental', 'Equipment Rental', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Rental invoice for lift, scissor lift, boom lift, generator, excavator, test equipment, or other job equipment.', 'workbook', 11, TRUE),
  ('expense', 'Direct Project Cost', 'Equipment & Tools', 'Tools & Equipment', 'Tools & Equipment', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Small tools, project-specific equipment, batteries, chargers, cases, and tool accessories.', 'workbook', 12, TRUE),
  ('expense', 'Direct Project Cost', 'Repair & Maintenance', 'Project Repair & Maintenance', 'Project Repair & Maintenance', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Repair or maintenance of tools and equipment clearly connected to a specific project.', 'workbook', 13, TRUE),
  ('expense', 'Direct Project Cost', 'Permits & Fees', 'Permits, Inspections & Government Fees', 'Permits, Inspections & Government Fees', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'City, county, fire department, HCAI, permit, plan review, inspection, certification, or other project government fee.', 'workbook', 14, TRUE),
  ('expense', 'Direct Project Cost', 'Job-Site Operations', 'Temporary Site Services', 'Temporary Site Services', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Temporary power, lighting, storage, fencing, portable toilet, job-site office, or temporary security.', 'workbook', 15, TRUE),
  ('expense', 'Direct Project Cost', 'Job-Site Operations', 'Cleanup, Waste & Disposal', 'Cleanup, Waste & Disposal', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Cleanup, janitorial service, dumpster, hauling, recycling, landfill, and disposal fees.', 'workbook', 16, TRUE),
  ('expense', 'Direct Project Cost', 'Logistics', 'Delivery, Freight & Shipping', 'Delivery, Freight & Shipping', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Freight, courier, shipping, delivery, mobilization, and transportation charges for project materials or equipment.', 'workbook', 17, TRUE),
  ('expense', 'Direct Project Cost', 'Documentation', 'Plans, Printing & Documentation', 'Plans, Printing & Documentation', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Auto', 'Blueprints, plan sets, drawing reproduction, project printing, labels, scanning, and document services.', 'workbook', 18, TRUE),
  ('expense', 'Direct Project Cost', 'Travel & Transportation', 'Project Transportation & Travel', 'Project Transportation & Travel', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Project fuel, parking, tolls, airfare, hotel, rental vehicle, mileage reimbursement, and ground transportation.', 'workbook', 19, TRUE),
  ('expense', 'Direct Project Cost', 'Meals', 'Project Meals', 'Project Meals', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Restaurant or food receipt tied to documented project travel or eligible project activity.', 'workbook', 20, TRUE),
  ('expense', 'Direct Project Cost', 'Insurance & Bonds', 'Project Insurance & Bonds', 'Project Insurance & Bonds', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Project-specific insurance, bid bond, performance bond, payment bond, permit bond, or installation floater.', 'workbook', 21, TRUE),
  ('expense', 'Direct Project Cost', 'Warranty & Rework', 'Warranty & Correction Cost', 'Warranty & Correction Cost', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Manual Review', 'Warranty labor, replacement materials, corrective work, damage repair, or rework; usually requires project context.', 'workbook', 22, TRUE),
  ('expense', 'Direct Project Cost', 'Other', 'Other Project Expense', 'Other Project Expense', 'Cost of Goods Sold', 'All Project Types', 'Yes', 'Prefill & Review', 'Unusual direct project cost that cannot be assigned to another category.', 'workbook', 23, TRUE),
  ('expense', 'Company Overhead', 'Vehicle', 'Vehicle Fuel', 'Vehicle Fuel', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Gas station or fuel receipt for a company vehicle when not assigned to a specific project.', 'workbook', 24, TRUE),
  ('expense', 'Company Overhead', 'Vehicle', 'Vehicle Repair & Maintenance', 'Vehicle Repair & Maintenance', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Oil change, service, repair, tires, parts, car wash, towing, or maintenance for company vehicles.', 'workbook', 25, TRUE),
  ('expense', 'Company Overhead', 'Vehicle', 'Vehicle Registration, Lease & Insurance', 'Vehicle Registration, Lease & Insurance', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'DMV registration, vehicle lease invoice, commercial auto insurance, or roadside-assistance charge.', 'workbook', 26, TRUE),
  ('expense', 'Company Overhead', 'Vehicle', 'Vehicle Parking & Tolls', 'Vehicle Parking & Tolls', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'General business parking and tolls not assigned to one project.', 'workbook', 27, TRUE),
  ('expense', 'Company Overhead', 'Office & Facilities', 'Office Supplies & Printing', 'Office Supplies & Printing', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Paper, ink, stationery, postage, small office supplies, general printing, and mailing.', 'workbook', 28, TRUE),
  ('expense', 'Company Overhead', 'Office & Facilities', 'Rent, Storage & Utilities', 'Rent, Storage & Utilities', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Office, warehouse, yard, or storage rent; electricity, gas, water, trash, and regular utility services.', 'workbook', 29, TRUE),
  ('expense', 'Company Overhead', 'Office & Facilities', 'Facility Repair & Security', 'Facility Repair & Security', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'Office or warehouse repair, janitorial service, alarm, camera, access control, and monitoring.', 'workbook', 30, TRUE),
  ('expense', 'Company Overhead', 'Technology', 'Software & Subscriptions', 'Software & Subscriptions', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Accounting, payroll, estimating, project-management, CAD, cloud storage, email, hosting, domain, AI, and other software subscriptions.', 'workbook', 31, TRUE),
  ('expense', 'Company Overhead', 'Technology', 'Phone, Internet & IT', 'Phone, Internet & IT', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Mobile phone, telephone, internet, IT support, computer repair, accessories, network services, and technical support.', 'workbook', 32, TRUE),
  ('expense', 'Company Overhead', 'Insurance', 'Business Insurance', 'Business Insurance', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'General liability, workers'' compensation, professional liability, property, cyber, umbrella, and other business insurance.', 'workbook', 33, TRUE),
  ('expense', 'Company Overhead', 'Employees', 'Employee Benefits & Workforce Expense', 'Employee Benefits & Workforce Expense', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'Health benefits, uniforms, recruiting, background checks, drug testing, and general employee-support costs.', 'workbook', 34, TRUE),
  ('expense', 'Company Overhead', 'Professional Services', 'Accounting, Legal & Consulting', 'Accounting, Legal & Consulting', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'Accountant, bookkeeper, attorney, tax preparer, business consultant, HR consultant, or general professional-service invoice.', 'workbook', 35, TRUE),
  ('expense', 'Company Overhead', 'Licenses & Compliance', 'Licenses, Certifications & Filing Fees', 'Licenses, Certifications & Filing Fees', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Contractor license, business license, professional certification, annual filing, registration, and company compliance fees.', 'workbook', 36, TRUE),
  ('expense', 'Company Overhead', 'Taxes', 'Payroll & Business Taxes', 'Payroll & Business Taxes', 'Operating Expense', 'Internal / Overhead', 'No', 'Manual Review', 'Employer payroll taxes, property tax, franchise or eligible business tax; excludes personal or company income tax unless reviewed.', 'workbook', 37, TRUE),
  ('expense', 'Company Overhead', 'Banking & Finance', 'Bank, Merchant & Interest Fees', 'Bank, Merchant & Interest Fees', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Bank fee, wire fee, returned-payment fee, credit-card processing fee, online-payment fee, and business interest charge.', 'workbook', 38, TRUE),
  ('expense', 'Company Overhead', 'Marketing & Sales', 'Marketing, Sales & Bid Expense', 'Marketing, Sales & Bid Expense', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Advertising, website, signs, vehicle graphics, social media, promotional material, lead service, proposal, bid, or sales commission.', 'workbook', 39, TRUE),
  ('expense', 'Company Overhead', 'Training & Safety', 'Training, Education & Safety', 'Training, Education & Safety', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'OSHA, first aid, technical training, continuing education, general PPE, safety supplies, and training certification.', 'workbook', 40, TRUE),
  ('expense', 'Company Overhead', 'Meals & Events', 'Business Meals & Employee Events', 'Business Meals & Employee Events', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'Documented business meal, employee meeting, company event, or employee-recognition expense.', 'workbook', 41, TRUE),
  ('expense', 'Company Overhead', 'Repair & Maintenance', 'Tools, Equipment & Facility Maintenance', 'Tools, Equipment & Facility Maintenance', 'Operating Expense', 'Internal / Overhead', 'No', 'Prefill & Review', 'General tool, test-equipment, office, warehouse, or equipment repair not assigned to a project.', 'workbook', 42, TRUE),
  ('expense', 'Company Overhead', 'Memberships', 'Dues & Memberships', 'Dues & Memberships', 'Operating Expense', 'Internal / Overhead', 'No', 'Auto', 'Trade association, chamber of commerce, and professional membership dues.', 'workbook', 43, TRUE),
  ('expense', 'Company Overhead', 'Other', 'Bad Debt & Other Overhead', 'Bad Debt & Other Overhead', 'Operating Expense', 'Internal / Overhead', 'No', 'Manual Review', 'Uncollectible customer balance or unusual overhead that does not fit another category.', 'workbook', 44, TRUE),
  ('expense', 'Special Transaction', 'Assets', 'Asset Purchase', 'Asset Purchase', 'Fixed Asset', 'All Project Types', 'Optional', 'Manual Review', 'Large equipment, vehicle, computer, server, furniture, or long-term asset; capitalization policy must be reviewed.', 'workbook', 45, TRUE),
  ('expense', 'Special Transaction', 'Inventory', 'Inventory Purchase', 'Inventory Purchase', 'Current Asset', 'All Project Types', 'Optional', 'Manual Review', 'Materials purchased for stock or resale rather than immediate use on one project.', 'workbook', 46, TRUE),
  ('expense', 'Special Transaction', 'Prepaids & Deposits', 'Prepaid Expense or Deposit', 'Prepaid Expense or Deposit', 'Current Asset', 'All Project Types', 'Optional', 'Manual Review', 'Prepaid insurance, prepaid rent, vendor deposit, utility deposit, rental deposit, or other refundable deposit.', 'workbook', 47, TRUE),
  ('expense', 'Special Transaction', 'Debt', 'Loan or Credit Card Payment', 'Loan or Credit Card Payment', 'Liability Reduction', 'Not Applicable', 'No', 'Manual Review', 'Loan-principal payment or credit-card balance payment; underlying purchases and interest must be categorized separately.', 'workbook', 48, TRUE),
  ('expense', 'Special Transaction', 'Taxes & Liabilities', 'Sales Tax or Government Payment', 'Sales Tax or Government Payment', 'Liability Reduction', 'Not Applicable', 'No', 'Manual Review', 'Payment of sales tax or another previously recorded liability; not an ordinary operating expense.', 'workbook', 49, TRUE),
  ('expense', 'Special Transaction', 'Owner Transaction', 'Owner Draw or Contribution', 'Owner Draw or Contribution', 'Equity', 'Not Applicable', 'No', 'Manual Review', 'Owner withdrawal or owner capital contribution; not an expense.', 'workbook', 50, TRUE),
  ('expense', 'Special Transaction', 'Employee Transaction', 'Employee Advance', 'Employee Advance', 'Current Asset', 'All Project Types', 'Optional', 'Manual Review', 'Recoverable advance paid to an employee.', 'workbook', 51, TRUE),
  ('expense', 'Special Transaction', 'Contribution', 'Charitable Contribution - Review', 'Charitable Contribution - Review', 'Review Required', 'Internal / Overhead', 'No', 'Manual Review', 'Donation or charitable contribution; entity and tax treatment should be reviewed.', 'workbook', 52, TRUE),
  ('expense', 'Special Transaction', 'Review Required', 'Uncategorized - Review Required', 'Uncategorized - Review Required', 'Review Required', 'All Project Types', 'Optional', 'Manual Review', 'Use when the document or context is insufficient for reliable classification.', 'workbook', 53, TRUE),
  ('income', 'Direct Project Income', 'Contract & Project', 'Contract & Project Income', 'Contract & Project Income', 'Operating Income', 'All Project Types', 'Yes', 'Prefill & Review', 'Customer invoice, progress billing, schedule of values, installation billing, new construction, remodeling, or time-and-material work.', 'workbook', 1, TRUE),
  ('income', 'Direct Project Income', 'Service & Repair', 'Service & Repair Income', 'Service & Repair Income', 'Operating Income', 'All Project Types', 'Yes', 'Auto', 'Service call, repair, troubleshooting, diagnostic, emergency, after-hours, dispatch, or trip-charge invoice.', 'workbook', 2, TRUE),
  ('income', 'Direct Project Income', 'Maintenance & Testing', 'Maintenance, Inspection & Testing Income', 'Maintenance, Inspection & Testing Income', 'Operating Income', 'All Project Types', 'Yes', 'Auto', 'Maintenance agreement, recurring service, inspection, testing, certification, monitoring, or scheduled system service.', 'workbook', 3, TRUE),
  ('income', 'Direct Project Income', 'Professional Services', 'Design & Project Management Income', 'Design & Project Management Income', 'Operating Income', 'All Project Types', 'Yes', 'Prefill & Review', 'Design, engineering, drafting, consulting, permit coordination, project-management, or construction-management fee.', 'workbook', 4, TRUE),
  ('income', 'Direct Project Income', 'Change Orders', 'Change Order Income', 'Change Order Income', 'Operating Income', 'All Project Types', 'Yes', 'Auto', 'Approved change order, added scope, labor change, material change, field directive, or contract modification.', 'workbook', 5, TRUE),
  ('income', 'Direct Project Income', 'Materials & Equipment', 'Material & Equipment Income', 'Material & Equipment Income', 'Operating Income', 'All Project Types', 'Yes', 'Auto', 'Material sale, material markup, equipment charge, equipment rental, device sale, parts sale, or customer-purchased hardware.', 'workbook', 6, TRUE),
  ('income', 'Direct Project Income', 'Reimbursements', 'Customer Reimbursement Income', 'Customer Reimbursement Income', 'Operating Income', 'All Project Types', 'Yes', 'Auto', 'Customer reimbursement for permits, materials, travel, parking, freight, shipping, delivery, lodging, or other pass-through costs.', 'workbook', 7, TRUE),
  ('income', 'Direct Project Income', 'Fees & Other Project Income', 'Other Project Income', 'Other Project Income', 'Operating Income', 'All Project Types', 'Yes', 'Prefill & Review', 'Cancellation, rescheduling, restocking, administrative, mobilization, demobilization, or other project-related customer fee.', 'workbook', 8, TRUE),
  ('income', 'Other Operating Income', 'Other Business Income', 'Other Business Income', 'Other Business Income', 'Other Income', 'Internal / Overhead', 'No', 'Prefill & Review', 'Vendor rebate, vendor incentive, scrap-material sale, refund exceeding an expense reversal, miscellaneous business receipt, or other non-project income.', 'workbook', 9, TRUE),
  ('income', 'Other Income', 'Finance Income', 'Interest Income', 'Interest Income', 'Other Income', 'Not Applicable', 'No', 'Auto', 'Bank statement or financial document showing interest earned on a business account.', 'workbook', 10, TRUE),
  ('income', 'Other Income', 'Insurance & Asset Proceeds', 'Insurance or Asset Sale Proceeds - Review', 'Insurance or Asset Sale Proceeds - Review', 'Review Required', 'Not Applicable', 'No', 'Manual Review', 'Insurance reimbursement, settlement, vehicle sale, equipment sale, or other asset-disposal proceeds; accounting treatment requires review.', 'workbook', 11, TRUE),
  ('income', 'Special Transaction', 'Customer Deposits', 'Customer Deposit / Unearned Revenue', 'Customer Deposit / Unearned Revenue', 'Liability', 'All Project Types', 'Yes', 'Manual Review', 'Deposit, advance payment, retainer, prepayment, mobilization deposit, or payment received before the related work is earned.', 'workbook', 12, TRUE),
  ('income', 'Special Transaction', 'Owner Transaction', 'Owner Contribution', 'Owner Contribution', 'Equity', 'Not Applicable', 'No', 'Manual Review', 'Transfer or deposit from the owner into the company; not business income.', 'workbook', 13, TRUE),
  ('income', 'Special Transaction', 'Financing', 'Loan Proceeds', 'Loan Proceeds', 'Liability', 'Not Applicable', 'No', 'Manual Review', 'Loan funding, line-of-credit draw, equipment financing, or other borrowed money; not business income.', 'workbook', 14, TRUE),
  ('income', 'Special Transaction', 'Taxes & Liabilities', 'Sales Tax Collected', 'Sales Tax Collected', 'Liability', 'All Project Types', 'Optional', 'Manual Review', 'Sales or use tax collected from a customer for payment to a government agency; not company revenue.', 'workbook', 15, TRUE),
  ('income', 'Special Transaction', 'Review Required', 'Uncategorized Income - Review Required', 'Uncategorized Income - Review Required', 'Review Required', 'All Project Types', 'Optional', 'Manual Review', 'Use when the document or transaction context is insufficient to distinguish revenue from a deposit, transfer, loan, refund, or other receipt.', 'workbook', 16, TRUE)
ON CONFLICT (transaction_kind, type_name, general_category, detail_category)
DO UPDATE SET
  name = EXCLUDED.name,
  accounting_type = EXCLUDED.accounting_type,
  project_type_applicability = EXCLUDED.project_type_applicability,
  project_required = EXCLUDED.project_required,
  ai_handling = EXCLUDED.ai_handling,
  ai_clues = EXCLUDED.ai_clues,
  source = EXCLUDED.source,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  updated_at = NOW();


INSERT INTO app_settings (setting_key, setting_value, setting_type, description, updated_by)
VALUES
  ('receipt_storage', 'postgres', 'text', 'Where uploaded receipt files are stored: postgres now; later object storage or Railway volume.', 'system'),
  ('ai_extraction_enabled', 'false', 'boolean', 'Turn AI receipt extraction on/off.', 'system'),
  ('ai_confidence_threshold', '0.80', 'number', 'Minimum AI confidence before record is considered clean.', 'system'),
  ('default_project_rule', 'recently_used', 'text', 'How upload page pre-fills project: recently_used or most_used_this_month.', 'system'),
  ('default_category_rule', 'recently_used', 'text', 'How upload page pre-fills category.', 'system'),
  ('receipt_number_rule', 'manual_or_ai', 'text', 'Receipt number can be entered manually or filled by AI later.', 'system'),
  ('company_name', 'FNE Services Inc.', 'text', 'Company name for exports.', 'system'),
  ('payment_method_rule', 'ai_text_last4_only', 'text', 'Payment method stores only last four digits, cash, check, or unknown.', 'system'),
  ('follow_up_allowed_options', 'reimburse,collect', 'text', 'Allowed follow-up values.', 'system'),
  ('missing_info_rule', 'missing receipt_date/store/worker/project/category/total', 'text', 'Rule used to flag missing information.', 'system'),
  ('category_source', 'FNEBooks_Categories_AI_Friendly_Expense_Income.xlsx', 'text', 'Master category workbook used to seed expense and income categories.', 'system')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_categories_kind_active ON categories(transaction_kind, active);
CREATE INDEX IF NOT EXISTS idx_categories_general ON categories(general_category);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipts_worker ON receipts(worker_id);
CREATE INDEX IF NOT EXISTS idx_receipts_project ON receipts(project_id);
CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category_id);
CREATE INDEX IF NOT EXISTS idx_receipts_follow_up ON receipts(follow_up);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_date ON receipt_items(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipt_items_project ON receipt_items(project_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items(category_id);

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

