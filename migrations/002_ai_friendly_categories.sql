-- UPGRADE-ONLY. Folded into 001_fnebooks_schema.sql; do not run on a fresh
-- install. See migrations/README.md.
-- Upgrade an earlier FNEBooks starter database to the AI-friendly category structure.
-- Safe to run more than once.

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
  sort_order = COALESCE(sort_order, 9999)
WHERE detail_category IS NULL
   OR transaction_kind IS NULL
   OR type_name IS NULL
   OR general_category IS NULL;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_hierarchy
ON categories(transaction_kind, type_name, general_category, detail_category);

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS category_group TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS category_type TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS accounting_type TEXT;

ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS category_group TEXT;
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS category_type TEXT;
ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS accounting_type TEXT;

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


UPDATE receipts r
SET
  category_name = COALESCE(c.detail_category, c.name),
  category_group = c.general_category,
  category_type = c.type_name,
  accounting_type = c.accounting_type
FROM categories c
WHERE r.category_id = c.id;

UPDATE receipt_items i
SET
  category_name = COALESCE(c.detail_category, c.name),
  category_group = c.general_category,
  category_type = c.type_name,
  accounting_type = c.accounting_type
FROM categories c
WHERE i.category_id = c.id;

CREATE INDEX IF NOT EXISTS idx_categories_kind_active ON categories(transaction_kind, active);
CREATE INDEX IF NOT EXISTS idx_categories_general ON categories(general_category);
CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items(category_id);
