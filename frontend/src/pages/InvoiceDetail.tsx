import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { Btn, Card, Chip, ErrorNote, KV, Loading, Money, Num, PageHead, SectionTitle, StatTile } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate } from "../lib/format";

export default function InvoiceDetail() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const { data: pi, isLoading, error, mutate } = useFrappeGetDoc<any>("Purchase Invoice", name);
  const submitCall = useFrappePostCall("frappe.client.submit");
  const [actErr, setActErr] = useState<string | null>(null);

  if (isLoading) return <Loading label="Loading invoice…" />;
  if (error) return <ErrorNote error={error} />;
  if (!pi) return <ErrorNote error="Invoice not found." />;

  const status = pi.docstatus === 2 ? "Cancelled" : pi.docstatus === 1 ? "Submitted" : "Draft";
  const raBills: string[] = Array.from(new Set((pi.items || []).map((i: any) => i.wo_ra_bill).filter(Boolean)));

  // Split taxes into GST (added) vs TDS (deducted) — TDS lands as a Deduct row on submit.
  const isTds = (t: any) => t.add_deduct_tax === "Deduct" || /TDS|withholding/i.test(t.account_head || "");
  const gstAmount = (pi.taxes || []).filter((t: any) => !isTds(t)).reduce((s: number, t: any) => s + (t.tax_amount || 0), 0);
  const tdsAmount = (pi.taxes || []).filter(isTds).reduce((s: number, t: any) => s + (t.tax_amount || 0), 0);

  async function submit() {
    setActErr(null);
    try {
      await submitCall.call({ doc: JSON.stringify(pi) });
      mutate();
    } catch (e: any) {
      setActErr(e?.message || "Could not submit.");
    }
  }

  return (
    <>
      <Link to="/invoices" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Invoices
      </Link>
      <PageHead
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>{pi.name}<Chip label={status} /></span>}
        sub={pi.bill_no ? `Supplier invoice ${pi.bill_no}` : pi.supplier}
        right={
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            {pi.docstatus === 0 && <Btn variant="primary" onClick={submit} disabled={submitCall.loading}>{submitCall.loading ? "Submitting…" : "Submit invoice"}</Btn>}
            {pi.docstatus === 1 && (pi.outstanding_amount || 0) > 0 && (
              <Btn variant="primary" onClick={() => nav(`/invoices/${encodeURIComponent(pi.name)}/pay`)}>
                <Icon name="rupee" size={15} color="#fff" /> Record Payment
              </Btn>
            )}
            {actErr && <span style={{ fontSize: 12, color: "var(--err)" }}>{actErr}</span>}
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatTile accent label="Taxable (net)" value={<Money v={pi.net_total} dec={0} />} />
        <StatTile label="GST" value={<Num v={gstAmount} />} />
        {tdsAmount ? <StatTile label="TDS deducted" value={<Num v={tdsAmount} />} /> : null}
        <StatTile label="Grand total" value={<Money v={pi.grand_total} dec={0} />} />
        {pi.docstatus === 1 ? <StatTile label="Outstanding" value={<Money v={pi.outstanding_amount} dec={0} />} /> : null}
      </div>

      <Card style={{ padding: 18, marginBottom: 18 }}>
        <SectionTitle>Details</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
          <KV label="Supplier">{pi.supplier}</KV>
          <KV label="Company">{pi.company}</KV>
          <KV label="Posting date"><span className="mono">{fmtDate(pi.posting_date)}</span></KV>
          <KV label="GST treatment">{pi.taxes_and_charges || "No GST"}</KV>
          <KV label="Reverse charge">{pi.is_reverse_charge ? "Yes" : "No"}</KV>
          <KV label="TDS">{pi.apply_tds ? (tdsAmount ? <><Num v={tdsAmount} /> deducted</> : "Applied (on submit)") : "No"}</KV>
          <KV label="RA Bills">{raBills.map((b) => <Link key={b} to={`/ra-bills/${encodeURIComponent(b)}`} style={{ color: "var(--iris)", marginRight: 8 }}>{b}</Link>)}</KV>
        </div>
      </Card>

      <Card style={{ padding: "18px 0 6px", marginBottom: 18 }}>
        <div style={{ padding: "0 18px" }}><SectionTitle>Items</SectionTitle></div>
        <div className="scroll-x">
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>{["Item", "Description", "Qty", "Rate", "Amount", "Tax template"].map((h, i) => (
                <th key={i} style={{ textAlign: i > 1 && i < 5 ? "right" : "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(pi.items || []).map((it: any, i: number) => (
                <tr key={i}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600, whiteSpace: "nowrap" }}>{it.item_code}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 340, color: "var(--text-secondary)", fontSize: 12 }}>{(it.description || "").split("\n")[0]}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }} className="mono">{it.qty}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }} className="mono"><Num v={it.rate} /></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }} className="mono"><Num v={it.amount} /></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", fontSize: 12, color: "var(--text-muted)" }}>{it.item_tax_template || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(pi.taxes || []).length > 0 && (
        <Card style={{ padding: "18px 0 6px" }}>
          <div style={{ padding: "0 18px" }}><SectionTitle>Taxes</SectionTitle></div>
          <div className="scroll-x">
            <table style={{ fontSize: 13 }}>
              <thead><tr>{["Account", "Rate", "Tax amount"].map((h, i) => (
                <th key={i} style={{ textAlign: i ? "right" : "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {(pi.taxes || []).map((t: any, i: number) => (
                  <tr key={i}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>{t.account_head}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }} className="mono">{t.rate}%</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }} className="mono"><Num v={t.tax_amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
