# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from dux_civil_works.dux_work_orders.doctype.work_order_advance_register.work_order_advance_register import (
	get_or_create_register,
	get_outstanding_balance,
)


class WorkOrderRABill(Document):
	# ============================================================
	# Lifecycle hooks
	# ============================================================

	def before_insert(self):
		self.assign_bill_number()
		self.populate_items_from_boq()

	def validate(self):
		self.validate_wo_consistency()
		self.validate_period_dates()
		self.compute_per_line_quantities()
		self.compute_gross_this_bill()
		self.suggest_deductions()
		self.compute_totals_and_net_payable()
		self.set_billing_status()

	def before_submit(self):
		self.enforce_deviation_limits()
		self.enforce_recovery_caps_against_register()

	def on_submit(self):
		self.post_recoveries_to_register()
		# Persist billing_status that validate() set; on_submit runs after DB update.
		self.db_set("billing_status", self._compute_billing_status(), update_modified=False)

	def on_cancel(self):
		self.reverse_recoveries_on_register()
		# Persist billing_status; on_cancel runs after DB update so direct attr won't save.
		self.db_set("billing_status", "Cancelled", update_modified=False)

	# ============================================================
	# before_insert helpers
	# ============================================================

	def assign_bill_number(self):
		if not self.civil_work_order:
			return
		prior = frappe.db.count(
			"Work Order RA Bill",
			{
				"civil_work_order": self.civil_work_order,
				"docstatus": ["<", 2],
				"name": ["!=", self.name or ""],
			},
		)
		self.bill_number = (prior or 0) + 1

	def populate_items_from_boq(self):
		"""Populate RA Bill items by reading BOQ rows directly from the
		parent Work Order Contract's embedded boq_items child table.

		Phase 1.5c.2: there is no longer a separate BOQ document; BOQ
		rows live on the Work Order Contract."""
		if not self.civil_work_order:
			return
		if self.items:
			return

		wo = frappe.get_doc("Work Order Contract", self.civil_work_order)
		if not wo.boq_items:
			frappe.throw(_(
				"Work Order Contract {0} has no BOQ items. "
				"Add BOQ rows to the Work Order before creating a Running Account Bill."
			).format(wo.name))

		for boq in wo.boq_items:
			prev_cum = self._get_previous_cumulative_qty(boq.boq_row_uid)
			self.append("items", {
				"boq_item_ref": boq.name,
				"boq_row_uid": boq.boq_row_uid,
				"item_no": boq.item_no,
				"summary_head": boq.summary_head,
				"description": boq.description,
				"uom": boq.uom,
				"estimated_qty": boq.estimated_qty,
				"rate": boq.rate,
				"deviation_limit_pct": boq.deviation_limit_pct,
				"previous_cumulative_qty": prev_cum,
				"cumulative_qty": prev_cum,
				"this_bill_qty": 0,
				"this_bill_amount": 0,
			})

	def _get_previous_cumulative_qty(self, boq_row_uid):
		"""Look up the most recent submitted cumulative_qty for the same
		logical BOQ row on the same Work Order. Matches on boq_row_uid
		(stable across WO amendments) rather than the row's child-table
		name (which changes on amendment)."""
		if not boq_row_uid or not self.civil_work_order:
			return 0
		result = frappe.db.sql("""
			SELECT IFNULL(MAX(rb_item.cumulative_qty), 0) AS qty
			FROM `tabWork Order RA Bill Item` rb_item
			INNER JOIN `tabWork Order RA Bill` rb ON rb.name = rb_item.parent
			WHERE rb_item.boq_row_uid = %s
			  AND rb.civil_work_order = %s
			  AND rb.docstatus = 1
			  AND rb.name != %s
		""", (boq_row_uid, self.civil_work_order, self.name or ""), as_dict=True)
		return float(result[0].qty if result else 0)

	# ============================================================
	# validate helpers
	# ============================================================

	def validate_wo_consistency(self):
		"""Linked Work Order Contract must exist and be Submitted.

		Phase 1.5c.2: the BOQ-specific docstatus check is gone — there
		is no separate BOQ document, so the WO docstatus is the only
		thing to validate here."""
		if not self.civil_work_order:
			return
		wo_docstatus = frappe.db.get_value(
			"Work Order Contract", self.civil_work_order, "docstatus"
		)
		if wo_docstatus != 1:
			frappe.throw(_(
				"Linked Work Order Contract {0} must be Submitted."
			).format(self.civil_work_order))

	def validate_period_dates(self):
		if self.period_from and self.period_to and self.period_to < self.period_from:
			frappe.throw(_("Period To cannot be earlier than Period From."))

	def compute_per_line_quantities(self):
		for row in (self.items or []):
			cum = float(row.cumulative_qty or 0)
			prev = float(row.previous_cumulative_qty or 0)
			if cum < prev:
				frappe.throw(_(
					"Row {0} ({1}): Cumulative qty ({2}) cannot be less than previous "
					"cumulative qty ({3})."
				).format(row.idx, row.description, cum, prev))
			row.this_bill_qty = cum - prev
			row.this_bill_amount = row.this_bill_qty * float(row.rate or 0)

	def compute_gross_this_bill(self):
		self.gross_this_bill = sum(
			float(row.this_bill_amount or 0) for row in (self.items or [])
		)

	# ============================================================
	# Deduction suggestion engine
	# ============================================================

	def suggest_deductions(self):
		if not self.civil_work_order:
			return

		wo = frappe.get_cached_doc("Work Order Contract", self.civil_work_order)
		gross = float(self.gross_this_bill or 0)

		manual_rows = [r for r in (self.deductions or []) if not r.is_auto_suggested]

		auto_rows = []

		if (wo.retention_percentage or 0) > 0 and gross > 0:
			amt = gross * float(wo.retention_percentage) / 100.0
			auto_rows.append({
				"nature": "Retention",
				"description": f"Retention @ {wo.retention_percentage}%",
				"amount": round(amt, 2),
				"gl_account": self._get_company_account("retention_payable_account"),
				"is_auto_suggested": 1,
			})

		if (wo.mobilization_recovery_pct or 0) > 0 and gross > 0:
			suggested = gross * float(wo.mobilization_recovery_pct) / 100.0
			outstanding = get_outstanding_balance(self.civil_work_order, "Mobilization")
			capped = min(suggested, outstanding) if outstanding > 0 else 0
			if capped > 0:
				auto_rows.append({
					"nature": "Mobilization Recovery",
					"description": f"Mob recovery @ {wo.mobilization_recovery_pct}% (capped at outstanding {outstanding})",
					"amount": round(capped, 2),
					"gl_account": self._get_company_account("mobilization_advance_account"),
					"is_auto_suggested": 1,
				})

		if (wo.material_recovery_pct or 0) > 0 and gross > 0:
			suggested = gross * float(wo.material_recovery_pct) / 100.0
			outstanding = get_outstanding_balance(self.civil_work_order, "Material")
			capped = min(suggested, outstanding) if outstanding > 0 else 0
			if capped > 0:
				auto_rows.append({
					"nature": "Material Recovery",
					"description": f"Mat recovery @ {wo.material_recovery_pct}% (capped at outstanding {outstanding})",
					"amount": round(capped, 2),
					"gl_account": self._get_company_account("material_advance_account"),
					"is_auto_suggested": 1,
				})

		if wo.apply_labour_cess and (wo.labour_cess_pct or 0) > 0 and gross > 0:
			amt = gross * float(wo.labour_cess_pct) / 100.0
			auto_rows.append({
				"nature": "Labour Cess",
				"description": f"Labour cess @ {wo.labour_cess_pct}%",
				"amount": round(amt, 2),
				"gl_account": self._get_company_account("labour_cess_payable_account"),
				"is_auto_suggested": 1,
			})

		# NOTE: TDS handled via ERPNext Tax Withholding at Purchase Invoice level
		# (using wo.tds_category). Avoids double-deducting.

		self.set("deductions", [])
		for row in auto_rows:
			self.append("deductions", row)
		for row in manual_rows:
			self.append("deductions", row.as_dict())

	def _get_company_account(self, fieldname):
		if not self.company:
			return None
		try:
			settings = frappe.get_cached_doc("Work Order Settings")
		except Exception:
			return None
		for row in (settings.company_accounts or []):
			if row.company == self.company:
				return row.get(fieldname) or settings.get(fieldname)
		return None

	# ============================================================
	# Totals
	# ============================================================

	DEDUCTION_NATURES = {
		"Retention", "Mobilization Recovery", "Material Recovery",
		"TDS", "Labour Cess", "Penalty", "Other Deduction",
	}
	ADDITION_NATURES = {"Price Escalation", "Other Addition"}

	def compute_totals_and_net_payable(self):
		deductions = 0.0
		additions = 0.0
		for row in (self.deductions or []):
			amt = float(row.amount or 0)
			if row.nature in self.DEDUCTION_NATURES:
				deductions += amt
			elif row.nature in self.ADDITION_NATURES:
				additions += amt
		self.total_deductions = deductions
		self.total_additions = additions
		self.net_payable = float(self.gross_this_bill or 0) - deductions + additions

	# ============================================================
	# Status
	# ============================================================

	def set_billing_status(self):
		self.billing_status = self._compute_billing_status()

	def _compute_billing_status(self):
		if self.docstatus == 2:
			return "Cancelled"
		if self.docstatus == 0:
			return "Draft"
		invoiced = float(self.invoiced_amount or 0)
		net = float(self.net_payable or 0)
		if net <= 0 or invoiced <= 0:
			return "Submitted"
		if invoiced + 0.01 < net:
			return "Partially Invoiced"
		return "Fully Invoiced"

	# ============================================================
	# before_submit deviation enforcement
	# ============================================================

	def enforce_deviation_limits(self):
		offenders = []
		for row in (self.items or []):
			est = float(row.estimated_qty or 0)
			cum = float(row.cumulative_qty or 0)
			limit_pct = float(row.deviation_limit_pct or 0)
			if est <= 0:
				continue
			ceiling = est * (1 + limit_pct / 100.0)
			if cum > ceiling + 0.0001:
				offenders.append((row.idx, row.description, cum, ceiling, limit_pct))
		if offenders:
			lines = "\n".join(
				f"  Row {idx} ({desc}): cum {cum} > ceiling {ceiling:.3f} ({limit}% over BOQ)"
				for (idx, desc, cum, ceiling, limit) in offenders
			)
			frappe.throw(_(
				"Deviation limit exceeded on the following lines. "
				"Raise an Amendment before submitting this bill.\n{0}"
			).format(lines))

	def enforce_recovery_caps_against_register(self):
		if not self.civil_work_order:
			return
		bill_mob = sum(
			float(r.amount or 0) for r in (self.deductions or [])
			if r.nature == "Mobilization Recovery"
		)
		bill_mat = sum(
			float(r.amount or 0) for r in (self.deductions or [])
			if r.nature == "Material Recovery"
		)
		if bill_mob > 0:
			outstanding = get_outstanding_balance(self.civil_work_order, "Mobilization")
			if bill_mob > outstanding + 0.01:
				frappe.throw(_(
					"Mobilization recovery on this bill ({0}) exceeds outstanding mob "
					"balance on the Advance Register ({1})."
				).format(bill_mob, outstanding))
		if bill_mat > 0:
			outstanding = get_outstanding_balance(self.civil_work_order, "Material")
			if bill_mat > outstanding + 0.01:
				frappe.throw(_(
					"Material recovery on this bill ({0}) exceeds outstanding mat "
					"balance on the Advance Register ({1})."
				).format(bill_mat, outstanding))

	# ============================================================
	# on_submit / on_cancel - Advance Register sync
	# ============================================================

	def post_recoveries_to_register(self):
		if not self.civil_work_order:
			return
		recoveries_to_post = [
			r for r in (self.deductions or [])
			if r.nature in ("Mobilization Recovery", "Material Recovery")
			and float(r.amount or 0) > 0
		]
		if not recoveries_to_post:
			return

		register = get_or_create_register(self.civil_work_order)
		for r in recoveries_to_post:
			advance_type = "Mobilization" if r.nature == "Mobilization Recovery" else "Material"
			register.append("recoveries", {
				"recovery_date": self.bill_date,
				"advance_type": advance_type,
				"amount": float(r.amount),
				"ra_bill": self.name,
				"remarks": f"Auto-posted from RA Bill {self.name}",
			})
		register.save(ignore_permissions=True)

	def reverse_recoveries_on_register(self):
		if not self.civil_work_order:
			return
		reg_name = frappe.db.exists(
			"Work Order Advance Register", {"civil_work_order": self.civil_work_order}
		)
		if not reg_name:
			return
		register = frappe.get_doc("Work Order Advance Register", reg_name)
		before = len(register.recoveries or [])
		register.recoveries = [r for r in (register.recoveries or []) if r.ra_bill != self.name]
		if len(register.recoveries) != before:
			register.save(ignore_permissions=True)

	# ============================================================
	# Step 6: Purchase Invoice integration - invoiced_amount tracker
	# ============================================================

	def refresh_invoiced_amount(self):
		"""Recompute invoiced_amount and per_invoiced by walking submitted
		Purchase Invoice Items that reference this RA Bill. Called from the
		PI on_submit/on_cancel hooks. Uses db_set so this is safe to call
		from any document state."""
		total = frappe.db.sql("""
			SELECT IFNULL(SUM(pii.amount), 0) AS total
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
			WHERE pii.wo_ra_bill = %s
			  AND pi.docstatus = 1
		""", (self.name,))[0][0] or 0
		invoiced = float(total)
		net = float(self.net_payable or 0)
		pct = (invoiced / net * 100.0) if net > 0 else 0
		new_status = self._compute_billing_status_with_invoiced(invoiced, net)

		self.db_set("invoiced_amount", invoiced, update_modified=False)
		self.db_set("per_invoiced", pct, update_modified=False)
		self.db_set("billing_status", new_status, update_modified=False)

	def _compute_billing_status_with_invoiced(self, invoiced, net):
		"""Variant of billing status computation that uses an externally
		recomputed invoiced amount (not the in-memory self.invoiced_amount,
		which may be stale during hook calls)."""
		if self.docstatus == 2:
			return "Cancelled"
		if self.docstatus == 0:
			return "Draft"
		if net <= 0 or invoiced <= 0:
			return "Submitted"
		if invoiced + 0.01 < net:
			return "Partially Invoiced"
		return "Fully Invoiced"

	@frappe.whitelist()
	def close_ra_bill(self):
		"""Manually mark a partially-invoiced RA Bill as Closed (no further
		invoicing expected). Phase 1: this method exists as a stub; the UI
		button + finance-policy guardrails ship in a later step."""
		frappe.throw(_(
			"close_ra_bill() is not yet implemented. RA Bills move to Closed "
			"status only via finance-approved write-off in a later phase."
		))
