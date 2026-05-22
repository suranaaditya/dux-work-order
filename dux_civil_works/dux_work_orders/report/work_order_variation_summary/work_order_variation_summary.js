// Copyright (c) 2026, Dutch Digitech and contributors
// For license information, please see license.txt

frappe.query_reports["Work Order Variation Summary"] = {
	filters: [
		{
			fieldname: "work_order_contract",
			label: __("Work Order Contract"),
			fieldtype: "Link",
			options: "Work Order Contract",
			reqd: 1,
			get_query() {
				return { filters: { docstatus: 1 } };
			},
		},
	],
};
