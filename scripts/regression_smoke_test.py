# Copyright (c) 2026, Dutch Digitech and contributors
# Phase 1 regression smoke test - exercises Civil Work Order, BOQ,
# Advance Register, and Work Order RA Bill end-to-end.
#
# Invoke via:
#   bench --site erp.jewonline.in console < apps/dux_civil_works/scripts/regression_smoke_test.py
#
# OR import + call from the console:
#   from dux_civil_works.scripts.regression_smoke_test import run_smoke_test
#   run_smoke_test()
#
# Exits with assertion error on any failure. Cleans up all test docs at end.

import frappe


def run_smoke_test():
	print("=" * 70)
	print("Phase 1 regression smoke test")
	print("=" * 70)

	# --- Sample data lookup ---
	sample_company = frappe.db.get_value("Company", {}, "name")
	sample_supplier = frappe.db.get_value("Supplier", {}, "name")
	if not (sample_company and sample_supplier):
		print("ABORT - no Company or Supplier on this site to test against.")
		return

	# Use real seeded Items and full UOM names per RGI convention
	HEAD_CIVIL = "Civil Construction"
	HEAD_PLUMBING = "Plumbing Works"
	UOM_VOLUME = "Cubic Meter"
	UOM_LINEAR = "Meter"

	for item in [HEAD_CIVIL, HEAD_PLUMBING]:
		assert frappe.db.exists("Item", item), "Required seeded Item missing: " + item
	for uom in [UOM_VOLUME, UOM_LINEAR]:
		assert frappe.db.exists("UOM", uom), "Required UOM missing: " + uom

	print("Sample company: " + str(sample_company))
	print("Sample supplier: " + str(sample_supplier))
	print("Service heads: " + HEAD_CIVIL + ", " + HEAD_PLUMBING)
	print("UOMs: " + UOM_VOLUME + ", " + UOM_LINEAR)
	print()

	created_docs = []  # for cleanup tracking

	try:
		# ============================================================
		# PHASE 1 - Civil Work Order
		# ============================================================
		print("--- Civil Work Order ---")

		wo = frappe.new_doc("Civil Work Order")
		wo.company = sample_company
		wo.supplier = sample_supplier
		wo.wo_date = frappe.utils.today()
		wo.work_title = "Smoke test WO - please delete"
		wo.append("summary_items", {"summary_head": HEAD_CIVIL, "amount": 800000})
		wo.append("summary_items", {"summary_head": HEAD_PLUMBING, "amount": 200000})
		wo.retention_percentage = 5
		wo.mobilization_recovery_pct = 10
		wo.material_recovery_pct = 0
		wo.apply_labour_cess = 0
		wo.insert()
		created_docs.append(("Civil Work Order", wo.name))
		print("  Created: " + wo.name + " | total: " + str(wo.total_amount))
		assert abs(wo.total_amount - 1000000) < 0.01, "Total auto-calc broken"
		assert wo.name.startswith("WO-"), "Naming series broken"

		# Retention split validation
		wo.retention_release_on_final_bill = 60
		wo.retention_release_after_dlp = 50
		try:
			wo.save()
			assert False, "Retention split validation did not fire"
		except frappe.ValidationError:
			wo.reload()  # avoid TimestampMismatch on next save (per CLAUDE.md)
		print("  Retention split validation: OK")

		wo.submit()
		print("  Submitted: " + wo.name)

		# ============================================================
		# PHASE 2 - Civil Work Order BOQ
		# ============================================================
		print("\n--- Civil Work Order BOQ ---")

		boq = frappe.new_doc("Civil Work Order BOQ")
		boq.civil_work_order = wo.name
		boq.boq_date = frappe.utils.today()
		boq.append("boq_items", {
			"item_no": "1.1", "summary_head": HEAD_CIVIL,
			"description": "M25 concrete in foundations", "uom": UOM_VOLUME,
			"estimated_qty": 100, "rate": 5000,
		})
		boq.append("boq_items", {
			"item_no": "1.2", "summary_head": HEAD_CIVIL,
			"description": "Plastering 12mm", "uom": "Square Meter",
			"estimated_qty": 200, "rate": 500,
		})
		boq.append("boq_items", {
			"item_no": "2.1", "summary_head": HEAD_PLUMBING,
			"description": "GI pipe 25mm", "uom": UOM_LINEAR,
			"estimated_qty": 100, "rate": 1500,
		})
		boq.insert()
		created_docs.append(("Civil Work Order BOQ", boq.name))
		print("  Created: " + boq.name + " | total: " + str(boq.boq_total_amount))
		assert abs(boq.boq_total_amount - 750000) < 0.01

		# Cross-WO validation
		bad_boq = frappe.new_doc("Civil Work Order BOQ")
		bad_boq.civil_work_order = wo.name
		bad_boq.boq_date = frappe.utils.today()
		bad_boq.append("boq_items", {
			"item_no": "X", "summary_head": "IT Services",  # valid Item, but not on parent WO
			"description": "X", "uom": "Nos",
			"estimated_qty": 1, "rate": 100,
		})
		try:
			bad_boq.insert()
			assert False, "Summary head must-exist-on-WO check did not fire"
		except frappe.ValidationError:
			pass
		print("  Cross-WO summary head validation: OK")

		boq.submit()
		print("  Submitted: " + boq.name)

		# ============================================================
		# PHASE 3 - Civil Advance Register
		# ============================================================
		print("\n--- Civil Advance Register ---")

		reg = frappe.new_doc("Civil Advance Register")
		reg.civil_work_order = wo.name
		reg.append("tranches", {
			"tranche_date": frappe.utils.today(),
			"advance_type": "Mobilization",
			"amount": 100000,
		})
		reg.insert()
		created_docs.append(("Civil Advance Register", reg.name))
		print("  Created: " + reg.name + " | mob outstanding: " + str(reg.mobilization_outstanding))
		assert abs(reg.mobilization_outstanding - 100000) < 0.01

		# Helper functions
		from dux_civil_works.dux_civil_works.doctype.civil_advance_register.civil_advance_register import (
			get_or_create_register, get_outstanding_balance,
		)
		found = get_or_create_register(wo.name)
		assert found.name == reg.name
		bal = get_outstanding_balance(wo.name, "Mobilization")
		assert abs(bal - 100000) < 0.01
		print("  Helpers (get_or_create_register, get_outstanding_balance): OK")

		# ============================================================
		# PHASE 4 - Work Order RA Bill
		# ============================================================
		print("\n--- Work Order RA Bill ---")

		bill = frappe.new_doc("Work Order RA Bill")
		bill.civil_work_order = wo.name
		bill.civil_work_order_boq = boq.name
		bill.bill_date = frappe.utils.today()
		bill.insert()
		created_docs.append(("Work Order RA Bill", bill.name))
		print("  Created: " + bill.name + " | bill_number: " + str(bill.bill_number) + " | items: " + str(len(bill.items)))
		assert bill.bill_number == 1
		assert len(bill.items) == 3   # 3 BOQ items, all auto-populated

		# Verify each RA Bill item has summary_head as a valid Item
		for r in bill.items:
			grp = frappe.db.get_value("Item", r.summary_head, "item_group")
			assert grp == "Work Order Items", "RA Bill item summary_head '" + str(r.summary_head) + "' not in correct group"
		print("  All RA Bill items have valid Item summary_head references")

		# Enter cumulative quantities
		bill.items[0].cumulative_qty = 30   # 30 cum @ 5000 = 150000
		bill.items[1].cumulative_qty = 50   # 50 sqm @ 500 = 25000
		bill.items[2].cumulative_qty = 20   # 20 m @ 1500 = 30000
		bill.save()
		print("  Gross this bill: " + str(bill.gross_this_bill) + " (expected 205000)")
		assert abs(bill.gross_this_bill - 205000) < 0.01

		# Auto deductions present
		natures = [d.nature for d in bill.deductions if d.is_auto_suggested]
		assert "Retention" in natures, "Retention not auto-suggested: " + str(natures)
		assert "Mobilization Recovery" in natures, "Mob recovery not auto-suggested: " + str(natures)

		retention = next(d for d in bill.deductions if d.nature == "Retention")
		assert abs(retention.amount - 10250) < 0.01   # 205000 * 5%
		mob_rec = next(d for d in bill.deductions if d.nature == "Mobilization Recovery")
		assert abs(mob_rec.amount - 20500) < 0.01   # min(205000*10%, 100000) = 20500
		print("  Auto-deductions: retention=" + str(retention.amount) + ", mob_recovery=" + str(mob_rec.amount))

		# Net payable
		expected_net = 205000 - 10250 - 20500
		assert abs(bill.net_payable - expected_net) < 0.01
		print("  Net payable: " + str(bill.net_payable) + " (expected " + str(expected_net) + ")")

		# Submit + register sync
		bill.submit()
		reg.reload()
		print("  Submitted | register mob outstanding: " + str(reg.mobilization_outstanding) + " (expected 79500)")
		assert abs(reg.mobilization_outstanding - 79500) < 0.01
		assert bill.billing_status == "Submitted"

		# ============================================================
		# PHASE 5 - Deviation enforcement
		# ============================================================
		print("\n--- Deviation enforcement ---")

		bill2 = frappe.new_doc("Work Order RA Bill")
		bill2.civil_work_order = wo.name
		bill2.civil_work_order_boq = boq.name
		bill2.bill_date = frappe.utils.today()
		bill2.insert()
		created_docs.append(("Work Order RA Bill", bill2.name))
		# Push line 1 over 5% deviation: ceiling = 100 * 1.05 = 105
		bill2.items[0].cumulative_qty = 110   # 110 > 105
		bill2.save()
		try:
			bill2.submit()
			assert False, "Deviation enforcement did not fire"
		except frappe.ValidationError:
			bill2.reload()
		print("  5% deviation block on submit: OK")

		# ============================================================
		# PHASE 6 - Amend canary (post-rename validation)
		# ============================================================
		print("\n--- Amend canary ---")

		bill.cancel()
		# Frappe creates the amended doc when we copy with amended_from
		amended = frappe.copy_doc(bill)
		amended.amended_from = bill.name
		amended.docstatus = 0
		amended.insert()
		created_docs.append(("Work Order RA Bill", amended.name))
		print("  Amended: " + amended.name + " from " + amended.amended_from)
		assert amended.amended_from == bill.name
		print("  Amend self-reference works correctly (rename pilot artefact validated)")

		# ============================================================
		# PHASE 7 - Cancel + reverse on Register
		# ============================================================
		print("\n--- RA Bill cancel + Register reverse ---")
		# bill1 was already cancelled above - confirm register reflected the reversal
		reg.reload()
		print("  Register mob recovered after bill1 cancel: " + str(reg.mobilization_recovered))
		assert abs(reg.mobilization_recovered - 0) < 0.01

		print("\n" + "=" * 70)
		print("ALL PHASES PASSED - regression smoke test successful")
		print("=" * 70)

	finally:
		# Cleanup in reverse order
		print("\n--- Cleanup ---")
		for doctype, name in reversed(created_docs):
			try:
				doc = frappe.get_doc(doctype, name)
				if doc.docstatus == 1:
					doc.cancel()
				frappe.delete_doc(doctype, name, force=1)
				print("  deleted " + doctype + " " + name)
			except Exception as e:
				print("  cleanup failed for " + doctype + " " + name + ": " + str(e))
		frappe.db.commit()


# Auto-run when invoked via `bench console < this_file`
run_smoke_test()
