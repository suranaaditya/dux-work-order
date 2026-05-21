// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

// Post-Phase-1.5c.4: live client-side compute of BOQ row amount + summary
// aggregation. The server controller still recomputes both in validate()
// — that's the source of truth on save. The handlers below give the user
// immediate visual feedback as they type, without waiting for a save.
//
// summary_items is unconditionally read_only at the doctype level (set
// in 1.5c.3 JSON). It is rebuilt client-side on every relevant change
// to boq_items; user cannot edit it directly.

frappe.ui.form.on("Work Order Contract", {
	setup(frm) {
		// Filter summary_head picker on BOQ Items child rows to service
		// Items in the "Work Order Items" group. summary_items.summary_head
		// gets the same query for completeness even though the table is
		// read-only — preserves the filter if a future change re-opens it.
		frm.set_query("summary_head", "summary_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
		frm.set_query("summary_head", "boq_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
	},

	boq_items_remove(frm) {
		// Row removed from BOQ — re-aggregate.
		rebuild_summary(frm);
	},
});

// NOTE: there is intentionally no refresh() handler that rebuilds the
// summary. The server controller already recomputes summary_items in
// validate() on every save, so the persisted form state is always
// correct. Rebuilding on refresh would call clear_table + add_child +
// set_value, all of which mark the doc dirty — making the form appear
// "Not Saved" immediately after a successful save and preventing the
// primary button from transitioning Save → Submit. The on-edit handlers
// above (estimated_qty, rate, summary_head, boq_items_remove) catch all
// the cases that need a live rebuild.

frappe.ui.form.on("Work Order BOQ Item", {
	estimated_qty(frm, cdt, cdn) {
		recompute_row_amount(cdt, cdn);
		frm.refresh_field("boq_items");
		rebuild_summary(frm);
	},
	rate(frm, cdt, cdn) {
		recompute_row_amount(cdt, cdn);
		frm.refresh_field("boq_items");
		rebuild_summary(frm);
	},
	tax_pct(frm, cdt, cdn) {
		// Finding 1 Part 1: per-row tax rate change. Recompute row
		// tax_amount + amount_with_tax, then rebuild the summary so the
		// dual totals stay live as the user types.
		recompute_row_amount(cdt, cdn);
		frm.refresh_field("boq_items");
		rebuild_summary(frm);
	},
	summary_head(frm) {
		// A row's summary head changed (or was set on a new row) — re-bucket.
		rebuild_summary(frm);
	},
});

function r2(x) {
	// Round to 2 decimals, matching server-side flt(x, 2).
	return Math.round((x + Number.EPSILON) * 100) / 100;
}

function recompute_row_amount(cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty = parseFloat(row.estimated_qty) || 0;
	const rate = parseFloat(row.rate) || 0;
	const tax_pct = parseFloat(row.tax_pct) || 0;
	row.amount = r2(qty * rate);
	row.tax_amount = r2(row.amount * tax_pct / 100);
	row.amount_with_tax = r2(row.amount + row.tax_amount);
}

function rebuild_summary(frm) {
	// Group BOQ rows by summary_head, sum amount + tax_amount in parallel.
	// Preserve first-occurrence ordering for a stable UI.
	const totals = {};
	const tax_totals = {};
	const order = [];
	(frm.doc.boq_items || []).forEach((r) => {
		if (!r.summary_head) return;
		if (!(r.summary_head in totals)) {
			totals[r.summary_head] = 0;
			tax_totals[r.summary_head] = 0;
			order.push(r.summary_head);
		}
		totals[r.summary_head] += parseFloat(r.amount) || 0;
		tax_totals[r.summary_head] += parseFloat(r.tax_amount) || 0;
	});

	frm.clear_table("summary_items");
	let total = 0;
	let total_tax = 0;
	order.forEach((head) => {
		const row = frm.add_child("summary_items");
		row.summary_head = head;
		row.amount = r2(totals[head]);
		row.tax_amount = r2(tax_totals[head]);
		row.amount_with_tax = r2(row.amount + row.tax_amount);
		total += row.amount;
		total_tax += row.tax_amount;
	});
	frm.refresh_field("summary_items");

	// Keep all three header totals in sync with the live summary.
	frm.set_value("total_amount", r2(total));
	frm.set_value("total_tax_amount", r2(total_tax));
	frm.set_value("total_amount_with_tax", r2(total + total_tax));
}
