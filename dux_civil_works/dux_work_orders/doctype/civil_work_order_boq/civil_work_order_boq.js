// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

frappe.ui.form.on("Civil Work Order BOQ", {
	setup(frm) {
		// Filter summary_head picker on BOQ Items child rows to
		// service Items in the "Work Order Items" group.
		// (Phase 2 refinement: tighten to only the heads on the parent WO.)
		frm.set_query("summary_head", "boq_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
	},
});
