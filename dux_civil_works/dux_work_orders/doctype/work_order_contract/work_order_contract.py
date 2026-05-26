# Copyright (c) 2026, Dux Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class WorkOrderContract(Document):
	def validate(self):
		self._block_amend_when_variations_exist()
		self._ensure_boq_row_uids()
		self._compute_boq_row_amounts()
		self._set_default_boq_deviation_limits()
		self._aggregate_summary_from_boq()
		self._validate_boq_summary_heads_are_service_items()
		self.set_total_amount()
		self.validate_summary_items()
		self.validate_summary_items_are_service_items()
		self.validate_retention_release_split()
		self.validate_schedule_dates()

	def _block_amend_when_variations_exist(self):
		"""Block Frappe's native amend cycle when the cancelled parent WO
		has submitted Work Order Variations referencing it.

		Amending a WO renames it (WO-...-1) and cancels the original.
		Any variations pointing at the original name would be orphaned —
		their work_order_contract field references a cancelled doc, the
		variation_number sequence resets on the new WO name, and the
		variation-aware RA Bill allocator would lose its scope map.

		Per DESIGN.md 4.7, scope changes go through new Work Order
		Variation documents — never through WO amend. This is also
		recorded in CLAUDE.md "WO amendments during dry-run period".
		This guard makes the policy load-bearing: it fires on save of
		the amended draft, blocking the amend early with a clear
		actionable message.

		(Pre-RA-Bill, pre-variation cosmetic corrections that legitimately
		need amend remain unaffected — they have no variations to
		preserve. This guard only fires when there's actually something
		to break.)
		"""
		if not self.amended_from:
			return
		sub_var_count = frappe.db.count(
			"Work Order Variation",
			{"work_order_contract": self.amended_from, "docstatus": 1},
		)
		if sub_var_count:
			frappe.throw(_(
				"Cannot amend Work Order {0}: it has {1} submitted Work Order "
				"Variation(s). Scope changes must be made via new Work Order "
				"Variations, not by amending the Work Order. See DESIGN.md "
				"Section 4.7."
			).format(self.amended_from, sub_var_count))

	def _compute_boq_row_amounts(self):
		"""Set amount = estimated_qty * rate on each boq_items row, then
		compute the per-row tax overlay.

		Phase 1.5c.2: this used to live on the deleted Civil Work Order
		BOQ controller; moved here when BOQ folded into Work Order Contract.
		Finding 1 Part 1 (RGI dry-run): extended to also compute tax_amount
		(amount * tax_pct/100) and amount_with_tax (amount + tax_amount).
		Each row's tax_amount and amount_with_tax are rounded to 2 decimals
		via flt(x, 2) BEFORE the aggregation step, so summary totals are
		sums of the rounded row values — the document is internally
		consistent to the eye (rows visibly add up to totals).
		The existing `amount` semantics are PRESERVED as WITHOUT-tax, so
		all existing reads (deviation aggregation, downstream RA Bill
		copy) keep working unchanged.
		"""
		if not self.boq_items:
			return
		for row in self.boq_items:
			qty = float(row.estimated_qty or 0)
			rate = float(row.rate or 0)
			row.amount = flt(qty * rate, 2)
			tax_pct = float(row.tax_pct or 0)
			row.tax_amount = flt(row.amount * tax_pct / 100.0, 2)
			row.amount_with_tax = flt(row.amount + row.tax_amount, 2)

	def _set_default_boq_deviation_limits(self):
		"""For BOQ rows where deviation_limit_pct is left unset (None),
		populate the default from Work Order Settings.

		IMPORTANT: tests `is None` explicitly, NOT a truthy fallback.
		An explicit 0 from the user means 'strict — no deviation allowed,
		amend WO for any qty change' and MUST be honored. The old
		Civil Work Order BOQ controller had a `in (None, 0)` check that
		overrode explicit 0 with the default — that was the 0% deviation
		rejection bug fixed by Phase 1.5c.2."""
		if not self.boq_items:
			return
		default_limit = None
		try:
			default_limit = frappe.db.get_single_value(
				"Work Order Settings", "default_boq_deviation_limit_pct"
			)
		except Exception:
			pass
		if default_limit is None:
			return
		for row in self.boq_items:
			if row.deviation_limit_pct is None:
				row.deviation_limit_pct = default_limit

	def _ensure_boq_row_uids(self):
		"""Assign a stable UUID to any boq_items row that doesn't have one.

		Child docs don't reliably get their own `before_insert` called when
		they're inserted as part of a parent save, so we assign here on the
		parent's validate. (The Work Order BOQ Item controller also has a
		before_insert safety net for the case where rows are inserted
		standalone via doc.insert().)"""
		import uuid as _uuid
		if not self.boq_items:
			return
		for row in self.boq_items:
			if not row.boq_row_uid:
				row.boq_row_uid = str(_uuid.uuid4())

	def _aggregate_summary_from_boq(self):
		"""When boq_items has rows, derive summary_items from them.
		Groups BOQ rows by summary_head Item, sums amount and tax_amount
		in parallel.

		Backward compatibility: if boq_items is empty, summary_items is
		left untouched (old-flow Work Orders work as before).

		Finding 1 Part 1: also accumulates per-head tax_amount and writes
		amount_with_tax = amount + tax_amount on each summary row."""
		if not self.boq_items:
			return  # old flow, summary_items as entered by user

		from collections import defaultdict
		totals = defaultdict(float)
		tax_totals = defaultdict(float)
		for boq_row in self.boq_items:
			if not boq_row.summary_head:
				continue
			totals[boq_row.summary_head] += flt(boq_row.amount or 0, 2)
			tax_totals[boq_row.summary_head] += flt(boq_row.tax_amount or 0, 2)

		# Preserve order of first occurrence in boq_items for stable UI
		seen_heads = []
		for row in self.boq_items:
			if row.summary_head and row.summary_head not in seen_heads:
				seen_heads.append(row.summary_head)

		self.summary_items = []
		for head in seen_heads:
			base = flt(totals[head], 2)
			tax = flt(tax_totals[head], 2)
			self.append("summary_items", {
				"summary_head": head,
				"amount": base,
				"tax_amount": tax,
				"amount_with_tax": flt(base + tax, 2),
			})

	def _validate_boq_summary_heads_are_service_items(self):
		"""When boq_items is populated, each row's summary_head must be a
		valid service Item (Work Order Items group, not disabled)."""
		if not self.boq_items:
			return
		for idx, row in enumerate(self.boq_items, start=1):
			if not row.summary_head:
				frappe.throw(_("BOQ row {0}: summary_head is mandatory.").format(idx))
			item_data = frappe.db.get_value(
				"Item", row.summary_head,
				["item_group", "disabled"], as_dict=True,
			)
			if not item_data:
				frappe.throw(_("BOQ row {0}: summary head Item '{1}' does not exist.").format(
					idx, row.summary_head))
			if item_data.disabled:
				frappe.throw(_("BOQ row {0}: summary head Item '{1}' is disabled.").format(
					idx, row.summary_head))
			if item_data.item_group != "Work Order Items":
				frappe.throw(_(
					"BOQ row {0}: summary head '{1}' must be in 'Work Order Items' group."
				).format(idx, row.summary_head))

	def before_insert(self):
		# On a brand-new document only, prefill terms from Work Order Settings
		# so the user sees sensible defaults but can override before save.
		# Skip if any term field is already set (e.g., when amending an existing WO).
		if self.amended_from:
			return
		self.prefill_terms_from_settings()

	def set_total_amount(self):
		"""Sum summary_items into the three header totals.

		total_amount stays semantically WITHOUT-tax (unchanged from
		Phase 1.5). total_tax_amount and total_amount_with_tax are the
		Finding 1 Part 1 additions. All three are sums of the already-
		rounded summary row values, so the visible math adds up."""
		total = 0.0
		total_tax = 0.0
		for row in (self.summary_items or []):
			total += flt(row.amount or 0, 2)
			total_tax += flt(row.tax_amount or 0, 2)
		self.total_amount = flt(total, 2)
		self.total_tax_amount = flt(total_tax, 2)
		self.total_amount_with_tax = flt(total + total_tax, 2)

	def validate_summary_items(self):
		if not self.summary_items:
			frappe.throw(_("At least one Summary Item is required."))
		for idx, row in enumerate(self.summary_items, start=1):
			if not row.summary_head:
				frappe.throw(_("Row {0}: Summary Head is required.").format(idx))
			if (row.amount or 0) <= 0:
				frappe.throw(_("Row {0}: Amount must be greater than zero.").format(idx))

	def validate_summary_items_are_service_items(self):
		"""Each summary_head must be an Item in the 'Work Order Items' group and not disabled."""
		if not self.summary_items:
			return
		for idx, row in enumerate(self.summary_items, start=1):
			if not row.summary_head:
				continue   # validate_summary_items already enforces presence
			item_data = frappe.db.get_value(
				"Item", row.summary_head,
				["item_group", "disabled", "name"], as_dict=True,
			)
			if not item_data:
				frappe.throw(_("Row {0}: Summary head Item '{1}' does not exist.").format(idx, row.summary_head))
			if item_data.disabled:
				frappe.throw(_("Row {0}: Summary head Item '{1}' is disabled.").format(idx, row.summary_head))
			if item_data.item_group != "Work Order Items":
				frappe.throw(_(
					"Row {0}: Summary head '{1}' must belong to Item Group 'Work Order Items', "
					"not '{2}'."
				).format(idx, row.summary_head, item_data.item_group))

	def validate_retention_release_split(self):
		on_final = self.retention_release_on_final_bill or 0
		after_dlp = self.retention_release_after_dlp or 0
		total = on_final + after_dlp
		if abs(total - 100) > 0.001:
			frappe.throw(_(
				"Retention release percentages must sum to 100. "
				"Currently: Final Bill {0}% + After DLP {1}% = {2}%"
			).format(on_final, after_dlp, total))

	def validate_schedule_dates(self):
		if (self.scheduled_start_date and self.scheduled_completion_date
				and self.scheduled_completion_date < self.scheduled_start_date):
			frappe.throw(_("Scheduled Completion Date cannot be earlier than Scheduled Start Date."))

	def prefill_terms_from_settings(self):
		try:
			settings = frappe.get_single("Work Order Settings")
		except Exception:
			# Settings doc may not exist on a fresh install — leave defaults blank
			return

		mapping = {
			"retention_percentage": "default_retention_percentage",
			"mobilization_advance_pct": "default_mobilization_advance_pct",
			"mobilization_recovery_pct": "default_mobilization_recovery_pct",
			"material_advance_pct": "default_material_advance_pct",
			"material_recovery_pct": "default_material_recovery_pct",
			"dlp_months": "default_dlp_months",
			"retention_release_on_final_bill": "default_retention_release_on_final_bill",
			"retention_release_after_dlp": "default_retention_release_after_dlp",
			"apply_labour_cess": "apply_labour_cess_by_default",
			"labour_cess_pct": "default_labour_cess_pct",
			"tds_category": "default_tds_category",
			# General Conditions block — standard boilerplate clauses
			# prefilled from Settings; the engineer can override per WO
			# for contracts with negotiated terms. Same is-None/is-empty
			# discriminator as the other prefilled fields, so explicit
			# user input (even an empty block) is respected.
			"general_conditions": "default_general_conditions",
		}
		for wo_field, settings_field in mapping.items():
			# Only prefill if the user genuinely didn't provide a value.
			# CRITICAL: use `is None`/empty-string discriminator, NOT a truthy
			# check. An explicit 0 on a Percent/Int field is a valid user
			# choice (e.g. "no retention", "release nothing after DLP",
			# "0 month DLP") and MUST be respected. The earlier `if not X`
			# pattern silently overwrote explicit 0s with Settings defaults
			# — same family of bug as the deviation_limit_pct=0 issue fixed
			# in 1.5c.2. See CLAUDE.md "Phase 1.5b execution — additional
			# Frappe learnings" for the broader pattern.
			current = self.get(wo_field)
			is_unset = current is None or current == ""
			if is_unset:
				value = settings.get(settings_field)
				if value is not None:
					self.set(wo_field, value)

	def on_submit(self):
		# Hook point for Phase 2 BOQ-freeze logic.
		# Phase 1: just record the submission. Nothing else to do yet.
		pass

	def before_cancel(self):
		"""Block cancellation when submitted Work Order Variations or
		Work Order RA Bills reference this WO.

		The variation-aware RA Bill allocator depends on the WO + its
		variations being a stable, jointly-referenced set; cancelling
		the parent WO out from under live downstream documents would
		invalidate cumulative-quantity history, scope maps, and posted
		recoveries. Per DESIGN.md 4.7, the WO is immutable once any
		variation or RA Bill exists against it.

		The dependents must be cancelled first (in reverse-FK order:
		RA Bills, then Variations, then the WO). This makes the order
		explicit instead of relying on Frappe's link-integrity behaviour,
		so the user sees an actionable count.
		"""
		sub_variations = frappe.db.count(
			"Work Order Variation",
			{"work_order_contract": self.name, "docstatus": 1},
		)
		sub_bills = frappe.db.count(
			"Work Order RA Bill",
			{"civil_work_order": self.name, "docstatus": 1},
		)
		if sub_variations or sub_bills:
			frappe.throw(_(
				"Cannot cancel Work Order {0}: {1} submitted variation(s) and "
				"{2} submitted RA Bill(s) reference it. Cancel those first."
			).format(self.name, sub_variations, sub_bills))

	def on_cancel(self):
		# Hook point for cascade behavior on cancel (Phase 2+).
		# Before-cancel guard above blocks cancel when dependents exist.
		pass
