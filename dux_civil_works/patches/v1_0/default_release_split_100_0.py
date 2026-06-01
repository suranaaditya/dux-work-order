# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

"""Change Work Order Settings retention release split from 50/50 to 100/0.

The old default (50% on final + 50% after DLP) caused confusion when the
engineer left the section blank — the system would silently retain half
until DLP expiry. The new default is 100% on final bill, 0% after DLP
(full release at final bill — the common case for most contractors).

Idempotent: only changes if the site is currently at the exact old default
50/50. Sites with any other configuration (40/60, 70/30, etc.) are left
untouched.
"""

import frappe


def execute():
	cur_on = frappe.db.get_single_value(
		"Work Order Settings", "default_retention_release_on_final_bill"
	)
	cur_dlp = frappe.db.get_single_value(
		"Work Order Settings", "default_retention_release_after_dlp"
	)
	if cur_on is None and cur_dlp is None:
		print("Release split fields are None — nothing to migrate.")
		return
	if float(cur_on or 0) == 50.0 and float(cur_dlp or 0) == 50.0:
		frappe.db.set_single_value(
			"Work Order Settings", "default_retention_release_on_final_bill", 100
		)
		frappe.db.set_single_value(
			"Work Order Settings", "default_retention_release_after_dlp", 0
		)
		frappe.db.commit()
		print("Migrated retention release split: 50/50 -> 100/0.")
	else:
		print(
			f"Release split is {cur_on}/{cur_dlp} (not the old default "
			"50/50) — patch leaves it untouched."
		)
