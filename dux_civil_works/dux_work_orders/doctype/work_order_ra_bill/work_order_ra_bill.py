# Copyright (c) 2026, Dutch Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from dux_civil_works.dux_work_orders.doctype.work_order_advance_register.work_order_advance_register import (
	get_or_create_register,
	get_outstanding_balance,
)
from dux_civil_works.dux_work_orders.variation_state import build_scope_map


class WorkOrderRABill(Document):
	# ============================================================
	# Lifecycle hooks
	# ============================================================

	def before_insert(self):
		self.assign_bill_number()
		self.populate_bill_entries_from_scope_map()

	def validate(self):
		self.validate_wo_consistency()
		self.validate_period_dates()
		# Allocator: read bill_entries (one row per item, with engineer's
		# cumulative qty), split left-to-right across original + variation
		# scopes, regenerate self.items per-scope. See DESIGN.md 4.7.
		self._allocate_and_generate_items()
		self.compute_gross_this_bill()
		self.suggest_deductions()
		self.compute_totals_and_net_payable()
		self.set_billing_status()

	def before_submit(self):
		self.enforce_deviation_limits()
		self.enforce_recovery_caps_against_register()

	def on_submit(self):
		self.post_recoveries_to_register()
		# Persist billing_status that validate() set; on_submit runs after DB update.
		self.db_set("billing_status", self._compute_billing_status(), update_modified=False)

	def on_cancel(self):
		self.reverse_recoveries_on_register()
		# Persist billing_status; on_cancel runs after DB update so direct attr won't save.
		self.db_set("billing_status", "Cancelled", update_modified=False)

	# ============================================================
	# before_insert helpers
	# ============================================================

	def assign_bill_number(self):
		if not self.civil_work_order:
			return
		prior = frappe.db.count(
			"Work Order RA Bill",
			{
				"civil_work_order": self.civil_work_order,
				"docstatus": ["<", 2],
				"name": ["!=", self.name or ""],
			},
		)
		self.bill_number = (prior or 0) + 1

	# ============================================================
	# Scope map — the variation-aware shape of the linked WO
	# ============================================================

	def _build_scope_map(self):
		"""Return the ordered item -> scopes structure for the linked WO.

		Thin wrapper over the shared helper in
		dux_work_orders.variation_state.build_scope_map — same logic
		also used by the Work Order Variation Summary report so the
		report can never diverge from what billing actually does.
		See DESIGN.md Section 4.7.
		"""
		return build_scope_map(self.civil_work_order)

	def populate_bill_entries_from_scope_map(self):
		"""Build/refresh bill_entries from the scope map: one row per item.

		Idempotent: existing cumulative_qty and remarks are preserved for
		any item_key already present; new items are appended with
		cumulative_qty = 0; orphaned bill_entries (items no longer in the
		scope map) are dropped.
		"""
		if not self.civil_work_order:
			return

		scope_items = self._build_scope_map()
		if not scope_items:
			frappe.throw(_(
				"Work Order Contract {0} has no BOQ items. "
				"Add BOQ rows to the Work Order before creating a Running Account Bill."
			).format(self.civil_work_order))

		# Index existing bill_entries by item_key (preserve user edits)
		existing_by_key = {}
		for be in (self.bill_entries or []):
			if be.item_key:
				existing_by_key[be.item_key] = be

		new_rows = []
		for item in scope_items:
			total_cap = sum(s["cap"] for s in item["scopes"])
			prior = existing_by_key.get(item["item_key"])
			# Default cumulative_qty to Σ prior across this item's scopes.
			# That matches the user's mental model — they see what was billed
			# before and bump it upward for this bill. Initializing to 0
			# would also (incorrectly) trigger the Edge 1 monotonic check on
			# the very first validate() after insert, because the allocator
			# would see T=0 < Σprior. See _allocate_and_generate_items.
			sum_prior = sum(
				self._get_previous_cumulative_qty(s["uid"]) for s in item["scopes"]
			)
			if prior is not None:
				# Preserve any value the user already typed; if they hadn't
				# touched it yet (cumulative_qty <= sum_prior), bump to
				# sum_prior so the bill remains valid.
				preserved = float(prior.cumulative_qty or 0)
				default_cum = max(preserved, sum_prior)
			else:
				default_cum = sum_prior
			row = {
				"item_key": item["item_key"],
				"item_no": item["item_no"],
				"summary_head": item["summary_head"],
				"description": item["description"],
				"uom": item["uom"],
				"total_sanctioned_qty": total_cap,
				"cumulative_qty": default_cum,
				"remarks": (prior.remarks if prior else None),
			}
			new_rows.append(row)

		self.set("bill_entries", [])
		for r in new_rows:
			self.append("bill_entries", r)

	def _get_previous_cumulative_qty(self, scope_uid):
		"""Cumulative qty billed against THIS scope in prior submitted
		bills on the same WO. Matches on boq_row_uid (= scope UID); each
		scope's prior cumulative is tracked independently. See DESIGN.md
		4.7 'What boq_row_uid does here'.
		"""
		if not scope_uid or not self.civil_work_order:
			return 0
		result = frappe.db.sql("""
			SELECT IFNULL(MAX(rb_item.cumulative_qty), 0) AS qty
			FROM `tabWork Order RA Bill Item` rb_item
			INNER JOIN `tabWork Order RA Bill` rb ON rb.name = rb_item.parent
			WHERE rb_item.boq_row_uid = %s
			  AND rb.civil_work_order = %s
			  AND rb.docstatus = 1
			  AND rb.name != %s
		""", (scope_uid, self.civil_work_order, self.name or ""), as_dict=True)
		return float(result[0].qty if result else 0)

	# ============================================================
	# The allocator — the financial core
	# ============================================================

	def _allocate_and_generate_items(self):
		"""For each bill_entries row, distribute the entered cumulative
		qty left-to-right across the item's ordered scopes (original
		first, then variation 1, then variation 2 ...), then generate
		one self.items row per scope where this_bill_qty > 0.

		Algorithm — for an item with ordered scopes s1..sk, sanctioned
		caps cap_1..cap_k, and entered cumulative T:

		  EDGE 1: if T < sum(prior_i across scopes), throw — monotonic
		          forward only (cannot un-bill prior work).

		  Distribute T:
		     remaining = T
		     for si in s1..sk:
		         target_i = min(remaining, cap_i)
		         remaining -= target_i
		  EDGE 2: if remaining > 0 after the last scope, add it to the
		          last scope's target. The deviation check at submit
		          will then catch the overflow on that scope.

		  EDGE 3: for each scope where this_bill_i = target_i - prior_i
		          > 0, append a row to self.items tagged with this scope.
		          Scopes with this_bill_i == 0 are omitted from this bill.

		Each generated row carries the SCOPE'S OWN rate, tax_pct,
		deviation_limit_pct — so one cumulative entry can produce lines
		at different tax rates if the variation revised tax_pct. The
		row's estimated_qty is set to the SCOPE's cap (not the
		original's), so the existing per-row deviation check enforces
		the correct ceiling for each scope. See DESIGN.md 4.7.
		"""
		# Always rebuild self.items from the bill_entries + scope map.
		# Existing items rows are discarded (they are generated, not
		# user-authored).
		if not self.civil_work_order:
			self.set("items", [])
			return
		if not self.bill_entries:
			self.set("items", [])
			return

		scope_items = self._build_scope_map()
		scopes_by_key = {it["item_key"]: it["scopes"] for it in scope_items}

		generated = []
		for be_idx, be in enumerate(self.bill_entries, start=1):
			scopes = scopes_by_key.get(be.item_key)
			if not scopes:
				frappe.throw(_(
					"Bill entry row {0}: item_key '{1}' does not match any BOQ "
					"row or approved variation on Work Order {2}. The Work "
					"Order may have changed since this bill was drafted; "
					"refresh the bill entries."
				).format(be_idx, be.item_key, self.civil_work_order))

			T = float(be.cumulative_qty or 0)
			priors = [self._get_previous_cumulative_qty(s["uid"]) for s in scopes]
			sum_prior = sum(priors)

			# EDGE 1: monotonic — cannot enter cumulative less than already billed.
			if T + 0.0001 < sum_prior:
				frappe.throw(_(
					"Bill entry row {0} (item {1} '{2}'): entered cumulative "
					"qty ({3}) is less than the cumulative already billed "
					"across this item's scopes ({4}). Cumulative quantities "
					"are monotonic forward only."
				).format(be_idx, be.item_no or "?", be.description or be.item_key,
				         T, sum_prior))

			# Left-to-right distribution.
			remaining = T
			targets = []
			for s in scopes:
				take = min(remaining, s["cap"])
				if take < 0:
					take = 0
				targets.append(take)
				remaining -= take
			# EDGE 2: overflow piles onto the last scope; deviation check
			# at submit will reject if it exceeds cap * (1+deviation/100).
			if remaining > 0.0001 and targets:
				targets[-1] += remaining

			# EDGE 3: emit one row per scope with this_bill_qty > 0.
			for s, target, prior in zip(scopes, targets, priors):
				this_bill = target - prior
				if this_bill <= 0.0001:
					continue
				amount = flt(this_bill * s["rate"], 2)
				tax_amount = flt(amount * s["tax_pct"] / 100.0, 2)
				generated.append({
					"boq_row_uid": s["uid"],
					"scope_source": s["source"],
					"item_no": s["item_no"],
					"summary_head": s["summary_head"],
					"description": s["description"],
					"uom": s["uom"],
					"estimated_qty": s["cap"],
					"deviation_limit_pct": s["deviation_limit_pct"],
					"rate": s["rate"],
					"tax_pct": s["tax_pct"],
					"previous_cumulative_qty": prior,
					"cumulative_qty": target,
					"this_bill_qty": this_bill,
					"this_bill_amount": amount,
					"this_bill_tax_amount": tax_amount,
					"this_bill_amount_with_tax": flt(amount + tax_amount, 2),
				})

		self.set("items", [])
		for row in generated:
			self.append("items", row)

	# ============================================================
	# validate helpers
	# ============================================================

	def validate_wo_consistency(self):
		"""Linked Work Order Contract must exist and be Submitted."""
		if not self.civil_work_order:
			return
		wo_docstatus = frappe.db.get_value(
			"Work Order Contract", self.civil_work_order, "docstatus"
		)
		if wo_docstatus != 1:
			frappe.throw(_(
				"Linked Work Order Contract {0} must be Submitted."
			).format(self.civil_work_order))

	def validate_period_dates(self):
		if self.period_from and self.period_to and self.period_to < self.period_from:
			frappe.throw(_("Period To cannot be earlier than Period From."))

	def compute_gross_this_bill(self):
		"""Sum the generated per-scope items into header gross totals.

		gross_this_bill is the WITHOUT-tax sum (deductions compute on
		this base, matching the existing/locked net-payable structure).
		gross_this_bill_with_tax is the with-tax sum, available for
		print and for downstream PI integration where per-scope tax
		rates may differ.
		"""
		gross = 0.0
		gross_wt = 0.0
		for row in (self.items or []):
			gross += float(row.this_bill_amount or 0)
			gross_wt += float(row.this_bill_amount_with_tax or 0)
		self.gross_this_bill = flt(gross, 2)
		self.gross_this_bill_with_tax = flt(gross_wt, 2)

	# ============================================================
	# Deduction suggestion engine
	# ============================================================

	def suggest_deductions(self):
		if not self.civil_work_order:
			return

		wo = frappe.get_cached_doc("Work Order Contract", self.civil_work_order)
		gross = float(self.gross_this_bill or 0)

		manual_rows = [r for r in (self.deductions or []) if not r.is_auto_suggested]

		auto_rows = []

		if (wo.retention_percentage or 0) > 0 and gross > 0:
			amt = gross * float(wo.retention_percentage) / 100.0
			auto_rows.append({
				"nature": "Retention",
				"description": f"Retention @ {wo.retention_percentage}%",
				"amount": round(amt, 2),
				"gl_account": self._get_company_account("retention_payable_account"),
				"is_auto_suggested": 1,
			})

		if (wo.mobilization_recovery_pct or 0) > 0 and gross > 0:
			suggested = gross * float(wo.mobilization_recovery_pct) / 100.0
			outstanding = get_outstanding_balance(self.civil_work_order, "Mobilization")
			capped = min(suggested, outstanding) if outstanding > 0 else 0
			if capped > 0:
				auto_rows.append({
					"nature": "Mobilization Recovery",
					"description": f"Mob recovery @ {wo.mobilization_recovery_pct}% (capped at outstanding {outstanding})",
					"amount": round(capped, 2),
					"gl_account": self._get_company_account("mobilization_advance_account"),
					"is_auto_suggested": 1,
				})

		if (wo.material_recovery_pct or 0) > 0 and gross > 0:
			suggested = gross * float(wo.material_recovery_pct) / 100.0
			outstanding = get_outstanding_balance(self.civil_work_order, "Material")
			capped = min(suggested, outstanding) if outstanding > 0 else 0
			if capped > 0:
				auto_rows.append({
					"nature": "Material Recovery",
					"description": f"Mat recovery @ {wo.material_recovery_pct}% (capped at outstanding {outstanding})",
					"amount": round(capped, 2),
					"gl_account": self._get_company_account("material_advance_account"),
					"is_auto_suggested": 1,
				})

		if wo.apply_labour_cess and (wo.labour_cess_pct or 0) > 0 and gross > 0:
			amt = gross * float(wo.labour_cess_pct) / 100.0
			auto_rows.append({
				"nature": "Labour Cess",
				"description": f"Labour cess @ {wo.labour_cess_pct}%",
				"amount": round(amt, 2),
				"gl_account": self._get_company_account("labour_cess_payable_account"),
				"is_auto_suggested": 1,
			})

		# NOTE: TDS handled via ERPNext Tax Withholding at Purchase Invoice level
		# (using wo.tds_category). Avoids double-deducting.

		self.set("deductions", [])
		for row in auto_rows:
			self.append("deductions", row)
		for row in manual_rows:
			self.append("deductions", row.as_dict())

	def _get_company_account(self, fieldname):
		if not self.company:
			return None
		try:
			settings = frappe.get_cached_doc("Work Order Settings")
		except Exception:
			return None
		for row in (settings.company_accounts or []):
			if row.company == self.company:
				return row.get(fieldname) or settings.get(fieldname)
		return None

	# ============================================================
	# Totals
	# ============================================================

	DEDUCTION_NATURES = {
		"Retention", "Mobilization Recovery", "Material Recovery",
		"TDS", "Labour Cess", "Penalty", "Other Deduction",
	}
	ADDITION_NATURES = {"Price Escalation", "Other Addition"}

	def compute_totals_and_net_payable(self):
		deductions = 0.0
		additions = 0.0
		for row in (self.deductions or []):
			amt = float(row.amount or 0)
			if row.nature in self.DEDUCTION_NATURES:
				deductions += amt
			elif row.nature in self.ADDITION_NATURES:
				additions += amt
		self.total_deductions = deductions
		self.total_additions = additions
		self.net_payable = float(self.gross_this_bill or 0) - deductions + additions

	# ============================================================
	# Status
	# ============================================================

	def set_billing_status(self):
		self.billing_status = self._compute_billing_status()

	def _compute_billing_status(self):
		if self.docstatus == 2:
			return "Cancelled"
		if self.docstatus == 0:
			return "Draft"
		invoiced = float(self.invoiced_amount or 0)
		net = float(self.net_payable or 0)
		if net <= 0 or invoiced <= 0:
			return "Submitted"
		if invoiced + 0.01 < net:
			return "Partially Invoiced"
		return "Fully Invoiced"

	# ============================================================
	# before_submit deviation enforcement
	# ============================================================

	def enforce_deviation_limits(self):
		"""Per-scope deviation enforcement on the GENERATED items.

		Each generated row carries estimated_qty = scope cap and
		deviation_limit_pct = scope's own limit. So this iteration
		correctly enforces deviation per scope (original separately
		from each variation scope). For variation scopes, the cap is
		the variation line's qty, not the original's estimated_qty.
		"""
		offenders = []
		for row in (self.items or []):
			est = float(row.estimated_qty or 0)
			cum = float(row.cumulative_qty or 0)
			limit_pct = float(row.deviation_limit_pct or 0)
			# Don't skip est<=0 — that gives away the floor for fully-
			# reduced scopes (Reduced Qty = -original.estimated_qty
			# produces a 0-cap original scope; without this check, billing
			# any positive amount against the deleted item would slip past
			# deviation enforcement). When est=0, ceiling=0, so any
			# positive cumulative is flagged.
			ceiling = est * (1 + limit_pct / 100.0)
			if cum > ceiling + 0.0001:
				offenders.append((row.idx, row.description, row.scope_source, cum, ceiling, limit_pct))
		if offenders:
			lines = "\n".join(
				f"  Row {idx} ({desc}, {scope}): cum {cum} > ceiling {ceiling:.3f} ({limit}% over sanctioned)"
				for (idx, desc, scope, cum, ceiling, limit) in offenders
			)
			frappe.throw(_(
				"Deviation limit exceeded on the following lines. "
				"Raise an Amendment / additional Variation before submitting this bill.\n{0}"
			).format(lines))

	def enforce_recovery_caps_against_register(self):
		if not self.civil_work_order:
			return
		bill_mob = sum(
			float(r.amount or 0) for r in (self.deductions or [])
			if r.nature == "Mobilization Recovery"
		)
		bill_mat = sum(
			float(r.amount or 0) for r in (self.deductions or [])
			if r.nature == "Material Recovery"
		)
		if bill_mob > 0:
			outstanding = get_outstanding_balance(self.civil_work_order, "Mobilization")
			if bill_mob > outstanding + 0.01:
				frappe.throw(_(
					"Mobilization recovery on this bill ({0}) exceeds outstanding mob "
					"balance on the Advance Register ({1})."
				).format(bill_mob, outstanding))
		if bill_mat > 0:
			outstanding = get_outstanding_balance(self.civil_work_order, "Material")
			if bill_mat > outstanding + 0.01:
				frappe.throw(_(
					"Material recovery on this bill ({0}) exceeds outstanding mat "
					"balance on the Advance Register ({1})."
				).format(bill_mat, outstanding))

	# ============================================================
	# on_submit / on_cancel - Advance Register sync
	# ============================================================

	def post_recoveries_to_register(self):
		if not self.civil_work_order:
			return
		recoveries_to_post = [
			r for r in (self.deductions or [])
			if r.nature in ("Mobilization Recovery", "Material Recovery")
			and float(r.amount or 0) > 0
		]
		if not recoveries_to_post:
			return

		register = get_or_create_register(self.civil_work_order)
		for r in recoveries_to_post:
			advance_type = "Mobilization" if r.nature == "Mobilization Recovery" else "Material"
			register.append("recoveries", {
				"recovery_date": self.bill_date,
				"advance_type": advance_type,
				"amount": float(r.amount),
				"ra_bill": self.name,
				"remarks": f"Auto-posted from RA Bill {self.name}",
			})
		register.save(ignore_permissions=True)

	def reverse_recoveries_on_register(self):
		if not self.civil_work_order:
			return
		reg_name = frappe.db.exists(
			"Work Order Advance Register", {"civil_work_order": self.civil_work_order}
		)
		if not reg_name:
			return
		register = frappe.get_doc("Work Order Advance Register", reg_name)
		before = len(register.recoveries or [])
		register.recoveries = [r for r in (register.recoveries or []) if r.ra_bill != self.name]
		if len(register.recoveries) != before:
			register.save(ignore_permissions=True)

	# ============================================================
	# Step 6: Purchase Invoice integration - invoiced_amount tracker
	# ============================================================

	def refresh_invoiced_amount(self):
		"""Recompute invoiced_amount and per_invoiced by walking submitted
		Purchase Invoice Items that reference this RA Bill. Called from the
		PI on_submit/on_cancel hooks. Uses db_set so this is safe to call
		from any document state."""
		total = frappe.db.sql("""
			SELECT IFNULL(SUM(pii.amount), 0) AS total
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
			WHERE pii.wo_ra_bill = %s
			  AND pi.docstatus = 1
		""", (self.name,))[0][0] or 0
		invoiced = float(total)
		net = float(self.net_payable or 0)
		pct = (invoiced / net * 100.0) if net > 0 else 0
		new_status = self._compute_billing_status_with_invoiced(invoiced, net)

		self.db_set("invoiced_amount", invoiced, update_modified=False)
		self.db_set("per_invoiced", pct, update_modified=False)
		self.db_set("billing_status", new_status, update_modified=False)

	def _compute_billing_status_with_invoiced(self, invoiced, net):
		"""Variant of billing status computation that uses an externally
		recomputed invoiced amount (not the in-memory self.invoiced_amount,
		which may be stale during hook calls)."""
		if self.docstatus == 2:
			return "Cancelled"
		if self.docstatus == 0:
			return "Draft"
		if net <= 0 or invoiced <= 0:
			return "Submitted"
		if invoiced + 0.01 < net:
			return "Partially Invoiced"
		return "Fully Invoiced"

	@frappe.whitelist()
	def close_ra_bill(self):
		"""Manually mark a partially-invoiced RA Bill as Closed (no further
		invoicing expected). Phase 1: this method exists as a stub; the UI
		button + finance-policy guardrails ship in a later step."""
		frappe.throw(_(
			"close_ra_bill() is not yet implemented. RA Bills move to Closed "
			"status only via finance-approved write-off in a later phase."
		))


# ============================================================
# Module-level helpers — called from the client form
# ============================================================

@frappe.whitelist()
def get_initial_bill_entries(work_order_contract, existing_entries=None):
	"""Build the bill_entries rows for a Work Order without requiring the
	RA Bill to be saved first.

	The form calls this when the engineer selects (or changes) the Work
	Order, so entries appear IMMEDIATELY in the grid — closing the
	empty-table UX hole that invited manual hand-entry of bill_entries
	(which would lack the item_key linkage the allocator needs).

	Behavior-preserving: this is a thin wrapper around the existing
	populate_bill_entries_from_scope_map method (the same code that
	runs at save time via before_insert). Building a temporary
	in-memory RA Bill, seeding any existing client-side entries the
	caller passed for idempotency, and running the verified populate
	logic means the on-select path and the on-save path produce
	identical rows — no second source of truth.

	Idempotency: if existing_entries (list of dicts from the client's
	current form state, keyed by item_key) is provided, those rows
	seed the temp doc first so populate's preserve-existing-cumulative
	branch keeps the user's typed values. Items not present in the
	seed get cumulative_qty = Σ prior (the default).

	Returns: list of dicts (one per bill_entry) ready for the client
	to clear_table + add_child into the form. The client side does
	NOT recompute anything — server is the source of truth.
	"""
	import json

	if not work_order_contract:
		return []

	bill = frappe.new_doc("Work Order RA Bill")
	bill.civil_work_order = work_order_contract

	# Seed with any entries the client already had so idempotency
	# kicks in for matching item_keys.
	if existing_entries:
		if isinstance(existing_entries, str):
			existing_entries = json.loads(existing_entries)
		for e in (existing_entries or []):
			if not e.get("item_key"):
				continue
			bill.append("bill_entries", {
				"item_key": e["item_key"],
				"cumulative_qty": float(e.get("cumulative_qty") or 0),
				"remarks": e.get("remarks"),
			})

	bill.populate_bill_entries_from_scope_map()

	return [{
		"item_key": be.item_key,
		"item_no": be.item_no,
		"summary_head": be.summary_head,
		"description": be.description,
		"uom": be.uom,
		"total_sanctioned_qty": float(be.total_sanctioned_qty or 0),
		"cumulative_qty": float(be.cumulative_qty or 0),
		"remarks": be.remarks,
	} for be in (bill.bill_entries or [])]
