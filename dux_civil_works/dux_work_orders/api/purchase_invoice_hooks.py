# Copyright (c) 2026, Dutch Digitech and contributors
# doc_events handlers for Purchase Invoice <-> Work Order RA Bill linkage.

import frappe
from frappe import _


# ============================================================
# Project dimension: Work Order Contract -> project -> item rows
# ============================================================
# Both of these run in before_validate, and the ORDER MATTERS.
#
# Frappe runs before_validate BEFORE validate (frappe/model/document.py
# run_before_save_methods). Filling the header project in validate while
# cascading to items in before_validate would cascade an empty value and
# leave every item row blank — so the fill has to happen first, here.
#
# The cascade is not cosmetic. ERPNext computes Project.total_purchase_cost
# from Purchase Invoice ITEM.project:
#
#     .select(Sum(pitem.base_net_amount))
#     .where((pitem.project == project) & (pitem.docstatus == 1))
#
# A header-only project leaves that rollup at zero. GL Entries are the
# opposite — get_gl_dict seeds every row with the HEADER project — so both
# levels have to carry it for the dimension to be trustworthy.
#
# Mirrors the cascade in Stock Entry.before_validate.


def pi_before_validate(doc, method=None):
	_fill_project_from_work_order(doc)
	_cascade_project_to_items(doc)


def _fill_project_from_work_order(doc):
	"""Seed a BLANK project from the linked Work Order.

	A project the user typed always wins — this only ever fills an empty
	field, never corrects one. Server-side so the REST API, data import and
	the Desk form all behave identically; the client script mirrors it purely
	for immediate feedback.
	"""
	if not doc.get("work_order_contract"):
		return
	if doc.get("project"):
		return
	wo_project = frappe.db.get_value(
		"Work Order Contract", doc.get("work_order_contract"), "project"
	)
	if wo_project:
		doc.project = wo_project


def _cascade_project_to_items(doc):
	"""Copy the header project onto every item row that has not got one.

	Rows where somebody set a different project are left alone — an invoice
	may legitimately split across projects at the line level.
	"""
	if not doc.get("project"):
		return
	for item in (doc.get("items") or []):
		if not item.get("project"):
			item.project = doc.project


def _validate_work_order_company(doc):
	"""The linked Work Order must belong to the invoice's company."""
	wo = doc.get("work_order_contract")
	if not wo:
		return
	wo_company = frappe.db.get_value("Work Order Contract", wo, "company")
	if wo_company and doc.company and wo_company != doc.company:
		frappe.throw(
			_(
				"Work Order {0} belongs to company {1}, but this invoice is for {2}. "
				"An invoice can only reference a Work Order from its own company."
			).format(frappe.bold(wo), frappe.bold(wo_company), frappe.bold(doc.company)),
			title=_("Work Order company mismatch"),
		)


def pi_validate(doc, method=None):
	"""Run on every Purchase Invoice save.

	Two independent concerns share this hook:
	  1. the linked Work Order must belong to this invoice's company;
	  2. if this PI references RA Bills, enforce the net-payable cap unless an
	     Accounts Manager (or System Manager) has provided an override reason.

	(1) applies to every invoice, so it runs before the RA-bill early return.
	"""
	_validate_work_order_company(doc)

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
