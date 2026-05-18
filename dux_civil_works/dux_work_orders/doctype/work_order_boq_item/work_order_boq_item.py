# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import uuid

import frappe
from frappe.model.document import Document


class WorkOrderBOQItem(Document):
	def before_insert(self):
		"""Auto-generate UUID for new BOQ rows.

		Stable across Work Order amendments — RA Bill Items reference
		this UID, not the row name, so cumulative quantity history
		survives amendments.
		"""
		if not self.boq_row_uid:
			self.boq_row_uid = str(uuid.uuid4())
