# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


VARIANCE_WARNING_PCT = 2.0  # warn (don't block) if BOQ total deviates more than this from WO total


class CivilWorkOrderBOQ(Document):
	def validate(self):
		self.validate_wo_is_submitted()
		self.set_default_deviation_limits()
		self.set_line_amounts()
		self.set_boq_total()
		self.validate_summary_heads_exist_on_wo()
		self.validate_boq_summary_heads_are_service_items()
		self.set_variance()

	def before_submit(self):
		self.warn_on_large_variance()

	# ---- helpers ----

	def validate_wo_is_submitted(self):
		if not self.civil_work_order:
			return
		wo_docstatus = frappe.db.get_value("Civil Work Order", self.civil_work_order, "docstatus")
		if wo_docstatus != 1:
			frappe.throw(_(
				"Linked Civil Work Order {0} must be Submitted before a BOQ can be saved against it. "
				"Current status: {1}"
			).format(self.civil_work_order,
					 {0: "Draft", 2: "Cancelled"}.get(wo_docstatus, wo_docstatus)))

	def set_default_deviation_limits(self):
		# Pull default from Civil Works Settings if a line has no explicit limit
		default_limit = None
		try:
			default_limit = frappe.db.get_single_value(
				"Civil Works Settings", "default_boq_deviation_limit_pct"
			)
		except Exception:
			pass
		if default_limit is None:
			return
		for row in (self.boq_items or []):
			if row.deviation_limit_pct in (None, 0):
				row.deviation_limit_pct = default_limit

	def set_line_amounts(self):
		for row in (self.boq_items or []):
			qty = float(row.estimated_qty or 0)
			rate = float(row.rate or 0)
			row.amount = qty * rate

	def set_boq_total(self):
		self.boq_total_amount = sum(float(r.amount or 0) for r in (self.boq_items or []))

	def validate_summary_heads_exist_on_wo(self):
		if not self.civil_work_order or not self.boq_items:
			return
		wo_heads = {
			r.summary_head
			for r in frappe.get_all(
				"Civil Work Order Summary Item",
				filters={"parent": self.civil_work_order},
				fields=["summary_head"],
			)
		}
		for idx, row in enumerate(self.boq_items, start=1):
			if not row.summary_head:
				frappe.throw(_("Row {0}: Summary Head is required.").format(idx))
			if row.summary_head not in wo_heads:
				frappe.throw(_(
					"Row {0}: Summary Head '{1}' does not exist on Work Order {2}. "
					"Valid heads: {3}"
				).format(idx, row.summary_head, self.civil_work_order,
						 ", ".join(sorted(wo_heads)) or "(none)"))

	def validate_boq_summary_heads_are_service_items(self):
		"""Defensive check: each BOQ row's summary_head must be a service Item."""
		if not self.boq_items:
			return
		for idx, row in enumerate(self.boq_items, start=1):
			if not row.summary_head:
				continue
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

	def set_variance(self):
		wo_total = float(self.wo_total_amount or 0)
		boq_total = float(self.boq_total_amount or 0)
		self.variance_amount = boq_total - wo_total
		if wo_total:
			self.variance_pct = (self.variance_amount / wo_total) * 100
		else:
			self.variance_pct = 0

	def warn_on_large_variance(self):
		if abs(self.variance_pct or 0) > VARIANCE_WARNING_PCT:
			frappe.msgprint(
				_("BOQ total varies from WO total by {0}% (threshold {1}%). "
				  "Submitting anyway — confirm this is intentional.").format(
					round(self.variance_pct, 2), VARIANCE_WARNING_PCT
				),
				title=_("Variance warning"),
				indicator="orange",
			)

	def on_submit(self):
		# Hook point for Phase 2 freeze logic. Once submitted, the BOQ is the
		# contractual reference for measurements and RA bills.
		pass

	def on_cancel(self):
		# Hook point for cascade behavior on BOQ cancel (e.g., block if any
		# RA Bill exists). Implemented in a later step.
		pass
