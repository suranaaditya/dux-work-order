// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

frappe.ui.form.on("Civil Work Order", {
	setup(frm) {
		// Filter summary_head picker on Summary Items child rows to
		// service Items in the "Work Order Items" group.
		frm.set_query("summary_head", "summary_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
	},
});
