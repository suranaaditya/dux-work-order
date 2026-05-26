# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

"""Seed default_general_conditions on Work Order Settings.

Idempotent: only writes if the field is currently empty/None. Sites that
have already customised this field (e.g. dev where we seeded via console)
are left untouched.

Why a patch and not a fixture: this is a SINGLE-doctype field with rich
HTML content. Frappe fixtures don't cleanly export Single docs, and we
also want sites to be able to customise the value without it being
re-overwritten by every migrate.
"""

import frappe


DEFAULT_CONDITIONS_HTML = (
	"<ol>"
	"<li>Quantities in the BOQ are estimated. Actual measurement at site shall prevail.</li>"
	"<li>Significant changes in quantity or scope require a formal written Variation Order before such work is measured or billed.</li>"
	"<li>Retention shall be deducted at the rate stated above from every Running Account Bill, and released per the Retention Release Schedule.</li>"
	"<li>All applicable statutory deductions (TDS, Labour Cess, etc.) shall be made at source per prevailing rates.</li>"
	"<li>The Contractor is responsible for site safety, statutory compliance, and quality of work as per applicable codes and the Employer's standards.</li>"
	"<li>Disputes, if any, shall be governed exclusively by the jurisdiction of the courts at the Employer's registered office location.</li>"
	"<li>This Work Order, together with Annexure 1, constitutes the entire agreement between the parties for the scope described herein.</li>"
	"</ol>"
)


def execute():
	current = frappe.db.get_single_value(
		"Work Order Settings", "default_general_conditions"
	)
	if current and current.strip():
		print(
			"Work Order Settings.default_general_conditions already set "
			f"({len(current)} chars) — patch leaves it untouched."
		)
		return

	settings = frappe.get_single("Work Order Settings")
	settings.default_general_conditions = DEFAULT_CONDITIONS_HTML
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	print(
		"Seeded Work Order Settings.default_general_conditions with the "
		f"standard 7-clause boilerplate ({len(DEFAULT_CONDITIONS_HTML)} chars)."
	)
