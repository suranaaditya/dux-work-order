# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

"""Change Work Order Settings.default_boq_deviation_limit_pct from 5 to 0.

The previous default was 5% — that meant BOQ rows where the engineer left
the Deviation Limit column blank silently picked up 5% tolerance. The
intended UX is the opposite: a blank field should mean "strict, no
deviation" (the engineer must opt-in to deviation by typing a percent).

Idempotent: only updates if the site's current value is the old default 5.
Sites that have deliberately set a different value (10, 7, etc.) are left
untouched.
"""

import frappe


def execute():
	current = frappe.db.get_single_value(
		"Work Order Settings", "default_boq_deviation_limit_pct"
	)
	if current is None:
		print("default_boq_deviation_limit_pct is None — nothing to migrate.")
		return
	# tolerate float vs int
	if float(current) == 5.0:
		frappe.db.set_single_value(
			"Work Order Settings", "default_boq_deviation_limit_pct", 0
		)
		frappe.db.commit()
		print("Migrated default_boq_deviation_limit_pct: 5 -> 0 (was the old default).")
	else:
		print(
			f"default_boq_deviation_limit_pct is {current} "
			"(not the old default 5) — patch leaves it untouched."
		)
