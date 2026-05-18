// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

frappe.ui.form.on("Work Order Contract", {
	setup(frm) {
		// Filter summary_head picker on Summary Items child rows to
		// service Items in the "Work Order Items" group.
		frm.set_query("summary_head", "summary_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
		// Same filter for BOQ Items child rows.
		frm.set_query("summary_head", "boq_items", () => ({
			filters: { item_group: "Work Order Items", disabled: 0 },
		}));
	},

	refresh(frm) {
		// When boq_items has rows, summary_items is auto-aggregated by the
		// controller — disable manual editing to make this visible to the user.
		const has_boq = frm.doc.boq_items && frm.doc.boq_items.length > 0;
		frm.toggle_enable("summary_items", !has_boq);
	},
});
