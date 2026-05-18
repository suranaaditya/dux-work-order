# Copyright (c) 2026, Dutch Digitech and contributors
# Server-side API methods for Purchase Invoice <-> Work Order RA Bill integration.
#
# Architecture:
# - get_open_ra_bills: returns RA Bills available for invoicing, filtered by Company + Supplier
# - get_items_from_ra_bills: groups RA Bill items by summary_head Item, produces ONE PI line
#   per distinct Item per source RA Bill, with description aggregating BOQ row details
# - get_referenced_ra_bills_summary: read-only summary for the PI form's display field

import frappe
from frappe import _
from collections import defaultdict


@frappe.whitelist()
def get_open_ra_bills(company, supplier):
	"""Return submitted Work Order RA Bills for the given Company + Supplier
	that are not yet Fully Invoiced or Closed."""
	if not (company and supplier):
		return []
	bills = frappe.get_all(
		"Work Order RA Bill",
		filters={
			"company": company,
			"supplier": supplier,
			"docstatus": 1,
			"billing_status": ["not in", ["Fully Invoiced", "Closed", "Cancelled"]],
		},
		fields=[
			"name", "civil_work_order", "work_title", "bill_number",
			"bill_date", "net_payable", "invoiced_amount", "per_invoiced",
			"billing_status",
		],
		order_by="bill_date desc, name desc",
	)
	for b in bills:
		b["remaining_to_invoice"] = (b.get("net_payable") or 0) - (b.get("invoiced_amount") or 0)
	return bills


@frappe.whitelist()
def get_items_from_ra_bills(ra_bill_names):
	"""Pull chargeable items from selected submitted RA Bills, GROUPED by
	summary_head Item. Produces ONE PI line per distinct summary_head Item
	per RA Bill (a single RA Bill spanning 3 summary heads = 3 PI lines).

	Each PI line's description aggregates the underlying BOQ row details so
	the contractor's invoice maps cleanly to certified work. The PI line's
	qty=1, uom=Nos, rate=allocated_net_amount because the underlying detail
	is in the description, not in line-level qty/uom (these are suppressed
	in print per the print format design philosophy in CLAUDE.md).
	"""
	if isinstance(ra_bill_names, str):
		import json
		ra_bill_names = json.loads(ra_bill_names)
	if not ra_bill_names:
		return []

	pi_lines = []
	for ra_bill_name in ra_bill_names:
		bill = frappe.get_doc("Work Order RA Bill", ra_bill_name)
		if bill.docstatus != 1:
			frappe.throw(_("RA Bill {0} is not in Submitted state.").format(ra_bill_name))
		if bill.billing_status in ("Fully Invoiced", "Closed", "Cancelled"):
			frappe.throw(_(
				"RA Bill {0} cannot be invoiced from (status: {1})."
			).format(ra_bill_name, bill.billing_status))

		gross = float(bill.gross_this_bill or 0)
		net = float(bill.net_payable or 0)
		if gross <= 0:
			continue

		# Group chargeable lines by summary_head Item
		chargeable_lines = [li for li in bill.items if (li.this_bill_qty or 0) > 0]
		if not chargeable_lines:
			continue

		groups = defaultdict(list)
		for li in chargeable_lines:
			groups[li.summary_head].append(li)

		# For each group, produce ONE PI line
		for summary_head_item, lines in groups.items():
			group_gross = sum(float(li.this_bill_amount or 0) for li in lines)
			# Allocate net proportionally to this group's share of the bill's gross
			allocated_net = round(net * (group_gross / gross), 2) if gross > 0 else 0

			description = _build_aggregated_description(
				summary_head_item, bill, lines, allocated_net
			)

			# Look up the Item's default expense account if configured
			default_expense_account = _get_item_default_expense_account(
				summary_head_item, bill.company
			)

			pi_lines.append({
				"item_code": summary_head_item,    # the service Item from Work Order Items group
				"item_name": summary_head_item,
				"description": description,
				"qty": 1,                          # always 1 - actual quantities live in description
				"uom": "Nos",                      # service Items' stock_uom; suppressed in print
				"rate": allocated_net,
				"amount": allocated_net,
				"expense_account": default_expense_account or None,
				"wo_ra_bill": bill.name,
				# wo_ra_bill_item carries comma-joined source RA Bill Item row names
				# for full traceability (one PI line covers multiple BOQ rows)
				"wo_ra_bill_item": ",".join([li.name for li in lines]),
			})
	return pi_lines


def _build_aggregated_description(summary_head_item, bill, lines, allocated_net):
	"""Build a multi-line description for the PI line aggregating all BOQ
	rows under this summary head on this RA Bill. Truncates if more than 5."""
	period_str = ""
	if bill.period_from and bill.period_to:
		period_str = f" (period {bill.period_from} to {bill.period_to})"

	header = f"{summary_head_item} - RA Bill {bill.name}{period_str}"
	rows_to_show = lines[:5]
	detail_lines = []
	for li in rows_to_show:
		item_no_part = f"{li.item_no} " if li.item_no else ""
		detail_lines.append(
			f"- {item_no_part}{li.description}: "
			f"{li.this_bill_qty} {li.uom} @ Rs.{li.rate} = Rs.{li.this_bill_amount:.2f}"
		)

	truncation_note = ""
	if len(lines) > 5:
		remaining = lines[5:]
		remaining_total = sum(float(li.this_bill_amount or 0) for li in remaining)
		truncation_note = (
			f"... and {len(remaining)} more rows totaling Rs.{remaining_total:.2f}"
		)

	parts = [header] + detail_lines
	if truncation_note:
		parts.append(truncation_note)
	parts.append(f"Allocated net amount: Rs.{allocated_net:.2f}")
	return "\n".join(parts)


def _get_item_default_expense_account(item_code, company):
	"""Look up the Item's default expense account for the given Company.
	Returns None if not configured - accountant must fill manually."""
	if not (item_code and company):
		return None
	# Items have a child table item_defaults with company-specific accounts
	result = frappe.db.sql("""
		SELECT expense_account
		FROM `tabItem Default`
		WHERE parent = %s AND company = %s AND IFNULL(expense_account, '') != ''
		LIMIT 1
	""", (item_code, company), as_dict=True)
	return result[0].expense_account if result else None


@frappe.whitelist()
def get_referenced_ra_bills_summary(pi_name):
	"""For a given PI name, return distinct RA Bills referenced and the
	sum of amounts allocated against each. Used by the PI form to populate
	the wo_ra_bills_referenced summary text field."""
	rows = frappe.db.sql("""
		SELECT pii.wo_ra_bill, SUM(pii.amount) AS total_amount
		FROM `tabPurchase Invoice Item` pii
		WHERE pii.parent = %s AND IFNULL(pii.wo_ra_bill, '') != ''
		GROUP BY pii.wo_ra_bill
		ORDER BY pii.wo_ra_bill
	""", (pi_name,), as_dict=True)
	return rows
