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

	def _assert_single_open_claim(self):
		"""One live claim per work order. Running-account bills are sequential.

		`_get_previous_cumulative_qty` only counts APPROVED bills, so a second
		claim opened while the first is still in review is seeded as though the
		first does not exist. That double-counts the same work, and when the
		first is finally approved the second either collapses to nothing or
		trips the monotonic guard and can never be approved at all. Refuse the
		situation outright instead.
		"""
		if not self.civil_work_order:
			return
		others = frappe.get_all(
			"Work Order RA Bill",
			filters={
				"civil_work_order": self.civil_work_order,
				"docstatus": 0,
				"name": ["!=", self.name or ""],
			},
			fields=["name", "review_state"],
		)
		open_ones = [
			o for o in others
			if (o.get("review_state") or "Draft") not in CLOSED_REVIEW_STATES
		]
		if open_ones:
			other = open_ones[0]
			frappe.throw(
				_(
					"{0} already has a claim in progress ({1}, {2}). "
					"Finish or withdraw it before raising another — quantities are "
					"cumulative, so two open claims would double-count the same work."
				).format(
					frappe.bold(self.civil_work_order),
					frappe.bold(other["name"]),
					other.get("review_state") or _("Draft"),
				),
				title=_("A claim is already open"),
			)

	def before_insert(self):
		self._assert_single_open_claim()
		self.assign_bill_number()
		self.populate_bill_entries_from_scope_map()
		# Claim review is opt-in per company. A company that has not enabled it
		# leaves review_state empty and behaves exactly as it always has.
		if self.is_review_enabled():
			self.review_state = "Draft"

	def before_submit(self):
		self.enforce_review_gate()
		self.enforce_deviation_limits()
		self.enforce_recovery_caps_against_register()

	def validate(self):
		self._enforce_portal_scope()
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
		# Fail fast. This also runs in before_submit (belt and braces), but a
		# claim that breaches the sanctioned ceiling can NEVER be approved, so
		# refuse to SAVE it rather than letting someone build a claim that only
		# explodes days later when the reviewer tries to approve it.
		self.enforce_deviation_limits()

	def on_submit(self):
		self.post_recoveries_to_register()
		# Persist billing_status that validate() set; on_submit runs after DB update.
		self.db_set("billing_status", self._compute_billing_status(), update_modified=False)

	def on_cancel(self):
		self.reverse_recoveries_on_register()
		# Persist billing_status; on_cancel runs after DB update so direct attr won't save.
		self.db_set("billing_status", "Cancelled", update_modified=False)
		# Stamp the review state too, or a cancelled claim keeps reading
		# "Approved" forever. (A Frappe Workflow would NOT do this: its
		# state-stamping runs from _validate(), which document.py skips on
		# the cancel path — one reason review is a plain field here.)
		if self.review_state:
			self.db_set("review_state", "Rejected", update_modified=False)

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

	# Rates come from the scope map so the caller can price the claim as it is
	# typed. An item billed across several scopes (original + variations) can
	# carry different rates, so flag that rather than implying one rate.
	scopes_by_key = {}
	for item in (build_scope_map(work_order_contract) or []):
		scopes_by_key[item["item_key"]] = item.get("scopes") or []

	def _rate_info(item_key):
		scopes = scopes_by_key.get(item_key) or []
		rates = [float(s.get("rate") or 0) for s in scopes]
		if not rates:
			return 0.0, False
		return rates[0], len(set(rates)) > 1

	def _max_claimable(item_key):
		"""Highest cumulative qty that could ever be approved for this item:
		each scope's sanctioned cap plus its own permitted deviation."""
		total = 0.0
		for sc in (scopes_by_key.get(item_key) or []):
			cap = float(sc.get("cap") or 0)
			dev = float(sc.get("deviation_limit_pct") or 0)
			total += cap * (1.0 + dev / 100.0)
		return round(total, 6)

	out = []
	for be in (bill.bill_entries or []):
		rate, varies = _rate_info(be.item_key)
		out.append({
			"item_key": be.item_key,
			"item_no": be.item_no,
			"summary_head": be.summary_head,
			"description": be.description,
			"uom": be.uom,
			"total_sanctioned_qty": float(be.total_sanctioned_qty or 0),
			"cumulative_qty": float(be.cumulative_qty or 0),
			"remarks": be.remarks,
			"rate": rate,
			"rate_varies": varies,
			"max_claimable": _max_claimable(be.item_key),
		})
	return out


# ============================================================
# Claim review (Phase 2) — deliberately NOT a Frappe Workflow
# ============================================================
# A Frappe Workflow attaches to a DOCTYPE, so it would gate every tenant on
# this bench (Gaya, GH Raisoni and MN Globex all hold RA bills here). Review
# is therefore a plain `review_state` field, enforced in this controller and
# switched on PER COMPANY via Work Order Settings -> company_accounts ->
# enable_ra_bill_review. A company that has not opted in leaves review_state
# empty and behaves exactly as before.
#
# Transitions are applied with db_set, so moving a claim between review
# states never re-runs validate(). That is what keeps a claim actionable even
# when its parent work order or a variation has since changed — the strict
# checks run only where they must, on approve (which submits the document).

#: state -> {action: next_state}
REVIEW_TRANSITIONS = {
	"Draft": {"submit_for_review": "Pending Review", "withdraw": "Withdrawn"},
	"Pending Review": {
		"approve": "Approved",
		"return_for_revision": "Returned for Revision",
		"reject": "Rejected",
		"withdraw": "Withdrawn",
	},
	"Returned for Revision": {"submit_for_review": "Pending Review", "withdraw": "Withdrawn"},
	"Rejected": {"reopen": "Draft"},
	"Withdrawn": {"reopen": "Draft"},
	"Approved": {},
}

#: A claim in one of these states is finished with — it no longer occupies the
#: work order and does not block the next claim.
CLOSED_REVIEW_STATES = ("Rejected", "Withdrawn")

#: action -> roles that may perform it. System Manager may always act.
REVIEW_ACTION_ROLES = {
	"submit_for_review": ("WO Creator", "Accounts User", "Accounts Manager", "Contractor Portal"),
	"approve": ("WO L2 Approver", "Accounts Manager"),
	"return_for_revision": ("WO L2 Approver", "WO Verifier", "Accounts Manager"),
	"reject": ("WO L2 Approver", "Accounts Manager"),
	"reopen": ("WO Creator", "Accounts User", "Accounts Manager"),
	# The contractor may take back their own claim; staff may too.
	"withdraw": ("WO Creator", "Accounts User", "Accounts Manager", "Contractor Portal"),
}

REVIEW_ACTION_LABELS = {
	"submit_for_review": "Submit for review",
	"approve": "Approve",
	"return_for_revision": "Return for revision",
	"reject": "Reject",
	"reopen": "Re-open",
	"withdraw": "Withdraw",
}


def is_review_enabled_for_company(company):
	"""True if this company routes RA bills through claim review."""
	if not company:
		return False
	try:
		settings = frappe.get_cached_doc("Work Order Settings")
	except Exception:
		return False
	for row in (settings.get("company_accounts") or []):
		if row.get("company") == company:
			return bool(row.get("enable_ra_bill_review"))
	return False


def _review_methods(cls):
	def is_review_enabled(self):
		return is_review_enabled_for_company(self.get("company"))

	def enforce_review_gate(self):
		"""An opted-in company may only submit a claim that has been approved.

		This is the backstop behind the UI: a raw REST submit, a script or a
		Desk click all land here.
		"""
		if not self.is_review_enabled():
			return
		state = self.get("review_state")
		if state != "Approved":
			frappe.throw(
				_("{0} is in review state {1}. It must be approved before it can be submitted.").format(
					frappe.bold(self.name or _("This claim")),
					frappe.bold(state or _("Draft")),
				),
				title=_("Claim not approved"),
			)

	def get_review_actions(self, user=None):
		"""Actions the given user may perform on this claim, right now."""
		if not self.is_review_enabled() or self.docstatus != 0:
			return []
		state = self.get("review_state") or "Draft"
		roles = set(frappe.get_roles(user or frappe.session.user))
		out = []
		for action, next_state in (REVIEW_TRANSITIONS.get(state) or {}).items():
			allowed = set(REVIEW_ACTION_ROLES.get(action, ()))
			if "System Manager" in roles or (roles & allowed):
				out.append({
					"action": action,
					"label": REVIEW_ACTION_LABELS.get(action, action),
					"next_state": next_state,
				})
		return out

	@frappe.whitelist()
	def apply_review_action(self, action, comment=None):
		"""Move this claim through the review chain.

		Approving is the only transition that touches docstatus: it submits
		the document, so the whole existing engine (allocator, deviation
		ceilings, recovery caps, advance-register posting) runs exactly as it
		always has. Every other transition is a db_set and re-runs nothing.
		"""
		if not self.is_review_enabled():
			frappe.throw(_("Claim review is not enabled for {0}.").format(self.get("company")))
		if self.docstatus != 0:
			frappe.throw(_("This claim is no longer a draft."))

		state = self.get("review_state") or "Draft"
		allowed = {a["action"] for a in self.get_review_actions()}
		if action not in allowed:
			frappe.throw(
				_("You cannot {0} a claim that is {1}.").format(
					REVIEW_ACTION_LABELS.get(action, action), frappe.bold(state)
				),
				frappe.PermissionError,
			)

		next_state = REVIEW_TRANSITIONS[state][action]

		if action == "submit_for_review":
			# Record what was claimed so the reviewer can see any later drift.
			# Informational only — never used to block, so a legitimately zero
			# claim is not silently exempted from anything.
			self.db_set("claimed_net_payable", flt(self.get("net_payable") or 0), update_modified=False)

		if action == "approve":
			self.db_set("review_state", "Approved", update_modified=False)
			self.reload()
			try:
				self.submit()
			except Exception:
				# Approval failed a hard check (deviation ceiling, recovery cap,
				# cancelled work order). Put the claim back so it stays actionable.
				frappe.db.rollback()
				self.reload()
				self.db_set("review_state", "Pending Review", update_modified=False)
				frappe.db.commit()
				raise
		else:
			self.db_set("review_state", next_state, update_modified=False)

		if comment:
			self.add_comment("Comment", text=comment)

		return {"review_state": self.get("review_state"), "docstatus": self.docstatus}

	cls.is_review_enabled = is_review_enabled
	cls.enforce_review_gate = enforce_review_gate
	cls.get_review_actions = get_review_actions
	cls.apply_review_action = apply_review_action
	return cls


_review_methods(WorkOrderRABill)


@frappe.whitelist()
def get_review_state(ra_bill):
	"""Review state + the actions the signed-in user may take. Permission
	checked against the document, so portal scoping applies."""
	doc = frappe.get_doc("Work Order RA Bill", ra_bill)
	doc.check_permission("read")
	return {
		"name": doc.name,
		"review_enabled": doc.is_review_enabled(),
		"review_state": doc.get("review_state"),
		"claimed_net_payable": flt(doc.get("claimed_net_payable") or 0),
		"net_payable": flt(doc.get("net_payable") or 0),
		"docstatus": doc.docstatus,
		"actions": doc.get_review_actions(),
	}


@frappe.whitelist()
def apply_review_action(ra_bill, action, comment=None):
	"""Module-level entry point for the SPA (plain /api/method call).

	Permission is enforced twice: document read permission here (so the
	contractor-portal supplier scoping applies), then the per-action role
	check inside the document method.
	"""
	doc = frappe.get_doc("Work Order RA Bill", ra_bill)
	doc.check_permission("read")
	return doc.apply_review_action(action, comment)


@frappe.whitelist()
def update_certified_quantities(ra_bill, entries, deductions=None):
	"""Reviewer edits: set certified qty per line and/or adjust deductions.

	Only ever touches a DRAFT claim. Saving re-runs validate(), so the
	allocator, deduction engine and totals recompute server-side — the
	client never sends money figures, only certified quantities.
	"""
	import json

	doc = frappe.get_doc("Work Order RA Bill", ra_bill)
	doc.check_permission("write")
	if doc.docstatus != 0:
		frappe.throw(_("Only a draft claim can be edited."))

	if isinstance(entries, str):
		entries = json.loads(entries)
	by_key = {e.get("item_key"): e for e in (entries or []) if e.get("item_key")}
	for row in (doc.bill_entries or []):
		payload = by_key.get(row.item_key)
		if payload is None:
			continue
		if payload.get("cumulative_qty") is not None:
			row.cumulative_qty = flt(payload.get("cumulative_qty"))
		if payload.get("remarks") is not None:
			row.remarks = payload.get("remarks")

	if deductions is not None:
		if isinstance(deductions, str):
			deductions = json.loads(deductions)
		by_name = {d.get("name"): d for d in (deductions or []) if d.get("name")}
		for row in (doc.deductions or []):
			payload = by_name.get(row.name)
			if payload and payload.get("amount") is not None:
				row.amount = flt(payload.get("amount"))
				# A hand-set figure is no longer the engine's suggestion.
				row.is_auto_suggested = 0

	doc.save()
	return {
		"net_payable": flt(doc.net_payable or 0),
		"gross_this_bill": flt(doc.gross_this_bill or 0),
		"total_deductions": flt(doc.total_deductions or 0),
	}


def _portal_guard(cls):
	"""Server-side limits on what an external contractor may do to a claim.

	Phase 1 scopes what a contractor can SEE. This scopes what they can
	WRITE, and runs inside validate() so it applies to the portal UI, a raw
	REST PUT and a script alike.
	"""

	def _enforce_portal_scope(self):
		from dux_civil_works.dux_work_orders.api.portal import (
			get_portal_suppliers,
			is_portal_user,
		)

		if not is_portal_user():
			return

		suppliers = get_portal_suppliers()

		# The claim must belong to one of this contractor's own work orders.
		# Resolved from the work order rather than trusting the posted
		# supplier field.
		wo_supplier = frappe.db.get_value(
			"Work Order Contract", self.civil_work_order, "supplier"
		)
		if not wo_supplier or wo_supplier not in suppliers:
			frappe.throw(
				_("You can only raise claims against your own work orders."),
				frappe.PermissionError,
			)
		self.supplier = wo_supplier

		# A contractor may only touch a claim that is theirs to edit.
		if self.docstatus != 0:
			frappe.throw(_("This claim is no longer editable."), frappe.PermissionError)
		state = self.get("review_state") or "Draft"
		if state not in ("Draft", "Returned for Revision"):
			frappe.throw(
				_("This claim is with {0} for review and cannot be changed.").format(
					frappe.bold(self.get("company") or _("the client"))
				),
				frappe.PermissionError,
			)

		# Deductions are the client's call, never the contractor's. Drop any
		# hand-added rows; validate() rebuilds the auto-suggested ones.
		manual = [d for d in (self.deductions or []) if not d.is_auto_suggested]
		if manual:
			self.set("deductions", [d for d in (self.deductions or []) if d.is_auto_suggested])

	cls._enforce_portal_scope = _enforce_portal_scope
	return cls


_portal_guard(WorkOrderRABill)


@frappe.whitelist()
def get_portal_work_orders():
	"""Work orders visible to the signed-in contractor, with billing progress.

	A contractor commonly holds SEVERAL work orders, so this always returns a
	list. Scoping is the Phase-1 permission layer's job — get_list applies it.
	"""
	from dux_civil_works.dux_work_orders.api.portal import is_portal_user

	if not is_portal_user():
		frappe.throw(_("Not a contractor portal user."), frappe.PermissionError)

	wos = frappe.get_list(
		"Work Order Contract",
		filters={"docstatus": 1},
		fields=[
			"name", "work_title", "company", "supplier", "wo_date",
			"total_amount", "site_location", "scheduled_completion_date",
		],
		order_by="wo_date desc",
		limit_page_length=0,
	)
	for wo in wos:
		agg = frappe.db.sql(
			"""select ifnull(sum(net_payable),0) certified, count(*) bills
			   from `tabWork Order RA Bill`
			   where civil_work_order=%s and docstatus=1""",
			(wo["name"],), as_dict=True,
		)[0]
		wo["certified"] = flt(agg.certified)
		wo["bills"] = agg.bills
		wo["open_claims"] = frappe.db.count(
			"Work Order RA Bill",
			{"civil_work_order": wo["name"], "docstatus": 0},
		)
	return wos


# ============================================================
# Contractor's tax invoice (Phase 5)
# ============================================================
# The contractor attaches THEIR invoice to an approved claim. They never
# create an accounting document — staff still raise the Purchase Invoice.
# This is a file plus three facts, nothing more.

#: Deliberately an allow-list — an upload box is the most attacked thing we
#: expose. Broad enough for how invoices actually arrive from a building site:
#: a scan (pdf/tiff), a phone photo (jpg/heic/webp), a screenshot (png).
#: .heic/.heif are accepted because that is an iPhone's default and refusing
#: it would just strand people; note most browsers cannot PREVIEW it, so it
#: downloads instead. Install pillow-heif if in-browser preview is wanted.
ALLOWED_INVOICE_EXTENSIONS = (
	".pdf",
	".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif",
	".tif", ".tiff", ".bmp",
)
#: Phone cameras routinely produce 6-8 MB stills, so 5 MB was too tight.
MAX_INVOICE_BYTES = 10 * 1024 * 1024


def _claim_for_invoice_upload(ra_bill):
	"""Load a claim the caller is allowed to attach an invoice to."""
	from dux_civil_works.dux_work_orders.api.portal import (
		get_portal_suppliers,
		is_portal_user,
	)

	doc = frappe.get_doc("Work Order RA Bill", ra_bill)
	doc.check_permission("read")

	if is_portal_user() and doc.supplier not in get_portal_suppliers():
		frappe.throw(_("Not your claim."), frappe.PermissionError)

	if doc.docstatus != 1 or (doc.get("review_state") or "") not in ("", "Approved"):
		frappe.throw(
			_("An invoice can only be attached once the claim has been approved."),
			frappe.PermissionError,
		)
	return doc


@frappe.whitelist()
def upload_supplier_invoice(ra_bill, invoice_no=None, invoice_date=None, invoice_amount=None):
	"""Attach the contractor's own tax invoice to an approved claim.

	Multipart: the file arrives in frappe.request.files["file"]. Stored
	private and linked to the claim, so it inherits the claim's read
	scoping — another contractor cannot fetch it.
	"""
	doc = _claim_for_invoice_upload(ra_bill)

	files = getattr(frappe.request, "files", None) or {}
	upload = files.get("file")
	if not upload:
		frappe.throw(_("No file was received."))

	filename = (getattr(upload, "filename", "") or "").strip()
	if not filename.lower().endswith(ALLOWED_INVOICE_EXTENSIONS):
		frappe.throw(
			_("Upload a PDF, a scan or a photo. Accepted: {0}.").format(
				", ".join(e.lstrip(".").upper() for e in ALLOWED_INVOICE_EXTENSIONS)
			)
		)

	content = upload.stream.read()
	if not content:
		frappe.throw(_("That file is empty."))
	if len(content) > MAX_INVOICE_BYTES:
		frappe.throw(_("That file is larger than 10 MB. Try a lower-resolution photo."))

	# Let Frappe sanitise the stored name; never trust the client's path.
	import os
	safe_name = os.path.basename(filename)[-140:]

	_file = frappe.get_doc({
		"doctype": "File",
		"file_name": safe_name,
		"attached_to_doctype": "Work Order RA Bill",
		"attached_to_name": doc.name,
		"attached_to_field": "supplier_invoice_file",
		"is_private": 1,
		"content": content,
	})
	try:
		# Frappe screens the file itself here — notably it parses PDFs to
		# reject embedded JavaScript. A corrupt or non-PDF file therefore
		# blows up deep in pypdf; turn that into something a contractor on a
		# building site can act on.
		_file.insert(ignore_permissions=True)
	except frappe.ValidationError:
		raise
	except Exception as exc:
		frappe.log_error(
			title="Contractor invoice upload rejected",
			message=f"{doc.name}: {safe_name}: {exc!r}",
		)
		frappe.throw(
			_("That file could not be read. Please upload a valid PDF or a clear photo."),
			title=_("Unreadable file"),
		)

	doc.db_set("supplier_invoice_file", _file.file_url, update_modified=False)
	if invoice_no:
		doc.db_set("supplier_invoice_no", str(invoice_no)[:140], update_modified=False)
	if invoice_date:
		doc.db_set("supplier_invoice_date", invoice_date, update_modified=False)
	if invoice_amount not in (None, ""):
		doc.db_set("supplier_invoice_amount", flt(invoice_amount), update_modified=False)
	frappe.db.commit()

	doc.add_comment("Comment", text=_("Contractor uploaded tax invoice {0}").format(invoice_no or safe_name))

	return {
		"file_url": _file.file_url,
		"file_name": safe_name,
		"supplier_invoice_no": doc.get("supplier_invoice_no"),
		"supplier_invoice_date": str(doc.get("supplier_invoice_date") or ""),
		"supplier_invoice_amount": flt(doc.get("supplier_invoice_amount") or 0),
	}


@frappe.whitelist()
def get_supplier_invoice(ra_bill):
	"""What the contractor has attached, for both sides of the app."""
	doc = frappe.get_doc("Work Order RA Bill", ra_bill)
	doc.check_permission("read")
	return {
		"supplier_invoice_no": doc.get("supplier_invoice_no"),
		"supplier_invoice_date": str(doc.get("supplier_invoice_date") or ""),
		"supplier_invoice_amount": flt(doc.get("supplier_invoice_amount") or 0),
		"supplier_invoice_file": doc.get("supplier_invoice_file"),
		"net_payable": flt(doc.get("net_payable") or 0),
		"review_state": doc.get("review_state"),
		"docstatus": doc.docstatus,
	}


@frappe.whitelist()
def get_open_claim(work_order):
	"""The live claim on this work order, if any. Read-scoped."""
	rows = frappe.get_list(
		"Work Order RA Bill",
		filters={"civil_work_order": work_order, "docstatus": 0},
		fields=["name", "review_state", "bill_date", "net_payable"],
		limit_page_length=0,
	)
	for r in rows:
		if (r.get("review_state") or "Draft") not in CLOSED_REVIEW_STATES:
			return r
	return None
