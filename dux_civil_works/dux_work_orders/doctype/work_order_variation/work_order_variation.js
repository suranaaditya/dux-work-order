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
//
// Build 2.1: dialog picker for Additional Qty lines (the "Pick Original"
// button on the variation_items child). Engineer clicks an original BOQ
// row from a table; the line auto-fills (head/uom locked, description
// /rate/tax_pct editable). Server _validate_additional_qty_lines is the
// belt-and-suspenders guard.

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
		// Switching to "New Item" clears the original-row references
		// (original_boq_row_uid + original_qty); New Item lines have no
		// original to extend. Switching to "Additional Qty" leaves
		// fields blank for the user to pick from the dialog.
		const row = locals[cdt][cdn];
		if (row.line_type === "New Item") {
			if (row.original_boq_row_uid) {
				frappe.model.set_value(cdt, cdn, "original_boq_row_uid", "");
			}
			if (row.original_qty) {
				frappe.model.set_value(cdt, cdn, "original_qty", 0);
			}
		}
	},
	pick_original(frm, cdt, cdn) {
		// "Pick Original" button on the variation_items child grid.
		const row = locals[cdt][cdn];
		if (row.line_type !== "Additional Qty") {
			frappe.msgprint({
				title: __("Not applicable"),
				message: __(
					"The Pick Original button applies only to Additional Qty " +
					"lines. New Item lines are free-entry (the variation introduces " +
					"a brand-new item, so there is no original to pick from)."
				),
				indicator: "blue",
			});
			return;
		}
		if (!frm.doc.work_order_contract) {
			frappe.msgprint({
				title: __("Select Work Order first"),
				message: __(
					"Set the Work Order Contract on this variation before picking " +
					"an original BOQ row."
				),
				indicator: "orange",
			});
			return;
		}
		open_original_picker(frm, cdt, cdn);
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

function esc_html(s) {
	if (s === null || s === undefined) return "";
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function open_original_picker(frm, cdt, cdn) {
	// Build a dialog with a TABLE (not a Select / Link) listing the
	// parent WO's boq_items. The table caters to long BOQ descriptions
	// (which routinely exceed 200 chars and would overflow a dropdown).
	// On row click, fill the variation line via frappe.model.set_value
	// and close the dialog.
	frappe.db
		.get_doc("Work Order Contract", frm.doc.work_order_contract)
		.then((wo) => {
			const rows = wo.boq_items || [];
			if (!rows.length) {
				frappe.msgprint({
					title: __("No BOQ rows on Work Order"),
					message: __(
						"Work Order {0} has no BOQ rows; nothing to pick from.",
						[frm.doc.work_order_contract]
					),
					indicator: "orange",
				});
				return;
			}

			const html_rows = rows
				.map((r, i) => {
					// Each row clickable; we use data-idx so the click
					// handler below can resolve it back to the source row.
					return `
						<tr class="wov-pick-row" data-idx="${i}"
						    style="cursor:pointer;">
							<td style="white-space:nowrap;vertical-align:top;">
								${esc_html(r.item_no || "")}
							</td>
							<td style="white-space:normal;vertical-align:top;
							           word-break:break-word;">
								${esc_html(r.description || "")}
							</td>
							<td style="white-space:nowrap;vertical-align:top;">
								${esc_html(r.uom || "")}
							</td>
							<td style="text-align:right;white-space:nowrap;
							           vertical-align:top;">
								${format_currency(r.rate || 0)}
							</td>
							<td style="text-align:right;white-space:nowrap;
							           vertical-align:top;">
								${(r.tax_pct || 0).toFixed(2)}%
							</td>
						</tr>`;
				})
				.join("");

			const html = `
				<div class="wov-pick-wrap" style="max-height:60vh;overflow:auto;">
					<table class="table table-bordered table-sm"
					       style="font-size:0.85em;">
						<thead style="position:sticky;top:0;background:#f5f5f5;
						              z-index:1;">
							<tr>
								<th style="width:10%;">Item No</th>
								<th style="width:55%;">Description</th>
								<th style="width:10%;">UOM</th>
								<th style="width:12%;text-align:right;">Rate</th>
								<th style="width:8%;text-align:right;">Tax %</th>
							</tr>
						</thead>
						<tbody>${html_rows}</tbody>
					</table>
				</div>
				<p class="text-muted small" style="margin-top:6px;">
					Click a row to fill this variation line. Summary head and
					UOM will be locked to match the original; description, rate
					and tax can be edited after picking.
				</p>`;

			const dialog = new frappe.ui.Dialog({
				title: __("Select Original BOQ Item — {0}", [
					frm.doc.work_order_contract,
				]),
				size: "extra-large",
				fields: [
					{ fieldtype: "HTML", fieldname: "picker_html" },
				],
			});
			dialog.fields_dict.picker_html.$wrapper.html(html);
			dialog.$wrapper
				.find(".wov-pick-row")
				.on("mouseenter", function () {
					$(this).css("background", "#f0f7ff");
				})
				.on("mouseleave", function () {
					$(this).css("background", "");
				})
				.on("click", function () {
					const idx = parseInt($(this).attr("data-idx"), 10);
					const src = rows[idx];
					fill_from_original(frm, cdt, cdn, src);
					dialog.hide();
				});
			dialog.show();
		})
		.catch((err) => {
			console.error("Pick Original — failed to load WO:", err);
			frappe.msgprint({
				title: __("Could not load Work Order"),
				message: __(
					"Failed to load BOQ rows from Work Order {0}.",
					[frm.doc.work_order_contract]
				),
				indicator: "red",
			});
		});
}

function fill_from_original(frm, cdt, cdn, src) {
	// Order matters: set original_boq_row_uid first (it's the load-
	// bearing identity), then the rest. set_value triggers per-field
	// handlers (tax_pct, rate) which call recompute_row_amount —
	// chaining via .then() ensures qty/rate/tax are in place before
	// the recompute runs.
	frappe.model
		.set_value(cdt, cdn, "original_boq_row_uid", src.boq_row_uid || "")
		.then(() => frappe.model.set_value(cdt, cdn, "summary_head", src.summary_head || ""))
		.then(() => frappe.model.set_value(cdt, cdn, "uom", src.uom || ""))
		.then(() => frappe.model.set_value(cdt, cdn, "item_no", src.item_no || ""))
		.then(() => frappe.model.set_value(cdt, cdn, "description", src.description || ""))
		.then(() => frappe.model.set_value(cdt, cdn, "original_qty", src.estimated_qty || 0))
		.then(() => frappe.model.set_value(cdt, cdn, "rate", src.rate || 0))
		.then(() => frappe.model.set_value(cdt, cdn, "tax_pct", src.tax_pct || 0))
		.then(() =>
			frappe.model.set_value(
				cdt,
				cdn,
				"deviation_limit_pct",
				src.deviation_limit_pct || 0
			)
		)
		.then(() => {
			recompute_row_amount(cdt, cdn);
			frm.refresh_field("variation_items");
			recompute_totals(frm);
		});
}
