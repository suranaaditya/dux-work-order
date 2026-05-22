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
		# Force qty sign by line_type BEFORE amount computation: Reduced Qty
		# lines are stored as negative qty (so amount and tax compute
		# negative, and downstream the RA Bill scope-map reduces the
		# original cap via plain summation). Additional Qty / New Item stay
		# positive. This is the load-bearing guarantee that backs the
		# RA Bill effective-cap computation.
		self._force_qty_sign_by_line_type()
		self._compute_variation_row_amounts()
		self.set_variation_totals()
		self._validate_summary_heads_are_service_items()
		self._validate_referenced_lines()
		self._validate_cumulative_reductions_within_cap()
		self._validate_reductions_above_already_billed()

	def _force_qty_sign_by_line_type(self):
		"""Coerce qty sign per line_type before amount computation.

		Additional Qty and New Item lines: qty = +abs(qty).
		Reduced Qty lines:                  qty = -abs(qty).

		The picker / form may store either sign; the storage convention
		is normalized here so amounts and the RA Bill scope-map compute
		correctly regardless of how the value was entered. This is the
		server-side belt-and-suspenders behind the JS sign handlers.
		"""
		if not self.variation_items:
			return
		for row in self.variation_items:
			q = float(row.qty or 0)
			if row.line_type == "Reduced Qty":
				row.qty = -abs(q)
			else:
				row.qty = abs(q)

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

	def _validate_referenced_lines(self):
		"""Enforce the line_type / original_boq_row_uid contract:

		- 'Additional Qty' AND 'Reduced Qty' lines MUST have an
		  original_boq_row_uid that matches the boq_row_uid of a real BOQ
		  row on the linked work_order_contract. Both reference an
		  existing original (Additional Qty adds to it; Reduced Qty omits
		  from it). summary_head and uom must match the original.
		- 'New Item' lines MUST have original_boq_row_uid empty — these
		  introduce a brand-new scope with no original to extend. Any
		  stray value is cleared (defensive).

		For Reduced Qty lines additionally:
		- Per-line Edge 1: abs(qty) <= original.estimated_qty (cannot
		  omit more than exists from a single line).
		"""
		if not self.variation_items:
			return

		# Index original BOQ rows by UID for fast lookup + head/uom
		# comparison. An Additional Qty / Reduced Qty line is by
		# definition tied to an EXISTING original BOQ item, so its
		# summary_head and uom must match that original row. This is the
		# server-side belt-and-suspenders guard behind the client picker;
		# bypass via API or a misbehaving client lands here.
		self._original_by_uid = {}
		if self.work_order_contract:
			rows = frappe.get_all(
				"Work Order BOQ Item",
				filters={"parent": self.work_order_contract, "parenttype": "Work Order Contract"},
				fields=["boq_row_uid", "summary_head", "uom", "item_no", "estimated_qty"],
			)
			self._original_by_uid = {r.boq_row_uid: r for r in rows if r.boq_row_uid}

		REFERENCING_TYPES = ("Additional Qty", "Reduced Qty")
		for idx, row in enumerate(self.variation_items, start=1):
			if row.line_type == "New Item":
				if row.original_boq_row_uid:
					row.original_boq_row_uid = None
				continue
			if row.line_type in REFERENCING_TYPES:
				if not row.original_boq_row_uid:
					frappe.throw(_(
						"Variation line {0} ({1}): original_boq_row_uid is required "
						"(the BOQ row UID this scope {2})."
					).format(idx, row.line_type,
					         "extends" if row.line_type == "Additional Qty" else "omits from"))
				original = self._original_by_uid.get(row.original_boq_row_uid)
				if not original:
					frappe.throw(_(
						"Variation line {0} ({1}): original_boq_row_uid '{2}' does not "
						"match any BOQ row on Work Order '{3}'."
					).format(idx, row.line_type, row.original_boq_row_uid, self.work_order_contract))
				label = row.item_no or original.item_no or "?"
				if row.summary_head != original.summary_head:
					frappe.throw(_(
						"Variation line {0} ({1}, item {2}): summary head '{3}' "
						"must match the original BOQ item's head '{4}'."
					).format(idx, row.line_type, label, row.summary_head, original.summary_head))
				if row.uom != original.uom:
					frappe.throw(_(
						"Variation line {0} ({1}, item {2}): UOM '{3}' must match "
						"the original BOQ item's UOM '{4}'."
					).format(idx, row.line_type, label, row.uom, original.uom))
				# Reduced Qty Edge 1 — per-line: cannot omit more than
				# the original scope's estimated_qty. A reduction equal
				# to the original (-100 on 100) is allowed (effective cap
				# becomes 0; this is how DELETE is expressed).
				if row.line_type == "Reduced Qty":
					orig_qty = float(original.estimated_qty or 0)
					if abs(float(row.qty or 0)) > orig_qty + 0.0001:
						frappe.throw(_(
							"Variation line {0} (Reduced Qty, item {1}): cannot omit "
							"more than exists. Requested reduction {2} exceeds the "
							"original BOQ qty {3}."
						).format(idx, label, abs(float(row.qty or 0)), orig_qty))
			else:
				frappe.throw(_("Variation line {0}: unknown line_type '{1}'.").format(
					idx, row.line_type))

	def _validate_cumulative_reductions_within_cap(self):
		"""Across this variation AND every other approved (docstatus=1)
		variation on the same WO, total reduction targeting any single
		original BOQ row must not exceed that original's estimated_qty.
		Two -60 reductions on the same 100-qty item would otherwise
		summate to -120, producing a nonsense negative effective cap.

		Per-line Edge 1 (in _validate_referenced_lines) catches the
		single-line case; this catches the cross-line / cross-variation
		case.
		"""
		if not self.variation_items:
			return
		if not getattr(self, "_original_by_uid", None):
			return  # _validate_referenced_lines short-circuited; nothing to do

		# Sum reductions in this in-memory variation, grouped by original UID
		in_memory = {}
		for row in self.variation_items:
			if row.line_type == "Reduced Qty" and row.original_boq_row_uid:
				in_memory[row.original_boq_row_uid] = (
					in_memory.get(row.original_boq_row_uid, 0.0)
					+ abs(float(row.qty or 0))
				)

		if not in_memory:
			return

		for orig_uid, this_doc_reduction in in_memory.items():
			original = self._original_by_uid.get(orig_uid)
			if not original:
				continue
			# Already-approved reductions on OTHER variations
			other_reductions = frappe.db.sql("""
				SELECT IFNULL(SUM(ABS(vi.qty)), 0)
				FROM `tabWork Order Variation Item` vi
				INNER JOIN `tabWork Order Variation` v ON v.name = vi.parent
				WHERE vi.line_type = 'Reduced Qty'
				  AND vi.original_boq_row_uid = %s
				  AND v.work_order_contract = %s
				  AND v.docstatus = 1
				  AND v.name != %s
			""", (orig_uid, self.work_order_contract, self.name or ""))[0][0]
			total = float(this_doc_reduction) + float(other_reductions or 0)
			orig_qty = float(original.estimated_qty or 0)
			if total > orig_qty + 0.0001:
				frappe.throw(_(
					"Cumulative Reduced Qty on item {0} ({1}) is {2} — exceeds "
					"the original BOQ qty {3}. Adjust this variation: total "
					"reductions cannot leave the effective cap below zero."
				).format(original.item_no or "?", orig_uid, total, orig_qty))

	def _validate_reductions_above_already_billed(self):
		"""Edge 3 safety net: a deductive variation cannot drop an
		original scope's effective cap below the cumulative ALREADY
		BILLED against that scope (from submitted RA Bills). If it did,
		the next bill's allocator would discover that prior work has
		exceeded the now-lower cap — an impossible state.

		Fires on save: covers the user's stated "shouldn't happen"
		case (the engineer billed 90 already, then someone tries to
		reduce the scope to 80). Cheap; only does a DB lookup per
		reduced original UID.
		"""
		if not self.variation_items:
			return
		if not getattr(self, "_original_by_uid", None):
			return

		# Group this doc's reductions by original UID
		this_doc_reductions = {}
		for row in self.variation_items:
			if row.line_type == "Reduced Qty" and row.original_boq_row_uid:
				this_doc_reductions[row.original_boq_row_uid] = (
					this_doc_reductions.get(row.original_boq_row_uid, 0.0)
					+ abs(float(row.qty or 0))
				)

		for orig_uid, this_doc_reduction in this_doc_reductions.items():
			original = self._original_by_uid.get(orig_uid)
			if not original:
				continue
			# Other approved reductions on this original
			other_reductions = frappe.db.sql("""
				SELECT IFNULL(SUM(ABS(vi.qty)), 0)
				FROM `tabWork Order Variation Item` vi
				INNER JOIN `tabWork Order Variation` v ON v.name = vi.parent
				WHERE vi.line_type = 'Reduced Qty'
				  AND vi.original_boq_row_uid = %s
				  AND v.work_order_contract = %s
				  AND v.docstatus = 1
				  AND v.name != %s
			""", (orig_uid, self.work_order_contract, self.name or ""))[0][0]
			effective_cap = float(original.estimated_qty or 0) - float(this_doc_reduction) - float(other_reductions or 0)
			# Already-billed cumulative on the ORIGINAL scope (= the original
			# BOQ row's boq_row_uid, which is the original scope's UID in the
			# RA Bill scope map).
			already_billed = frappe.db.sql("""
				SELECT IFNULL(MAX(rb_item.cumulative_qty), 0)
				FROM `tabWork Order RA Bill Item` rb_item
				INNER JOIN `tabWork Order RA Bill` rb ON rb.name = rb_item.parent
				WHERE rb_item.boq_row_uid = %s
				  AND rb.civil_work_order = %s
				  AND rb.docstatus = 1
			""", (orig_uid, self.work_order_contract))[0][0]
			already_billed = float(already_billed or 0)
			if effective_cap + 0.0001 < already_billed:
				frappe.throw(_(
					"Cannot reduce item {0} ({1}): the resulting effective cap "
					"{2} would fall below the cumulative {3} already billed on "
					"submitted RA Bills. Reverse the over-billing first, or "
					"reduce by a smaller amount."
				).format(original.item_no or "?", orig_uid, effective_cap, already_billed))

	def on_submit(self):
		# Write this variation's headline row onto the parent WO's
		# `variations_register` table (allow_on_submit), so the
		# (otherwise frozen) WO surfaces the existence of every
		# sanctioned variation against it. The WO is NEVER amended or
		# cancelled by this — Frappe permits writes to allow_on_submit
		# fields on submitted docs.
		self._post_to_wo_register()

	def on_cancel(self):
		# Cancelling a variation marks docstatus=2 but the variation_number
		# is retained — gap-tolerant numbering means the next variation
		# gets max+1, never the cancelled gap. See autoname() docstring
		# and DESIGN.md 4.7.
		#
		# Remove the headline row this variation wrote to the parent
		# WO's variations_register on submit, so a cancelled variation
		# stops appearing as part of the contract. Mirror of
		# _post_to_wo_register's write path.
		self._reverse_wo_register()

	def _post_to_wo_register(self):
		"""Append (or update if already present) this variation's headline
		row on the parent Work Order Contract's `variations_register`.

		This runs in on_submit, against a SUBMITTED Work Order. Because
		`variations_register` is an allow_on_submit table on Work Order
		Contract, Frappe permits `wo.save(ignore_permissions=True)` to
		persist child-row changes without amending or cancelling the WO.
		Mirrors the RA Bill -> Advance Register write pattern (see
		work_order_ra_bill.post_recoveries_to_register), adjusted for
		the submittable-target case.

		Idempotent: if a row keyed by this variation's `name` already
		exists, its fields are refreshed instead of duplicating. This
		covers the re-save edge after a controller fix or re-trigger.
		"""
		if not self.work_order_contract:
			return
		wo = frappe.get_doc("Work Order Contract", self.work_order_contract)
		payload = {
			"variation": self.name,
			"variation_number": int(self.variation_number or 0),
			"variation_date": self.variation_date,
			"status": "Submitted",
			"reason_for_change": self.reason_for_change,
			# Variation totals are SIGNED — deductive variations are
			# negative (Reduced Qty lines contribute negative amount).
			"value_with_tax": flt(self.total_amount_with_tax or 0, 2),
		}
		# Idempotency: if a row for this variation already exists, refresh
		# in place rather than duplicating.
		existing_row = None
		for row in (wo.variations_register or []):
			if row.variation == self.name:
				existing_row = row
				break
		if existing_row:
			for k, v in payload.items():
				setattr(existing_row, k, v)
		else:
			wo.append("variations_register", payload)
		# allow_on_submit permits writing to a submitted parent; only
		# allow_on_submit fields have changed, so Frappe's save accepts.
		wo.save(ignore_permissions=True)

	def _reverse_wo_register(self):
		"""Remove this variation's row from the parent WO's
		`variations_register`. Mirror of _post_to_wo_register's write.

		If the WO no longer exists (the user manually deleted it — would
		require ignoring the before_cancel guard on the WO too, but
		defensive), this is a no-op. Otherwise the row keyed by
		`variation == self.name` is dropped and the WO saved via the
		allow_on_submit-aware path.
		"""
		if not self.work_order_contract:
			return
		if not frappe.db.exists("Work Order Contract", self.work_order_contract):
			return
		wo = frappe.get_doc("Work Order Contract", self.work_order_contract)
		before = len(wo.variations_register or [])
		wo.variations_register = [
			r for r in (wo.variations_register or []) if r.variation != self.name
		]
		if len(wo.variations_register) != before:
			wo.save(ignore_permissions=True)
