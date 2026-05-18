# Copyright (c) 2026, Dux Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class WorkOrderContract(Document):
	def validate(self):
		self.set_total_amount()
		self.validate_summary_items()
		self.validate_summary_items_are_service_items()
		self.validate_retention_release_split()
		self.validate_schedule_dates()

	def before_insert(self):
		# On a brand-new document only, prefill terms from Work Order Settings
		# so the user sees sensible defaults but can override before save.
		# Skip if any term field is already set (e.g., when amending an existing WO).
		if self.amended_from:
			return
		self.prefill_terms_from_settings()

	def set_total_amount(self):
		total = 0.0
		for row in (self.summary_items or []):
			total += float(row.amount or 0)
		self.total_amount = total

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
		}
		for wo_field, settings_field in mapping.items():
			# Only prefill if the WO field isn't already set (respect explicit user input)
			if not self.get(wo_field):
				value = settings.get(settings_field)
				if value is not None:
					self.set(wo_field, value)

	def on_submit(self):
		# Hook point for Phase 2 BOQ-freeze logic.
		# Phase 1: just record the submission. Nothing else to do yet.
		pass

	def on_cancel(self):
		# Hook point for cascade behavior on cancel (Phase 2+).
		pass
