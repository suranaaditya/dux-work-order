// TypeScript shapes for the dux_civil_works doctypes, mirrored from the live
// schema on erp.jewonline.in (Frappe 16 / ERPNext 16). Child tables come back
// inline on the parent doc from /api/resource.

export interface BaseDoc {
  name: string;
  docstatus?: 0 | 1 | 2;
  creation?: string;
  modified?: string;
  owner?: string;
}

export interface WorkOrderBOQItem {
  name: string;
  idx?: number;
  item_no?: string;
  summary_head?: string; // Link -> Item (Work Order Items group)
  description?: string;
  uom?: string;
  estimated_qty?: number;
  rate?: number;
  tax_pct?: number;
  amount?: number;
  tax_amount?: number;
  amount_with_tax?: number;
  deviation_limit_pct?: number;
  remarks?: string;
  boq_row_uid?: string;
}

export interface WorkOrderSummaryItem {
  name: string;
  idx?: number;
  summary_head?: string;
  amount?: number;
  tax_amount?: number;
  amount_with_tax?: number;
}

export interface WorkOrderVariationRegisterRow {
  name: string;
  idx?: number;
  variation?: string; // Link -> Work Order Variation
  variation_number?: number;
  variation_date?: string;
  status?: string;
  reason_for_change?: string;
  value_with_tax?: number; // signed (deductive variations are negative)
}

export type VariationLineType = "Additional Qty" | "New Item" | "Reduced Qty";

export interface WorkOrderVariationItem {
  name: string;
  idx?: number;
  line_type?: VariationLineType;
  original_boq_row_uid?: string; // set for Additional/Reduced Qty; empty for New Item
  item_no?: string;
  summary_head?: string; // Link -> Item (Work Order Items group)
  description?: string;
  uom?: string;
  qty?: number; // stored SIGNED by the controller (Reduced Qty -> negative)
  rate?: number;
  tax_pct?: number;
  amount?: number;
  tax_amount?: number;
  amount_with_tax?: number;
  deviation_limit_pct?: number;
  remarks?: string;
  boq_row_uid?: string;
  original_qty?: number;
}

export interface WorkOrderVariation extends BaseDoc {
  work_order_contract?: string; // Link -> Work Order Contract
  variation_number?: number;
  variation_date?: string;
  company?: string;
  supplier?: string;
  reason_for_change?: string;
  variation_items?: WorkOrderVariationItem[];
  total_amount?: number;
  total_tax_amount?: number;
  total_amount_with_tax?: number;
}

export interface WorkOrderContract extends BaseDoc {
  workflow_state?: string;
  naming_series?: string;
  company?: string;
  company_abbr?: string;
  wo_date?: string;
  supplier?: string;
  supplier_name?: string;
  project?: string;
  work_title?: string;
  work_description?: string;
  site_location?: string;
  scheduled_start_date?: string;
  scheduled_completion_date?: string;
  boq_items?: WorkOrderBOQItem[];
  summary_items?: WorkOrderSummaryItem[];
  variations_register?: WorkOrderVariationRegisterRow[];
  total_amount?: number;
  total_tax_amount?: number;
  total_amount_with_tax?: number;
  retention_percentage?: number;
  mobilization_advance_pct?: number;
  mobilization_recovery_pct?: number;
  material_advance_pct?: number;
  material_recovery_pct?: number;
  dlp_months?: number;
  retention_release_on_final_bill?: number;
  retention_release_after_dlp?: number;
  apply_labour_cess?: 0 | 1;
  labour_cess_pct?: number;
  tds_category?: string;
  payment_terms?: string;
}

export interface WorkOrderRABillItem {
  name: string;
  idx?: number;
  boq_item_ref?: string;
  item_no?: string;
  scope_source?: string;
  summary_head?: string;
  description?: string;
  uom?: string;
  estimated_qty?: number;
  deviation_limit_pct?: number;
  previous_cumulative_qty?: number;
  cumulative_qty?: number;
  this_bill_qty?: number;
  rate?: number;
  this_bill_amount?: number;
  tax_pct?: number;
  this_bill_tax_amount?: number;
  this_bill_amount_with_tax?: number;
  boq_row_uid?: string;
}

export type DeductionNature =
  | "Retention"
  | "Mobilization Recovery"
  | "Material Recovery"
  | "TDS"
  | "Labour Cess"
  | "Penalty"
  | "Other Deduction"
  | "Price Escalation"
  | "Other Addition";

export interface WorkOrderRABillDeduction {
  name: string;
  idx?: number;
  nature?: DeductionNature;
  description?: string;
  amount?: number;
  gl_account?: string;
  is_auto_suggested?: 0 | 1;
}

export type BillingStatus =
  | "Draft"
  | "Pending Approval"
  | "Submitted"
  | "Partially Invoiced"
  | "Fully Invoiced"
  | "Closed"
  | "Cancelled";

export interface WorkOrderRABill extends BaseDoc {
  naming_series?: string;
  civil_work_order?: string; // Link -> Work Order Contract
  bill_date?: string;
  bill_number?: number;
  is_final_bill?: 0 | 1;
  period_from?: string;
  period_to?: string;
  company?: string;
  supplier?: string;
  project?: string;
  work_title?: string;
  items?: WorkOrderRABillItem[];
  deductions?: WorkOrderRABillDeduction[];
  gross_this_bill?: number;
  gross_this_bill_with_tax?: number;
  total_deductions?: number;
  total_additions?: number;
  net_payable?: number;
  invoiced_amount?: number;
  per_invoiced?: number;
  billing_status?: BillingStatus;
  workflow_state?: string;
}

// Additions vs deductions: negative-natured lines add to the bill.
export const ADDITION_NATURES: DeductionNature[] = ["Price Escalation", "Other Addition"];
export const isAddition = (nature?: DeductionNature) =>
  !!nature && ADDITION_NATURES.includes(nature);
