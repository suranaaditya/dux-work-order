# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

"""Shared variation-aware scope-map helper.

This module owns the SINGLE SOURCE OF TRUTH for assembling a Work Order's
current effective state from the (frozen) Work Order Contract + its
approved (docstatus=1) Work Order Variations:

  - original BOQ rows seeded as 'Original' scopes
  - Additional Qty variation lines appended as variation scopes after
    the original (ordered by variation_number)
  - Reduced Qty variation lines REDUCE the original scope's effective
    cap (qty is stored negative → plain addition subtracts; clamp at 0)
  - New Item variation lines become standalone single-scope items

Both the RA Bill allocator (work_order_ra_bill._build_scope_map) and the
Work Order Variation Summary report import this function. Keeping it
shared guarantees the report can never disagree with what billing
actually does. See DESIGN.md Section 4.7.

This module is PURE / read-only — no writes, no side effects.
"""

import frappe


def build_scope_map(work_order_contract_name):
	"""Return the ordered item -> scopes structure for the given WO,
	joined with all docstatus=1 Work Order Variation docs.

	Each item is keyed by either:
	- the original BOQ row's boq_row_uid (for original-rooted items),
	  optionally extended by 'Additional Qty' variation lines, with the
	  effective cap reduced by any Reduced Qty variation lines, or
	- a 'New Item' variation line's own boq_row_uid (for standalone
	  items introduced by a variation).

	Each scope is a dict:
	    {uid, cap, rate, tax_pct, deviation_limit_pct,
	     item_no, summary_head, description, uom, source}
	where source is 'Original' or 'Variation N'.

	Returns a list of {item_key, item_no, summary_head, description,
	uom, scopes} preserving original BOQ order first, then New-Item-
	only items in (variation_number, row idx) order.
	"""
	items = []
	items_by_key = {}

	if not work_order_contract_name:
		return items

	wo = frappe.get_doc("Work Order Contract", work_order_contract_name)

	# 1. Seed with each original BOQ row.
	for boq in (wo.boq_items or []):
		key = boq.boq_row_uid
		if not key:
			continue
		item = {
			"item_key": key,
			"item_no": boq.item_no,
			"summary_head": boq.summary_head,
			"description": boq.description,
			"uom": boq.uom,
			"scopes": [{
				"uid": key,
				"cap": float(boq.estimated_qty or 0),
				"rate": float(boq.rate or 0),
				"tax_pct": float(boq.tax_pct or 0),
				"deviation_limit_pct": float(boq.deviation_limit_pct or 0),
				"item_no": boq.item_no,
				"summary_head": boq.summary_head,
				"description": boq.description,
				"uom": boq.uom,
				"source": "Original",
			}],
		}
		items.append(item)
		items_by_key[key] = item

	# 2. Walk approved variations in variation_number order; append
	#    Additional Qty scopes to their original-rooted items, reduce
	#    original cap for Reduced Qty lines, and create a standalone
	#    item per New Item line.
	variations = frappe.get_all(
		"Work Order Variation",
		filters={"work_order_contract": work_order_contract_name, "docstatus": 1},
		fields=["name", "variation_number"],
		order_by="variation_number asc",
	)
	for v in variations:
		vdoc = frappe.get_doc("Work Order Variation", v.name)
		source_tag = f"Variation {v.variation_number}"
		for vi in (vdoc.variation_items or []):
			if not vi.boq_row_uid:
				continue
			scope_entry = {
				"uid": vi.boq_row_uid,
				"cap": float(vi.qty or 0),
				"rate": float(vi.rate or 0),
				"tax_pct": float(vi.tax_pct or 0),
				"deviation_limit_pct": float(vi.deviation_limit_pct or 0),
				"item_no": vi.item_no,
				"summary_head": vi.summary_head,
				"description": vi.description,
				"uom": vi.uom,
				"source": source_tag,
			}
			if vi.line_type == "Additional Qty":
				root = items_by_key.get(vi.original_boq_row_uid)
				if not root:
					# Shouldn't happen — variation validate() guarantees
					# original_boq_row_uid matches a WO BOQ row. Skip
					# defensively if the WO has changed.
					continue
				root["scopes"].append(scope_entry)
			elif vi.line_type == "New Item":
				new_item = {
					"item_key": vi.boq_row_uid,
					"item_no": vi.item_no,
					"summary_head": vi.summary_head,
					"description": vi.description,
					"uom": vi.uom,
					"scopes": [scope_entry],
				}
				items.append(new_item)
				items_by_key[vi.boq_row_uid] = new_item
			elif vi.line_type == "Reduced Qty":
				# Deductive variation: reduce the ORIGINAL scope's
				# effective cap. vi.qty is stored negative (enforced
				# by the variation controller's
				# _force_qty_sign_by_line_type), so plain addition
				# subtracts. The WO is never modified — the reduced
				# cap is computed here at read time. See DESIGN.md 4.7
				# "Deductive variations".
				#
				# The original scope is always scopes[0] (seeded in
				# step 1 before any variation scopes are appended).
				# Reductions cannot target New-Item-only items —
				# the variation server guard requires
				# original_boq_row_uid to match an original BOQ row.
				root = items_by_key.get(vi.original_boq_row_uid)
				if not root or not root["scopes"]:
					continue
				original_scope = root["scopes"][0]
				new_cap = float(original_scope["cap"]) + float(vi.qty or 0)
				# Clamp at 0 — a fully-reduced item is non-billable
				# but never negative.
				original_scope["cap"] = max(0.0, new_cap)
			else:
				# Future line types (rate-revision, DELETE-distinct, ...)
				continue

	return items


def get_approved_variation_numbers(work_order_contract_name):
	"""Return the list of variation_numbers (Ints, sorted) for approved
	(docstatus=1) variations on the given WO. Used by the Variation
	Summary report to size its dynamic per-variation columns."""
	if not work_order_contract_name:
		return []
	rows = frappe.get_all(
		"Work Order Variation",
		filters={"work_order_contract": work_order_contract_name, "docstatus": 1},
		fields=["variation_number"],
		order_by="variation_number asc",
	)
	return [int(r.variation_number) for r in rows if r.variation_number is not None]
