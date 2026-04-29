# Copyright (c) 2026, Dutch Digitech and contributors
# doc_events handlers for Purchase Invoice <-> Work Order RA Bill linkage.

import frappe
from frappe import _


def pi_validate(doc, method=None):
	"""Run on every Purchase Invoice save. If this PI references RA Bills,
	enforce the net-payable cap unless an Accounts Manager (or System Manager)
	has provided an override reason."""
	if not getattr(doc, "is_wo_ra_bill_invoice", 0):
		return

	on_this_pi = {}
	for line in (doc.items or []):
		ra_bill = getattr(line, "wo_ra_bill", None)
		if not ra_bill:
			continue
		on_this_pi[ra_bill] = on_this_pi.get(ra_bill, 0) + float(line.amount or 0)

	if not on_this_pi:
		return

	# Update the read-only summary text field
	doc.wo_ra_bills_referenced = ", ".join(
		f"{rb}: Rs.{amt:.2f}" for rb, amt in sorted(on_this_pi.items())
	)

	overflows = []
	for ra_bill, this_pi_amount in on_this_pi.items():
		bill = frappe.get_doc("Work Order RA Bill", ra_bill)
		if bill.docstatus != 1:
			frappe.throw(_(
				"RA Bill {0} must be Submitted to invoice against."
			).format(ra_bill))

		# Sum invoiced amount across all OTHER submitted PIs (exclude this one)
		other_invoiced = frappe.db.sql("""
			SELECT IFNULL(SUM(pii.amount), 0)
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
			WHERE pii.wo_ra_bill = %s
			  AND pi.docstatus = 1
			  AND pi.name != %s
		""", (ra_bill, doc.name or ""))[0][0] or 0

		total_after_this = float(other_invoiced) + this_pi_amount
		net = float(bill.net_payable or 0)
		if total_after_this > net + 0.01:
			overflows.append((ra_bill, total_after_this, net))

	if overflows:
		is_acc_mgr = (
			"Accounts Manager" in frappe.get_roles(frappe.session.user)
			or "System Manager" in frappe.get_roles(frappe.session.user)
		)
		has_reason = bool((doc.wo_ra_bill_override_reason or "").strip())

		if is_acc_mgr and has_reason:
			for ra_bill, total, net in overflows:
				frappe.msgprint(_(
					"Override accepted: RA Bill {0} will be invoiced for Rs.{1:.2f}, "
					"exceeding net payable Rs.{2:.2f}. Reason recorded."
				).format(ra_bill, total, net), indicator="orange", title=_("Cap Override"))
			return

		lines = "\n".join(
			f"  {rb}: total invoiced after this PI Rs.{total:.2f} > net payable Rs.{net:.2f}"
			for (rb, total, net) in overflows
		)
		frappe.throw(_(
			"Total invoiced amount exceeds RA Bill net payable on the following bills:\n{0}\n\n"
			"Either reduce this PI's line amounts, or - if an override is intentional - "
			"fill in 'Net Payable Cap Override Reason' AND submit as a user with the "
			"Accounts Manager role."
		).format(lines))


def pi_on_submit(doc, method=None):
	"""Recompute invoiced_amount and billing_status on every RA Bill that
	this PI references."""
	_refresh_referenced_ra_bills(doc)


def pi_on_cancel(doc, method=None):
	"""Same as on_submit - the math walks submitted PIs only, so cancelling
	naturally subtracts this PI's contribution."""
	_refresh_referenced_ra_bills(doc)


def _refresh_referenced_ra_bills(doc):
	referenced = set()
	for line in (doc.items or []):
		ra_bill = getattr(line, "wo_ra_bill", None)
		if ra_bill:
			referenced.add(ra_bill)
	for ra_bill_name in referenced:
		try:
			bill = frappe.get_doc("Work Order RA Bill", ra_bill_name)
			bill.refresh_invoiced_amount()
		except Exception:
			frappe.log_error(
				title=f"Failed to refresh invoiced_amount for {ra_bill_name}",
				message=frappe.get_traceback(),
			)
