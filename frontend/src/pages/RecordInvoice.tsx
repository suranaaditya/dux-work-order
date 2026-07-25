import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Card, PageHead, SectionTitle, Btn, Money, Num, ErrorNote, Loading } from "../components/ui";
import { Icon } from "../components/icons";
import { Field, TextInput, DateInput, LinkField } from "../components/form";
import type { WorkOrderRABill } from "../lib/types";

const ITEMS_METHOD = "dux_civil_works.dux_work_orders.api.purchase_invoice.get_items_from_ra_bills";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type PILine = {
  item_code: string;
  description: string;
  rate: number;
  wo_ra_bill: string;
  wo_ra_bill_item: string;
  expense_account?: string | null;
  item_tax_template: string; // "" = no tax
};

export default function RecordInvoice() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const { data: bill, isLoading, error } = useFrappeGetDoc<WorkOrderRABill>("Work Order RA Bill", name);
  const getItems = useFrappePostCall(ITEMS_METHOD);
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();

  const company = bill?.company;
  const supplier = bill?.supplier;

  // TDS is driven by the SUPPLIER's tax_withholding_category (no per-PI field);
  // apply_tds on the PI then computes TDS on submit.
  const { data: supplierDoc } = useFrappeGetDoc<any>("Supplier", supplier || undefined);

  // company abbr (for item-tax-template names)
  const { data: companyDoc } = useFrappeGetDoc<any>("Company", company || undefined);
  const abbr = companyDoc?.abbr;

  // GST-treatment options: the company's Input-GST purchase-tax templates
  const gstTemplates = useFrappeGetDocList<any>("Purchase Taxes and Charges Template", {
    fields: ["name"],
    filters: [["company", "=", company || ""], ["name", "like", "%GST%"]],
    limit: 0,
  });
  const itemTaxTemplates = useFrappeGetDocList<any>("Item Tax Template", {
    fields: ["name"],
    filters: [["company", "=", company || ""]],
    limit: 0,
  });

  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [prefilled, setPrefilled] = useState(false);
  const [gstTemplate, setGstTemplate] = useState("");
  const [applyTds, setApplyTds] = useState(false);
  const [tdsCategory, setTdsCategory] = useState("");
  const [lines, setLines] = useState<PILine[]>([]);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // map summary_head -> tax_pct (from the RA bill items)
  const headTax = useMemo(() => {
    const m: Record<string, number> = {};
    (bill?.items || []).forEach((it: any) => {
      if ((it.this_bill_qty || 0) > 0 && m[it.summary_head] == null) m[it.summary_head] = it.tax_pct || 0;
    });
    return m;
  }, [bill]);

  const templateForRate = (pct: number) =>
    (itemTaxTemplates.data || []).map((t: any) => t.name).find((n: string) => n.startsWith(`GST ${pct}% `)) || "";

  // pull PI lines (net, grouped by summary head) once the bill is loaded
  useEffect(() => {
    if (!name) return;
    getItems
      .call({ ra_bill_names: JSON.stringify([name]) })
      .then((r: any) => {
        const list = Array.isArray(r) ? r : r?.message ?? [];
        setLines(
          list.map((l: any) => ({
            item_code: l.item_code,
            description: l.description,
            rate: l.rate,
            wo_ra_bill: l.wo_ra_bill,
            wo_ra_bill_item: l.wo_ra_bill_item,
            expense_account: l.expense_account,
            item_tax_template: templateForRate(headTax[l.item_code] ?? 0),
          })),
        );
      })
      .catch((e: any) => setSubmitErr(e?.message || "Could not load invoice lines."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, itemTaxTemplates.data, bill]);

  // Default the GST treatment from the supplier's GST state vs the company's.
  // india_compliance rejects CGST/SGST on inter-state supplies and any GST on
  // an unregistered supplier, so we must pick In-state / Out-state / No-GST to
  // match — not blindly default to In-state (which errored for out-of-state or
  // unregistered suppliers). State = first 2 digits of the GSTIN.
  useEffect(() => {
    if (gstTemplate || !gstTemplates.data?.length) return;
    if (!supplierDoc || !companyDoc) return; // wait until both GSTINs are known
    const opts: string[] = gstTemplates.data.map((t: any) => t.name);
    const pick = (re: RegExp) => opts.find((n) => re.test(n) && !/RCM/i.test(n));
    const supGstin = String(supplierDoc.gstin || "").trim();
    const coGstin = String(companyDoc.gstin || "").trim();
    let chosen: string | undefined;
    if (!supGstin) {
      chosen = "__none__"; // unregistered supplier — no input GST
    } else if (coGstin && supGstin.slice(0, 2) === coGstin.slice(0, 2)) {
      chosen = pick(/In-state/i); // same state → CGST/SGST
    } else {
      chosen = pick(/Out-state/i); // different state → IGST
    }
    setGstTemplate(chosen || pick(/In-state/i) || opts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstTemplates.data, supplierDoc, companyDoc]);

  // If the contractor uploaded their own tax invoice against this claim, take
  // the number and date from it rather than making the accountant retype them.
  useEffect(() => {
    if (prefilled || !bill) return;
    const anyBill = bill as any;
    if (anyBill.supplier_invoice_no || anyBill.supplier_invoice_date) {
      if (anyBill.supplier_invoice_no) setBillNo(anyBill.supplier_invoice_no);
      if (anyBill.supplier_invoice_date) setBillDate(anyBill.supplier_invoice_date);
      setPrefilled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill]);

  // default the TDS category to whatever the supplier already has
  useEffect(() => {
    if (supplierDoc?.tax_withholding_category && !tdsCategory) setTdsCategory(supplierDoc.tax_withholding_category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierDoc]);

  if (isLoading) return <Loading label="Loading RA bill…" />;
  if (error) return <ErrorNote error={error} />;
  if (!bill) return <ErrorNote error="RA bill not found." />;

  const netTotal = lines.reduce((s, l) => s + (l.rate || 0), 0);
  const setLineTax = (i: number, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, item_tax_template: v } : l)));

  async function submit() {
    setSubmitErr(null);
    try {
      // TDS lives on the Supplier — set/refresh it there before invoicing.
      if (applyTds && tdsCategory && supplierDoc && tdsCategory !== supplierDoc.tax_withholding_category) {
        await updateDoc("Supplier", supplier!, { tax_withholding_category: tdsCategory });
      }
      let taxes: any[] = [];
      const useGst = gstTemplate && gstTemplate !== "__none__";
      if (useGst) {
        const res = await fetch(`/api/resource/Purchase Taxes and Charges Template/${encodeURIComponent(gstTemplate)}`, {
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        const j = await res.json();
        taxes = (j?.data?.taxes || []).map((t: any) => ({
          charge_type: t.charge_type,
          account_head: t.account_head,
          description: t.description,
          rate: t.rate,
          cost_center: t.cost_center,
          included_in_print_rate: t.included_in_print_rate,
          add_deduct_tax: t.add_deduct_tax,
          category: t.category,
        }));
      }
      const payload: any = {
        doctype: "Purchase Invoice",
        company,
        supplier,
        posting_date: billDate,
        set_posting_time: 1,
        bill_no: billNo || undefined,
        bill_date: billDate,
        is_wo_ra_bill_invoice: 1,
        taxes_and_charges: useGst ? gstTemplate : undefined,
        is_reverse_charge: useGst && /RCM/i.test(gstTemplate) ? 1 : 0,
        taxes,
        items: lines.map((l) => ({
          item_code: l.item_code,
          qty: 1,
          uom: "Nos",
          rate: l.rate,
          description: l.description,
          item_tax_template: l.item_tax_template || undefined,
          expense_account: l.expense_account || undefined,
          wo_ra_bill: l.wo_ra_bill,
          wo_ra_bill_item: l.wo_ra_bill_item,
        })),
        apply_tds: applyTds ? 1 : 0,
      };
      const doc = await createDoc("Purchase Invoice", payload);
      nav(`/invoices/${encodeURIComponent(doc.name)}`);
    } catch (e: any) {
      setSubmitErr(serverErr(e));
    }
  }

  const gstOpts = [{ v: "__none__", t: "No GST" }, ...((gstTemplates.data || []).map((t: any) => ({ v: t.name, t: t.name })))];
  const itemTaxOpts = [{ v: "", t: "No tax" }, ...((itemTaxTemplates.data || []).map((t: any) => ({ v: t.name, t: t.name })))];

  return (
    <>
      <Link to={`/ra-bills/${encodeURIComponent(name)}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> {name}
      </Link>
      <PageHead title="Record Invoice" sub={`Purchase Invoice against ${name} · ${bill.supplier}`} />

      {(bill as any)?.supplier_invoice_file && (
        <Card style={{ padding: 14, marginBottom: 16, borderLeft: "3px solid var(--ok)" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
            <span style={{ fontWeight: 650 }}>Contractor sent their tax invoice</span>
            <span className="mono" style={{ color: "var(--text-secondary)" }}>
              {(bill as any).supplier_invoice_no} · {(bill as any).supplier_invoice_date}
            </span>
            <a href={(bill as any).supplier_invoice_file} target="_blank" rel="noreferrer"
               style={{ color: "var(--iris)", fontWeight: 600, marginLeft: "auto" }}>Open document</a>
          </div>
        </Card>
      )}

      <Card style={{ padding: 20, marginBottom: 18 }}>
        <SectionTitle>Invoice details</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
          <Field label="Supplier invoice no"
                 hint={(bill as any)?.supplier_invoice_file ? "Taken from the invoice the contractor uploaded" : "The contractor's actual invoice number"}>
            <TextInput value={billNo} onChange={setBillNo} placeholder="e.g. INV-2026-045" />
          </Field>
          <Field label="Invoice date" required>
            <DateInput value={billDate} onChange={setBillDate} />
          </Field>
          <Field label="GST treatment" hint="India Compliance validates this against the supplier">
            <select value={gstTemplate} onChange={(e) => setGstTemplate(e.target.value)} style={selStyle}>
              {gstOpts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card style={{ padding: "18px 0 6px", marginBottom: 18 }}>
        <div style={{ padding: "0 18px" }}>
          <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{getItems.loading ? "loading…" : `${lines.length} lines`}</span>}>
            Invoice lines (net, per head)
          </SectionTitle>
        </div>
        <div className="scroll-x">
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                {["Item", "Detail", "Net amount", "GST rate"].map((h, i) => (
                  <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600, whiteSpace: "nowrap" }}>{l.item_code}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 380, color: "var(--text-secondary)", fontSize: 12, whiteSpace: "pre-wrap" }}>{(l.description || "").split("\n")[0]}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono"><Num v={l.rate} /></span></td>
                  <td style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-subtle)", width: 200 }}>
                    <select value={l.item_tax_template} onChange={(e) => setLineTax(i, e.target.value)} style={{ ...selStyle, height: 34 }}>
                      {itemTaxOpts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, padding: "14px 18px 4px", borderTop: "1px solid var(--border-subtle)", marginTop: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Taxable (net)</div>
            <div style={{ fontSize: 17 }}><Money v={netTotal} strong /></div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>GST computed by India Compliance on save</div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 20, marginBottom: 18 }}>
        <SectionTitle>TDS (Tax Withholding)</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <input type="checkbox" checked={applyTds} onChange={(e) => setApplyTds(e.target.checked)} /> Deduct TDS on this invoice
          </label>
          {applyTds && (
            <div style={{ minWidth: 280 }}>
              <LinkField doctype="Tax Withholding Category" value={tdsCategory} onChange={setTdsCategory} placeholder="Select TDS category" />
            </div>
          )}
        </div>
        {applyTds && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
            TDS is deducted on submit using the supplier's Tax Withholding Category — this sets it on <b>{supplier}</b>.
          </div>
        )}
      </Card>

      {submitErr && (
        <Card style={{ padding: 16, marginBottom: 18, borderColor: "var(--err-bg)" }}>
          <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>Could not create invoice</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: stripHtml(submitErr) }} />
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        <Btn variant="primary" onClick={submit} disabled={creating || !lines.length || (applyTds && !tdsCategory)}>
          {creating ? "Creating…" : "Create Invoice (Draft)"}
        </Btn>
      </div>
    </>
  );
}

const selStyle: React.CSSProperties = {
  height: 40,
  width: "100%",
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: 13.5,
  outline: "none",
  cursor: "pointer",
};

function stripHtml(s: string) {
  return String(s).replace(/\\n/g, "\n");
}

// Frappe puts the human-readable reason (e.g. the india_compliance GST error)
// in `_server_messages`; `e.message` is often just the generic "There was an
// error while creating the document". Prefer the real reason.
function serverErr(e: any): string {
  const raw = e?._server_messages || e?.response?.data?._server_messages;
  if (raw) {
    try {
      const msgs = JSON.parse(raw).map((s: any) => {
        try { return JSON.parse(s).message; } catch { return String(s); }
      });
      const joined = msgs.filter(Boolean).join("\n");
      if (joined) return joined;
    } catch { /* fall through to generic below */ }
  }
  return e?.exception || e?.message || "Could not create the invoice.";
}
