/* Child-table reads + the payment lookup shared by InvoiceDetail and the
 * Work Order Statement.
 *
 * Payment Entry -> Purchase Invoice linkage lives in the `Payment Entry
 * Reference` child table. Listing a CHILD doctype through Frappe's REST API
 * requires a `parent=<Parent DocType>` query param — without it the server
 * returns rows containing only `name` and silently drops every other
 * requested field. frappe-react-sdk does not forward `parent`, so these
 * reads go through fetch directly (same-origin, cookie auth — the pattern
 * RecordInvoice already uses for tax templates).
 *
 * Stays frontend-only: no new backend endpoint, no server restart.
 */
import { useEffect, useState } from "react";

/** List rows of a child doctype (requires its parent doctype). */
export function useChildTable<T = any>(
  doctype: string,
  parent: string,
  fields: string[],
  filters: any[],
  enabled = true,
) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const key = JSON.stringify([doctype, parent, fields, filters, enabled]);

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      fields: JSON.stringify(fields),
      filters: JSON.stringify(filters),
      parent,
      limit_page_length: "0",
    });
    fetch(`/api/resource/${encodeURIComponent(doctype)}?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setData(j?.data || []);
        setIsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, isLoading, error };
}

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

export interface ResolvedPayment {
  payment: string;
  invoice: string;
  allocated: number;
  posting_date?: string;
  mode_of_payment?: string;
  reference_no?: string;
}

/** Payments allocated to a set of invoices, joined to their Payment Entry. */
export function usePaymentsForInvoices(invoiceNames: string[]) {
  const refs = useChildTable<PaymentRef>(
    "Payment Entry Reference",
    "Payment Entry",
    ["name", "parent", "reference_name", "allocated_amount"],
    [
      ["reference_doctype", "=", "Purchase Invoice"],
      ["reference_name", "in", invoiceNames],
      ["docstatus", "=", 1],
    ],
    invoiceNames.length > 0,
  );

  const payNames = Array.from(new Set((refs.data || []).map((r) => r.parent).filter(Boolean)));
  const [entries, setEntries] = useState<PaymentEntryRow[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const payKey = payNames.slice().sort().join(",");

  useEffect(() => {
    if (!payNames.length) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoadingEntries(true);
    const qs = new URLSearchParams({
      fields: JSON.stringify(["name", "posting_date", "mode_of_payment", "reference_no", "paid_amount", "docstatus"]),
      filters: JSON.stringify([["name", "in", payNames]]),
      limit_page_length: "0",
    });
    fetch(`/api/resource/Payment%20Entry?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setEntries(j?.data || []);
        setLoadingEntries(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingEntries(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payKey]);

  const byName = new Map(entries.map((e) => [e.name, e]));
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
    isLoading: refs.isLoading || loadingEntries,
    error: refs.error,
    totalPaid: rows.reduce((s, r) => s + r.allocated, 0),
  };
}
