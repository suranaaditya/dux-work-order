# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class CivilWorksSettings(Document):
	def validate(self):
		on_final = self.default_retention_release_on_final_bill or 0
		after_dlp = self.default_retention_release_after_dlp or 0
		total = on_final + after_dlp
		if abs(total - 100) > 0.001:
			frappe.throw(_(
				"Retention release percentages must sum to 100. "
				"Currently: Final Bill {0}% + After DLP {1}% = {2}%"
			).format(on_final, after_dlp, total))
