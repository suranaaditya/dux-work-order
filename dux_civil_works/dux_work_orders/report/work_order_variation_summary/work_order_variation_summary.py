# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

"""Work Order Variation Summary report.

Per BOQ item on the selected Work Order:
  Item No | Head | Description | UOM | Rate
  Original Qty | Variation 1 Qty | Variation 2 Qty | ... | Total Qty
  Total Value (excl. tax) | Total Value (incl. tax)

The per-item / per-scope sanctioned state is computed via the SHARED
helper `dux_work_orders.variation_state.build_scope_map`, which is the
same helper the RA Bill allocator uses. So the report and billing can
never disagree about what the current sanctioned scope is.

Only docstatus=1 (approved) variations are included — matches what
billing uses.
"""

import frappe
from frappe import _
from frappe.utils import flt

from dux_civil_works.dux_work_orders.variation_state import (
	build_scope_map,
	get_approved_variation_numbers,
)


def execute(filters=None):
	filters = filters or {}
	wo_name = filters.get("work_order_contract")
	if not wo_name:
		# Frappe will already block via the JS filter's reqd:1 — but be
		# defensive in case execute is invoked programmatically.
		return _empty(_("Please select a Work Order Contract."))

	if not frappe.db.exists("Work Order Contract", wo_name):
		return _empty(_("Work Order Contract {0} not found.").format(wo_name))

	scope_items = build_scope_map(wo_name)
	approved_vnums = get_approved_variation_numbers(wo_name)

	columns = _build_columns(approved_vnums)
	data = _build_data(scope_items, approved_vnums)

	# Footer total row (Frappe-style: an extra row tagged with is_total
	# styling via empty Item No; or we just append a synthesised row).
	footer = _build_footer(data, approved_vnums)
	if footer:
		data.append(footer)

	message = _build_message(wo_name, approved_vnums)
	return columns, data, message


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------

def _empty(message):
	return [], [], message


def _variation_col_label(n):
	return f"Var {n} Qty"


def _variation_col_field(n):
	return f"var_{n}_qty"


def _build_columns(approved_vnums):
	cols = [
		{"label": _("Item No"),     "fieldname": "item_no",      "fieldtype": "Data",     "width": 90},
		{"label": _("Head"),        "fieldname": "summary_head", "fieldtype": "Link",     "options": "Item", "width": 160},
		{"label": _("Description"), "fieldname": "description",  "fieldtype": "Small Text", "width": 320},
		{"label": _("UOM"),         "fieldname": "uom",          "fieldtype": "Link",     "options": "UOM",  "width": 80},
		{"label": _("Rate"),        "fieldname": "rate",         "fieldtype": "Currency", "width": 100},
		{"label": _("Original Qty"),"fieldname": "original_qty", "fieldtype": "Float",    "width": 110, "precision": 3},
	]
	for n in approved_vnums:
		cols.append({
			"label": _(_variation_col_label(n)),
			"fieldname": _variation_col_field(n),
			"fieldtype": "Float",
			"width": 100,
			"precision": 3,
		})
	cols.append({"label": _("Total Qty"),    "fieldname": "total_qty",         "fieldtype": "Float",    "width": 110, "precision": 3})
	cols.append({"label": _("Value (excl.)"), "fieldname": "value_excl_tax",   "fieldtype": "Currency", "width": 130})
	cols.append({"label": _("Value (incl.)"), "fieldname": "value_incl_tax",   "fieldtype": "Currency", "width": 130})
	return cols


def _build_data(scope_items, approved_vnums):
	rows = []
	for it in scope_items:
		# Initialise per-variation qty columns to None (blank cell).
		row = {
			"item_no":      it["item_no"],
			"summary_head": it["summary_head"],
			"description":  it["description"],
			"uom":          it["uom"],
			# Rate: take the ORIGINAL scope's rate when present, else the
			# first scope (New-Item-only items have no original, so the
			# variation's rate is the display rate). Variations with rate
			# revisions still appear in their per-variation column with
			# their own qty, so display rate is best-effort.
			"rate":         _display_rate(it),
		}
		# Initialise variation columns
		for n in approved_vnums:
			row[_variation_col_field(n)] = None

		original_qty = None
		total_qty = 0.0
		value_excl = 0.0
		value_incl = 0.0

		for s in it["scopes"]:
			cap = float(s["cap"] or 0)
			rate = float(s["rate"] or 0)
			tax = float(s["tax_pct"] or 0)
			scope_excl = cap * rate
			scope_incl = scope_excl * (1 + tax / 100.0)

			if s["source"] == "Original":
				# Display the FROZEN original qty (estimated_qty), NOT the
				# reduced effective cap — Original Qty column is the
				# contract's starting point. Reductions appear in their
				# variation column (negative). Total Qty = sum of effective
				# scope caps which equals what's actually billable.
				original_qty = _frozen_original_qty(it)
				# total_qty contribution from the original scope = its
				# effective (post-reduction) cap.
				total_qty += cap
				value_excl += scope_excl
				value_incl += scope_incl
			elif s["source"].startswith("Variation "):
				try:
					vnum = int(s["source"].split()[1])
				except (IndexError, ValueError):
					continue
				# Reductions arrive as a separate variation scope ONLY
				# when... actually, deductive variations REDUCE the
				# Original scope in place (no separate scope is added).
				# So a "Variation N" scope here is always additive — its
				# cap is the qty of the Additional Qty / New Item line.
				# Per-variation column shows that qty.
				row[_variation_col_field(vnum)] = (
					(row[_variation_col_field(vnum)] or 0) + cap
				)
				total_qty += cap
				value_excl += scope_excl
				value_incl += scope_incl

		# For original-rooted items, ALSO compute the deductive variation
		# contributions by inspecting Reduced Qty variation lines targeting
		# this item's UID. (They don't appear as separate scopes — they
		# reduced the Original scope's cap in place.)
		original_uid = it["item_key"] if original_qty is not None else None
		if original_uid:
			_apply_reduction_columns(row, original_uid, approved_vnums)

		row["original_qty"] = original_qty
		row["total_qty"] = flt(total_qty, 3)
		row["value_excl_tax"] = flt(value_excl, 2)
		row["value_incl_tax"] = flt(value_incl, 2)
		rows.append(row)
	return rows


def _frozen_original_qty(item):
	"""The frozen original BOQ estimated_qty for the item (read from the
	WO BOQ row by UID). The scope-map's Original cap is post-reduction;
	this returns the pre-reduction qty so the Original Qty column shows
	the contract's starting point."""
	uid = item["item_key"]
	# Look up the original BOQ row's estimated_qty by UID.
	row = frappe.db.get_value(
		"Work Order BOQ Item",
		{"boq_row_uid": uid, "parenttype": "Work Order Contract"},
		"estimated_qty",
	)
	return float(row) if row is not None else None


def _apply_reduction_columns(row, original_uid, approved_vnums):
	"""For an original-rooted item, look up Reduced Qty variation lines
	targeting this UID. Each such line contributes a NEGATIVE qty in the
	corresponding variation column."""
	if not approved_vnums:
		return
	# Join with variation header to filter by docstatus=1 + WO match
	# implicitly via the variation's parent record.
	reductions = frappe.db.sql("""
		SELECT v.variation_number, vi.qty
		FROM `tabWork Order Variation Item` vi
		INNER JOIN `tabWork Order Variation` v ON v.name = vi.parent
		WHERE vi.line_type = 'Reduced Qty'
		  AND vi.original_boq_row_uid = %s
		  AND v.docstatus = 1
	""", (original_uid,), as_dict=True)
	for r in reductions:
		vnum = int(r.variation_number or 0)
		if vnum not in approved_vnums:
			continue
		key = _variation_col_field(vnum)
		row[key] = (row[key] or 0) + float(r.qty or 0)  # qty stored negative


def _display_rate(item):
	for s in item["scopes"]:
		if s["source"] == "Original":
			return flt(s["rate"], 2)
	# New-item items have no original scope — use first variation scope.
	if item["scopes"]:
		return flt(item["scopes"][0]["rate"], 2)
	return 0


def _build_footer(rows, approved_vnums):
	if not rows:
		return None
	footer = {
		"item_no": "",
		"summary_head": "",
		"description": "<b>TOTAL</b>",
		"uom": "",
		"rate": None,
		"original_qty": None,
	}
	for n in approved_vnums:
		footer[_variation_col_field(n)] = None
	footer["total_qty"] = None  # qty across heterogeneous UOMs is meaningless
	footer["value_excl_tax"] = flt(sum(float(r.get("value_excl_tax") or 0) for r in rows), 2)
	footer["value_incl_tax"] = flt(sum(float(r.get("value_incl_tax") or 0) for r in rows), 2)
	return footer


def _build_message(wo_name, approved_vnums):
	if not approved_vnums:
		return _(
			"Work Order {0} has NO approved variations. Showing original "
			"BOQ only. Reflects approved (docstatus=1) variations only — "
			"draft variations are not included."
		).format(wo_name)
	return _(
		"Showing the consolidated sanctioned scope for Work Order {0} = "
		"original BOQ + {1} approved variation(s). Reflects approved "
		"(docstatus=1) variations only; draft variations are not "
		"included. Reductions appear as negative values in the relevant "
		"variation column."
	).format(wo_name, len(approved_vnums))
