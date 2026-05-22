# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import uuid

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class WorkOrderVariation(Document):
	def autoname(self):
		"""Compute variation_number and name from ONE value, so they can
		never drift. Both name and variation_number flow from `n`:

		    n = max(variation_number for variations on this WO,
		            across ALL docstatuses including cancelled) + 1
		    self.variation_number = n
		    self.name = f"VO-{self.work_order_contract}-{n:02d}"

		Gap-tolerant: a cancelled variation still consumes its number; the
		next variation gets n+1, never the gap. See DESIGN.md 4.7.

		CONCURRENCY GUARD: If two variations for the same WO are inserted
		simultaneously and compute the same `n`, both will try to insert
		with the same `name`. Frappe enforces uniqueness on document name
		at the DB layer, so the second insert raises DuplicateEntryError
		cleanly rather than silently producing two docs with the same
		variation_number. No extra unique constraint is needed —
		name-uniqueness IS the concurrency guard.
		"""
		if not self.work_order_contract:
			frappe.throw(_("Work Order Contract is required before naming."))

		existing_max = frappe.db.sql(
			"""SELECT COALESCE(MAX(variation_number), 0)
			   FROM `tabWork Order Variation`
			   WHERE work_order_contract = %s""",
			(self.work_order_contract,),
		)[0][0]
		n = int(existing_max or 0) + 1
		self.variation_number = n
		self.name = f"VO-{self.work_order_contract}-{n:02d}"

	def validate(self):
		self._ensure_variation_row_uids()
		self._compute_variation_row_amounts()
		self.set_variation_totals()
		self._validate_summary_heads_are_service_items()
		self._validate_additional_qty_lines()

	def _ensure_variation_row_uids(self):
		"""Assign a stable UUID to any variation_items row missing one.

		Mirrors Work Order Contract._ensure_boq_row_uids — child
		before_insert does not reliably fire during parent insert, so we
		assign here on the parent's validate. Each variation line's
		boq_row_uid is distinct from any original BOQ row's UID.
		"""
		if not self.variation_items:
			return
		for row in self.variation_items:
			if not row.boq_row_uid:
				row.boq_row_uid = str(uuid.uuid4())

	def _compute_variation_row_amounts(self):
		"""Set amount = qty * rate on each variation line, then compute
		the per-row tax overlay.

		Mirrors Work Order Contract._compute_boq_row_amounts (Finding 1
		Part 1). Each row's amount, tax_amount and amount_with_tax are
		rounded to 2 decimals via flt(x, 2) BEFORE aggregation, so
		header totals are sums of rounded row values — the document is
		internally consistent (rows visibly add up to totals).

		`amount` semantics: WITHOUT tax. Tax overlay computed separately.
		"""
		if not self.variation_items:
			return
		for row in self.variation_items:
			qty = float(row.qty or 0)
			rate = float(row.rate or 0)
			row.amount = flt(qty * rate, 2)
			tax_pct = float(row.tax_pct or 0)
			row.tax_amount = flt(row.amount * tax_pct / 100.0, 2)
			row.amount_with_tax = flt(row.amount + row.tax_amount, 2)

	def set_variation_totals(self):
		"""Sum variation_items into the three header totals.

		Same discipline as Work Order Contract.set_total_amount: sums of
		already-rounded per-row values.
		"""
		total = 0.0
		total_tax = 0.0
		for row in (self.variation_items or []):
			total += flt(row.amount or 0, 2)
			total_tax += flt(row.tax_amount or 0, 2)
		self.total_amount = flt(total, 2)
		self.total_tax_amount = flt(total_tax, 2)
		self.total_amount_with_tax = flt(total + total_tax, 2)

	def _validate_summary_heads_are_service_items(self):
		"""Each variation line's summary_head must be an Item in Item
		Group 'Work Order Items', not disabled.

		Applies to BOTH 'Additional Qty' and 'New Item' lines. Per the
		DESIGN.md 4.7 decision, New Item lines are constrained to the
		Work Order Items group but the head need NOT already exist on
		the parent WO — variations may introduce brand-new summary
		heads.
		"""
		if not self.variation_items:
			return
		for idx, row in enumerate(self.variation_items, start=1):
			if not row.summary_head:
				frappe.throw(_("Variation line {0}: summary_head is mandatory.").format(idx))
			item_data = frappe.db.get_value(
				"Item", row.summary_head,
				["item_group", "disabled"], as_dict=True,
			)
			if not item_data:
				frappe.throw(_("Variation line {0}: summary head Item '{1}' does not exist.").format(
					idx, row.summary_head))
			if item_data.disabled:
				frappe.throw(_("Variation line {0}: summary head Item '{1}' is disabled.").format(
					idx, row.summary_head))
			if item_data.item_group != "Work Order Items":
				frappe.throw(_(
					"Variation line {0}: summary head '{1}' must be in 'Work Order Items' group."
				).format(idx, row.summary_head))

	def _validate_additional_qty_lines(self):
		"""Enforce the line_type / original_boq_row_uid contract:

		- 'Additional Qty' lines MUST have an original_boq_row_uid that
		  matches the boq_row_uid of a real BOQ row on the linked
		  work_order_contract. (Variations extend existing original BOQ
		  rows; the UID is the stable link, see DESIGN.md 4.7.)
		- 'New Item' lines MUST have original_boq_row_uid empty — these
		  introduce a brand-new scope with no original to extend. Any
		  stray value is cleared (defensive).
		"""
		if not self.variation_items:
			return

		# Index original BOQ rows by UID for fast lookup + head/uom comparison.
		# An Additional Qty line is by definition extra quantity on an
		# EXISTING original BOQ item, so its summary_head and uom must
		# match that original row. This is the server-side belt-and-
		# suspenders guard behind the client picker; bypass via API or a
		# misbehaving client lands here.
		original_by_uid = {}
		if self.work_order_contract:
			rows = frappe.get_all(
				"Work Order BOQ Item",
				filters={"parent": self.work_order_contract, "parenttype": "Work Order Contract"},
				fields=["boq_row_uid", "summary_head", "uom", "item_no"],
			)
			original_by_uid = {r.boq_row_uid: r for r in rows if r.boq_row_uid}

		for idx, row in enumerate(self.variation_items, start=1):
			if row.line_type == "New Item":
				if row.original_boq_row_uid:
					row.original_boq_row_uid = None
			elif row.line_type == "Additional Qty":
				if not row.original_boq_row_uid:
					frappe.throw(_(
						"Variation line {0} (Additional Qty): original_boq_row_uid is required "
						"(the BOQ row UID this scope extends)."
					).format(idx))
				original = original_by_uid.get(row.original_boq_row_uid)
				if not original:
					frappe.throw(_(
						"Variation line {0} (Additional Qty): original_boq_row_uid '{1}' does not "
						"match any BOQ row on Work Order '{2}'."
					).format(idx, row.original_boq_row_uid, self.work_order_contract))
				# Head + UOM must match the original — Additional Qty by
				# definition extends a specific existing BOQ item; you
				# cannot reclassify it to a different head or measure it
				# in a different UOM via a variation.
				label = row.item_no or original.item_no or "?"
				if row.summary_head != original.summary_head:
					frappe.throw(_(
						"Variation line {0} (Additional Qty, item {1}): summary head '{2}' "
						"must match the original BOQ item's head '{3}'."
					).format(idx, label, row.summary_head, original.summary_head))
				if row.uom != original.uom:
					frappe.throw(_(
						"Variation line {0} (Additional Qty, item {1}): UOM '{2}' must match "
						"the original BOQ item's UOM '{3}'."
					).format(idx, label, row.uom, original.uom))
			else:
				frappe.throw(_("Variation line {0}: unknown line_type '{1}'.").format(
					idx, row.line_type))

	def on_submit(self):
		# Hook point for the next build step (variation-aware RA Bill
		# allocation logic). Phase 1 of the Variation build: nothing to
		# do at submit; the variation just becomes the locked sanctioned
		# delta against the WO.
		pass

	def on_cancel(self):
		# Cancelling a variation marks docstatus=2 but the variation_number
		# is retained — gap-tolerant numbering means the next variation
		# gets max+1, never the cancelled gap. See autoname() docstring
		# and DESIGN.md 4.7.
		pass
