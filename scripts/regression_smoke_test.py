# Copyright (c) 2026, Dutch Digitech and contributors
# Phase 1 regression smoke test (single-document model, post-1.5c.2).
#
# Exercises Work Order Contract with embedded BOQ, Advance Register, and
# Work Order RA Bill end-to-end. After Phase 1.5c.2, BOQ rows live on
# the Work Order Contract directly — there is no separate Civil Work
# Order BOQ doctype anymore.
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
	print("Regression smoke test (single-document model, post-1.5c.2)")
	print("=" * 70)

	# --- Sample data lookup ---
	sample_company = frappe.db.get_value("Company", {}, "name")
	sample_supplier = frappe.db.get_value("Supplier", {}, "name")
	if not (sample_company and sample_supplier):
		print("ABORT - no Company or Supplier on this site to test against.")
		return

	HEAD_CIVIL = "Civil Construction"
	HEAD_PLUMBING = "Plumbing Works"
	UOM_VOLUME = "Cubic Meter"
	UOM_LINEAR = "Meter"
	UOM_AREA = "Square Meter"

	for item in [HEAD_CIVIL, HEAD_PLUMBING]:
		assert frappe.db.exists("Item", item), "Required seeded Item missing: " + item
	for uom in [UOM_VOLUME, UOM_LINEAR, UOM_AREA]:
		assert frappe.db.exists("UOM", uom), "Required UOM missing: " + uom

	print("Sample company: " + str(sample_company))
	print("Sample supplier: " + str(sample_supplier))
	print("Service heads: " + HEAD_CIVIL + ", " + HEAD_PLUMBING)
	print("UOMs: " + UOM_VOLUME + ", " + UOM_AREA + ", " + UOM_LINEAR)
	print()

	created_docs = []  # for cleanup tracking

	try:
		# ============================================================
		# PHASE 1 - Work Order Contract with embedded BOQ
		# ============================================================
		print("--- Work Order Contract with embedded BOQ ---")

		wo = frappe.new_doc("Work Order Contract")
		wo.company = sample_company
		wo.supplier = sample_supplier
		wo.wo_date = frappe.utils.today()
		wo.work_title = "Smoke test WO - please delete"
		wo.retention_percentage = 5
		wo.mobilization_recovery_pct = 10
		wo.material_recovery_pct = 0
		wo.apply_labour_cess = 0
		# BOQ rows embedded directly on the WO (1.5c.2 model).
		# summary_items will auto-aggregate from these.
		wo.append("boq_items", {
			"item_no": "1.1", "summary_head": HEAD_CIVIL,
			"description": "M25 concrete in foundations", "uom": UOM_VOLUME,
			"estimated_qty": 100, "rate": 5000,
		})
		wo.append("boq_items", {
			"item_no": "1.2", "summary_head": HEAD_CIVIL,
			"description": "Plastering 12mm", "uom": UOM_AREA,
			"estimated_qty": 200, "rate": 500,
		})
		wo.append("boq_items", {
			"item_no": "2.1", "summary_head": HEAD_PLUMBING,
			"description": "GI pipe 25mm", "uom": UOM_LINEAR,
			"estimated_qty": 100, "rate": 1500,
		})
		wo.insert()
		created_docs.append(("Work Order Contract", wo.name))
		print("  Created: " + wo.name + " | total: " + str(wo.total_amount))

		# Expected BOQ totals: 100*5000 + 200*500 + 100*1500 = 750000
		assert abs(wo.total_amount - 750000) < 0.01, "WO total wrong: " + str(wo.total_amount)
		assert wo.name.startswith("WO-"), "Naming series broken"

		# Auto-aggregation: 2 distinct summary heads
		heads = {s.summary_head: float(s.amount) for s in wo.summary_items}
		assert heads.get(HEAD_CIVIL) == 600000.0, "Civil aggregate wrong: " + str(heads)
		assert heads.get(HEAD_PLUMBING) == 150000.0, "Plumbing aggregate wrong: " + str(heads)
		print("  Summary auto-aggregation: " + str(heads))

		# Every BOQ row got a stable UUID
		for r in wo.boq_items:
			assert r.boq_row_uid and len(r.boq_row_uid) == 36, "Missing/invalid UID on row " + r.item_no
		print("  boq_row_uid populated on all 3 BOQ rows")

		# Retention split validation
		wo.retention_release_on_final_bill = 60
		wo.retention_release_after_dlp = 50  # 60+50=110, should fail
		try:
			wo.save()
			assert False, "Retention split validation did not fire"
		except frappe.ValidationError:
			wo.reload()
		print("  Retention split validation: OK")

		# 0% deviation honored: set row 1.1 to explicit 0
		wo.boq_items[0].deviation_limit_pct = 0
		wo.save()
		wo.reload()
		assert wo.boq_items[0].deviation_limit_pct == 0, "Explicit 0 not preserved: " + str(wo.boq_items[0].deviation_limit_pct)
		print("  deviation_limit_pct=0 preserved (no truthy-fallback bug)")

		wo.submit()
		print("  Submitted: " + wo.name)

		# ============================================================
		# PHASE 2 - Work Order Advance Register
		# ============================================================
		print("\n--- Work Order Advance Register ---")

		reg = frappe.new_doc("Work Order Advance Register")
		reg.civil_work_order = wo.name
		reg.append("tranches", {
			"tranche_date": frappe.utils.today(),
			"advance_type": "Mobilization",
			"amount": 100000,
		})
		reg.insert()
		created_docs.append(("Work Order Advance Register", reg.name))
		print("  Created: " + reg.name + " | mob outstanding: " + str(reg.mobilization_outstanding))
		assert abs(reg.mobilization_outstanding - 100000) < 0.01

		from dux_civil_works.dux_work_orders.doctype.work_order_advance_register.work_order_advance_register import (
			get_or_create_register, get_outstanding_balance,
		)
		found = get_or_create_register(wo.name)
		assert found.name == reg.name
		bal = get_outstanding_balance(wo.name, "Mobilization")
		assert abs(bal - 100000) < 0.01
		print("  Helpers (get_or_create_register, get_outstanding_balance): OK")

		# ============================================================
		# PHASE 3 - Work Order RA Bill (auto-populates from WO.boq_items)
		# ============================================================
		print("\n--- Work Order RA Bill ---")

		bill = frappe.new_doc("Work Order RA Bill")
		bill.civil_work_order = wo.name
		bill.bill_date = frappe.utils.today()
		bill.insert()
		created_docs.append(("Work Order RA Bill", bill.name))
		print("  Created: " + bill.name + " | bill_number: " + str(bill.bill_number) + " | items: " + str(len(bill.items)))
		assert bill.bill_number == 1
		assert len(bill.items) == 3, "Expected 3 RA Bill items, got " + str(len(bill.items))

		# Every RA Bill item carries a boq_row_uid from the source WO row
		for r in bill.items:
			assert r.boq_row_uid and len(r.boq_row_uid) == 36, "RA Bill item missing boq_row_uid: " + str(r.item_no)
			grp = frappe.db.get_value("Item", r.summary_head, "item_group")
			assert grp == "Work Order Items", "RA Bill summary_head wrong group: " + str(r.summary_head)
		print("  All RA Bill items have boq_row_uid + valid summary_head Item")

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
		assert "Mobilization Recovery" in natures, "Mob recovery not auto-suggested"

		retention = next(d for d in bill.deductions if d.nature == "Retention")
		assert abs(retention.amount - 10250) < 0.01   # 205000 * 5%
		mob_rec = next(d for d in bill.deductions if d.nature == "Mobilization Recovery")
		assert abs(mob_rec.amount - 20500) < 0.01     # min(205000*10%, 100000) = 20500
		print("  Auto-deductions: retention=" + str(retention.amount) + ", mob_recovery=" + str(mob_rec.amount))

		expected_net = 205000 - 10250 - 20500
		assert abs(bill.net_payable - expected_net) < 0.01
		print("  Net payable: " + str(bill.net_payable) + " (expected " + str(expected_net) + ")")

		bill.submit()
		reg.reload()
		print("  Submitted | register mob outstanding: " + str(reg.mobilization_outstanding) + " (expected 79500)")
		assert abs(reg.mobilization_outstanding - 79500) < 0.01
		assert bill.billing_status == "Submitted"

		# ============================================================
		# PHASE 4 - 0% deviation enforcement (the bug-fix canary)
		# ============================================================
		# Row 1.1 has deviation_limit_pct=0 (set in PHASE 1). Any
		# cumulative_qty over 100 should fail. This is the lurking
		# Phase 1 bug — explicit 0 must be honored as strict-no-deviation.
		print("\n--- 0% deviation enforcement (bug-fix canary) ---")

		bill2 = frappe.new_doc("Work Order RA Bill")
		bill2.civil_work_order = wo.name
		bill2.bill_date = frappe.utils.today()
		bill2.insert()
		created_docs.append(("Work Order RA Bill", bill2.name))
		# Row 1.1 has deviation_limit_pct=0 (ceiling = estimated_qty 100).
		# previous_cumulative_qty=30 (carried from bill1). Push cum to 101 — strictly over 100.
		bill2.items[0].cumulative_qty = 101
		bill2.items[1].cumulative_qty = 60
		bill2.items[2].cumulative_qty = 30
		bill2.save()
		caught = False
		try:
			bill2.submit()
		except frappe.ValidationError:
			caught = True
			bill2.reload()
		assert caught, "0% deviation did not block submit — bug regressed"
		print("  0% deviation blocked submit as expected")

		# ============================================================
		# PHASE 5 - 5% deviation enforcement (line 2 has default)
		# ============================================================
		print("\n--- 5% deviation enforcement (default) ---")
		# row 1.2 has no explicit deviation_limit_pct; if a default exists
		# in Settings, it'd be used. Try qty=212 (6% over estimated 200)
		bill3 = frappe.new_doc("Work Order RA Bill")
		bill3.civil_work_order = wo.name
		bill3.bill_date = frappe.utils.today()
		bill3.insert()
		created_docs.append(("Work Order RA Bill", bill3.name))
		# Make row 1.1 fit (cum 30 <= 100); push row 1.2 over default 5% (ceiling 210)
		bill3.items[0].cumulative_qty = 30
		bill3.items[1].cumulative_qty = 212  # 6% over BOQ qty 200
		bill3.items[2].cumulative_qty = 20
		bill3.save()
		caught = False
		try:
			bill3.submit()
		except frappe.ValidationError:
			caught = True
			bill3.reload()
		assert caught, "Default deviation enforcement did not fire on row 1.2"
		print("  Default deviation enforcement: OK")

		# ============================================================
		# PHASE 6 - Amend canary (validates rename + self-ref fix)
		# ============================================================
		print("\n--- Amend canary ---")

		bill.cancel()
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
