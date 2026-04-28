# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class CivilAdvanceRegister(Document):
	def validate(self):
		self.validate_wo_is_submitted()
		self.enforce_uniqueness()
		self.compute_balances()
		self.validate_recovery_does_not_exceed_paid()

	def validate_wo_is_submitted(self):
		if not self.civil_work_order:
			return
		wo_docstatus = frappe.db.get_value(
			"Civil Work Order", self.civil_work_order, "docstatus"
		)
		if wo_docstatus != 1:
			frappe.throw(_(
				"Linked Civil Work Order {0} must be Submitted before an "
				"Advance Register can be saved against it."
			).format(self.civil_work_order))

	def enforce_uniqueness(self):
		if not (self.civil_work_order and self.company and self.supplier):
			return
		existing = frappe.db.exists(
			"Civil Advance Register",
			{
				"civil_work_order": self.civil_work_order,
				"company": self.company,
				"supplier": self.supplier,
				"name": ["!=", self.name or ""],
			},
		)
		if existing:
			frappe.throw(_(
				"An Advance Register already exists for this Work Order: {0}. "
				"Edit that one instead of creating a duplicate."
			).format(existing))

	def compute_balances(self):
		mob_paid = sum(
			float(t.amount or 0) for t in (self.tranches or [])
			if t.advance_type == "Mobilization"
		)
		mat_paid = sum(
			float(t.amount or 0) for t in (self.tranches or [])
			if t.advance_type == "Material"
		)
		mob_rec = sum(
			float(r.amount or 0) for r in (self.recoveries or [])
			if r.advance_type == "Mobilization"
		)
		mat_rec = sum(
			float(r.amount or 0) for r in (self.recoveries or [])
			if r.advance_type == "Material"
		)

		self.mobilization_paid = mob_paid
		self.mobilization_recovered = mob_rec
		self.mobilization_outstanding = mob_paid - mob_rec

		self.material_paid = mat_paid
		self.material_recovered = mat_rec
		self.material_outstanding = mat_paid - mat_rec

		self.total_paid = mob_paid + mat_paid
		self.total_recovered = mob_rec + mat_rec
		self.total_outstanding = self.total_paid - self.total_recovered

	def validate_recovery_does_not_exceed_paid(self):
		if (self.mobilization_outstanding or 0) < 0:
			frappe.throw(_(
				"Mobilization recoveries ({0}) exceed mobilization advances paid ({1}). "
				"Outstanding cannot be negative."
			).format(self.mobilization_recovered, self.mobilization_paid))
		if (self.material_outstanding or 0) < 0:
			frappe.throw(_(
				"Material recoveries ({0}) exceed material advances paid ({1}). "
				"Outstanding cannot be negative."
			).format(self.material_recovered, self.material_paid))


# ---- module-level helpers for use by RA Bill (Step 5b) ----

def get_or_create_register(civil_work_order):
	"""Return existing register for the WO, or create a new one in Draft."""
	existing = frappe.db.exists(
		"Civil Advance Register", {"civil_work_order": civil_work_order}
	)
	if existing:
		return frappe.get_doc("Civil Advance Register", existing)

	wo = frappe.get_doc("Civil Work Order", civil_work_order)
	reg = frappe.new_doc("Civil Advance Register")
	reg.civil_work_order = civil_work_order
	reg.company = wo.company
	reg.supplier = wo.supplier
	reg.insert(ignore_permissions=True)
	return reg


def get_outstanding_balance(civil_work_order, advance_type):
	"""Return the current outstanding balance for an advance type on a WO."""
	reg_name = frappe.db.exists(
		"Civil Advance Register", {"civil_work_order": civil_work_order}
	)
	if not reg_name:
		return 0
	field_map = {
		"Mobilization": "mobilization_outstanding",
		"Material": "material_outstanding",
	}
	fieldname = field_map.get(advance_type)
	if not fieldname:
		return 0
	return float(frappe.db.get_value("Civil Advance Register", reg_name, fieldname) or 0)
