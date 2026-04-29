// Copyright (c) 2026, Dutch Digitech and contributors
// Purchase Invoice client-side enhancements for Work Order RA Bill integration.

frappe.ui.form.on("Purchase Invoice", {
	refresh(frm) {
		if (frm.doc.is_wo_ra_bill_invoice
			&& frm.doc.supplier
			&& frm.doc.company
			&& frm.doc.docstatus === 0) {
			frm.add_custom_button(__("Get Items From RA Bill"), () => {
				show_ra_bill_picker(frm);
			}, __("Get Items From"));
		}
	},

	is_wo_ra_bill_invoice(frm) {
		frm.refresh();
	},

	onload_post_render(frm) {
		update_referenced_ra_bills(frm);
	},
});

function show_ra_bill_picker(frm) {
	frappe.call({
		method: "dux_civil_works.dux_civil_works.api.purchase_invoice.get_open_ra_bills",
		args: {
			company: frm.doc.company,
			supplier: frm.doc.supplier,
		},
		callback(r) {
			const bills = r.message || [];
			if (!bills.length) {
				frappe.msgprint(__(
					"No open Work Order RA Bills found for this Company + Supplier. "
					+ "RA Bills must be Submitted and not yet Fully Invoiced."
				));
				return;
			}

			const dialog = new frappe.ui.Dialog({
				title: __("Select Work Order RA Bills"),
				size: "extra-large",
				fields: [
					{
						fieldname: "ra_bills",
						fieldtype: "Table",
						label: __("Open RA Bills"),
						cannot_add_rows: true,
						cannot_delete_rows: true,
						in_place_edit: false,
						data: bills.map(b => ({
							select: 0,
							ra_bill: b.name,
							wo: b.civil_work_order,
							work_title: b.work_title,
							bill_no: b.bill_number,
							bill_date: b.bill_date,
							net_payable: b.net_payable,
							invoiced: b.invoiced_amount,
							remaining: b.remaining_to_invoice,
							status: b.billing_status,
						})),
						fields: [
							{ fieldtype: "Check", fieldname: "select", label: __("Select"), in_list_view: 1, columns: 1 },
							{ fieldtype: "Link", fieldname: "ra_bill", label: __("RA Bill"), options: "Work Order RA Bill", in_list_view: 1, read_only: 1, columns: 2 },
							{ fieldtype: "Data", fieldname: "wo", label: __("WO"), in_list_view: 1, read_only: 1, columns: 2 },
							{ fieldtype: "Data", fieldname: "work_title", label: __("Title"), in_list_view: 1, read_only: 1, columns: 2 },
							{ fieldtype: "Int", fieldname: "bill_no", label: __("RA #"), in_list_view: 1, read_only: 1, columns: 1 },
							{ fieldtype: "Currency", fieldname: "remaining", label: __("Remaining"), in_list_view: 1, read_only: 1, columns: 2 },
						],
					},
				],
				primary_action_label: __("Get Items"),
				primary_action(values) {
					const selected = (values.ra_bills || [])
						.filter(r => r.select)
						.map(r => r.ra_bill);
					if (!selected.length) {
						frappe.msgprint(__("Tick at least one RA Bill."));
						return;
					}
					fetch_items_into_pi(frm, selected);
					dialog.hide();
				},
			});
			dialog.show();
		},
	});
}

function fetch_items_into_pi(frm, ra_bill_names) {
	frappe.call({
		method: "dux_civil_works.dux_civil_works.api.purchase_invoice.get_items_from_ra_bills",
		args: { ra_bill_names: JSON.stringify(ra_bill_names) },
		freeze: true,
		freeze_message: __("Fetching items from RA Bills..."),
		callback(r) {
			const items = r.message || [];
			if (!items.length) {
				frappe.msgprint(__("No chargeable items found in the selected RA Bills."));
				return;
			}

			if ((frm.doc.items || []).length > 0) {
				frappe.confirm(
					__("This PI already has items. Replace them with items from the selected RA Bills?"),
					() => populate_items(frm, items),
				);
			} else {
				populate_items(frm, items);
			}
		},
	});
}

function populate_items(frm, items) {
	frm.clear_table("items");
	items.forEach(it => {
		const row = frm.add_child("items");
		Object.assign(row, it);
	});
	frm.refresh_field("items");
	update_referenced_ra_bills(frm);
	frappe.show_alert({
		message: __("Added {0} items from RA Bills.", [items.length]),
		indicator: "green",
	});
}

function update_referenced_ra_bills(frm) {
	if (!frm.doc.is_wo_ra_bill_invoice || !frm.doc.name) return;
	frappe.call({
		method: "dux_civil_works.dux_civil_works.api.purchase_invoice.get_referenced_ra_bills_summary",
		args: { pi_name: frm.doc.name },
		callback(r) {
			const rows = r.message || [];
			const summary = rows.length
				? rows.map(row => `${row.wo_ra_bill}: ${format_currency(row.total_amount)}`).join(", ")
				: "";
			frm.set_value("wo_ra_bills_referenced", summary);
		},
	});
}
