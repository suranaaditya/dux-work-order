/* Payment lookup shared by InvoiceDetail and the Work Order Statement.
 *
 * Payment Entry -> Purchase Invoice linkage lives in the `Payment Entry
 * Reference` child table. Frappe's /api/resource exposes child doctypes
 * directly as long as `parent` is passed, so this stays frontend-only —
 * no new backend endpoint, no restart.
 */
import { useFrappeGetDocList } from "frappe-react-sdk";

export interface PaymentRef {
  name: string;
  parent: string; // the Payment Entry
  reference_name: string; // the Purchase Invoice
  allocated_amount?: number;
}

export interface PaymentEntryRow {
  name: string;
  posting_date?: string;
  mode_of_payment?: string;
  reference_no?: string;
  paid_amount?: number;
  docstatus?: 0 | 1 | 2;
}

/** Payment Entry Reference rows pointing at the given invoice names. */
export function usePaymentRefs(invoiceNames: string[]) {
  const key = invoiceNames.slice().sort().join(",");
  return useFrappeGetDocList<PaymentRef>("Payment Entry Reference", {
    fields: ["name", "parent", "reference_name", "allocated_amount"],
    filters: [
      ["reference_doctype", "=", "Purchase Invoice"],
      ["reference_name", "in", invoiceNames],
      ["docstatus", "=", 1],
    ],
    limit: 0,
    parent: "Payment Entry",
  }, invoiceNames.length ? `pay-refs-${key}` : null);
}

/** The Payment Entry headers for the given payment names. */
export function usePaymentEntries(paymentNames: string[]) {
  const key = paymentNames.slice().sort().join(",");
  return useFrappeGetDocList<PaymentEntryRow>("Payment Entry", {
    fields: ["name", "posting_date", "mode_of_payment", "reference_no", "paid_amount", "docstatus"],
    filters: [["name", "in", paymentNames]],
    limit: 0,
    orderBy: { field: "posting_date", order: "asc" },
  }, paymentNames.length ? `pay-entries-${key}` : null);
}

export interface ResolvedPayment {
  payment: string;
  invoice: string;
  allocated: number;
  posting_date?: string;
  mode_of_payment?: string;
  reference_no?: string;
}

/** Payments allocated to a set of invoices, joined and date-sorted. */
export function usePaymentsForInvoices(invoiceNames: string[]) {
  const refs = usePaymentRefs(invoiceNames);
  const payNames = Array.from(new Set((refs.data || []).map((r) => r.parent)));
  const entries = usePaymentEntries(payNames);

  const byName = new Map((entries.data || []).map((e) => [e.name, e]));
  const rows: ResolvedPayment[] = (refs.data || []).map((r) => {
    const pe = byName.get(r.parent);
    return {
      payment: r.parent,
      invoice: r.reference_name,
      allocated: r.allocated_amount || 0,
      posting_date: pe?.posting_date,
      mode_of_payment: pe?.mode_of_payment,
      reference_no: pe?.reference_no,
    };
  });
  rows.sort((a, b) => String(a.posting_date || "").localeCompare(String(b.posting_date || "")));

  return {
    rows,
    isLoading: refs.isLoading || entries.isLoading,
    error: refs.error || entries.error,
    totalPaid: rows.reduce((s, r) => s + r.allocated, 0),
  };
}
