// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

// Live client-side compute for variation line amount + tax overlay,
// mirroring Work Order Contract's BOQ row pattern (Finding 1 Part 1 +
// 1.5c.6 discipline). Server validate() is the source of truth on save;
// these handlers give the user immediate visual feedback as they type.
//
// CRITICAL: there is intentionally no refresh() handler that mutates
// variation_items. Per CLAUDE.md "1.5c.6 client-side rebuild on refresh
// marks form dirty" — refresh handlers that call set_value / clear_table
// re-mark the doc dirty and prevent Save → Submit transition. On-edit
// handlers below cover all live-recompute cases.

frappe.ui.form.on("Work Order Variation", {
	setup(frm) {
		// Filter summary_head picker on variation_items to service Items
		// in the "Work Order Items" group, mirroring Work Order Contract.
		// New Item lines are constrained to this group but need NOT
		// already exist on the parent WO (DESIGN.md 4.7).
		frm.set_query("summary_head", "variation_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
	},
});

frappe.ui.form.on("Work Order Variation Item", {
	qty(frm, cdt, cdn) {
		recompute_row_amount(cdt, cdn);
		frm.refresh_field("variation_items");
		recompute_totals(frm);
	},
	rate(frm, cdt, cdn) {
		recompute_row_amount(cdt, cdn);
		frm.refresh_field("variation_items");
		recompute_totals(frm);
	},
	tax_pct(frm, cdt, cdn) {
		recompute_row_amount(cdt, cdn);
		frm.refresh_field("variation_items");
		recompute_totals(frm);
	},
	line_type(frm, cdt, cdn) {
		// Switching to "New Item" clears the original UID reference;
		// switching to "Additional Qty" leaves it for the user to pick.
		const row = locals[cdt][cdn];
		if (row.line_type === "New Item" && row.original_boq_row_uid) {
			frappe.model.set_value(cdt, cdn, "original_boq_row_uid", "");
		}
	},
	variation_items_remove(frm) {
		// Row removed — re-aggregate totals.
		recompute_totals(frm);
	},
});

function r2(x) {
	// Round to 2 decimals, matching server-side flt(x, 2).
	return Math.round((x + Number.EPSILON) * 100) / 100;
}

function recompute_row_amount(cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty = parseFloat(row.qty) || 0;
	const rate = parseFloat(row.rate) || 0;
	const tax_pct = parseFloat(row.tax_pct) || 0;
	row.amount = r2(qty * rate);
	row.tax_amount = r2(row.amount * tax_pct / 100);
	row.amount_with_tax = r2(row.amount + row.tax_amount);
}

function recompute_totals(frm) {
	let total = 0;
	let total_tax = 0;
	(frm.doc.variation_items || []).forEach((r) => {
		total += parseFloat(r.amount) || 0;
		total_tax += parseFloat(r.tax_amount) || 0;
	});
	frm.set_value("total_amount", r2(total));
	frm.set_value("total_tax_amount", r2(total_tax));
	frm.set_value("total_amount_with_tax", r2(total + total_tax));
}
