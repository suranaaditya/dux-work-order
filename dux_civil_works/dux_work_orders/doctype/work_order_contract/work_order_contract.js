// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

// Post-Phase-1.5c.3: summary_items is unconditionally read_only at the
// doctype level (in JSON). The earlier refresh() handler that toggled
// summary_items editability based on boq_items presence has been removed
// — it was leftover from the brief 1.5c.1 window when the old
// two-document flow coexisted with the new one. After 1.5c.2 deleted
// Civil Work Order BOQ, summary_items is always auto-aggregated from
// boq_items, never user-editable.
frappe.ui.form.on("Work Order Contract", {
	setup(frm) {
		// Filter summary_head picker on BOQ Items child rows to service
		// Items in the "Work Order Items" group. summary_items.summary_head
		// is also kept on the same query for completeness, even though
		// summary_items is read-only — preserves the filter if a future
		// change re-opens editing.
		frm.set_query("summary_head", "summary_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
		frm.set_query("summary_head", "boq_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
	},
});
