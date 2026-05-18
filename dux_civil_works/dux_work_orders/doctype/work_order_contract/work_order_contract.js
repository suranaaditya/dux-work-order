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
	summary_head(frm) {
		// A row's summary head changed (or was set on a new row) — re-bucket.
		rebuild_summary(frm);
	},
});

function recompute_row_amount(cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty = parseFloat(row.estimated_qty) || 0;
	const rate = parseFloat(row.rate) || 0;
	row.amount = qty * rate;
}

function rebuild_summary(frm) {
	// Group BOQ rows by summary_head, sum amount. Preserve first-occurrence
	// ordering for a stable UI.
	const totals = {};
	const order = [];
	(frm.doc.boq_items || []).forEach((r) => {
		if (!r.summary_head) return;
		if (!(r.summary_head in totals)) {
			totals[r.summary_head] = 0;
			order.push(r.summary_head);
		}
		totals[r.summary_head] += parseFloat(r.amount) || 0;
	});

	frm.clear_table("summary_items");
	let total = 0;
	order.forEach((head) => {
		const row = frm.add_child("summary_items");
		row.summary_head = head;
		row.amount = totals[head];
		total += totals[head];
	});
	frm.refresh_field("summary_items");

	// Keep total_amount in sync with the live summary.
	frm.set_value("total_amount", total);
}
