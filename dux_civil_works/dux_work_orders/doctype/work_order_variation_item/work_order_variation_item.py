# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import uuid

import frappe
from frappe.model.document import Document


class WorkOrderVariationItem(Document):
	def before_insert(self):
		"""Auto-generate UUID for new variation lines.

		Each variation line carries its own boq_row_uid, distinct from any
		original BOQ row's UID. RA Bill Items will reference this UID when
		billing against the variation scope (see DESIGN.md 4.7). Mirrors
		Work Order BOQ Item.before_insert — assigned here as a standalone
		safety net for the case where rows are inserted via
		child_doc.insert(); the parent's validate() also assigns UIDs for
		the more common case of rows added via parent.append() + save
		(Frappe child before_insert does not reliably fire during parent
		save — see CLAUDE.md 'Embedded BOQ child hooks' learning).
		"""
		if not self.boq_row_uid:
			self.boq_row_uid = str(uuid.uuid4())
