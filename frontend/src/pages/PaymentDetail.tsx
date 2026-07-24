import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { Btn, Card, Chip, Col, ErrorNote, KV, Loading, Money, Num, PageHead, SectionTitle, StatTile, Table } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate } from "../lib/format";

export default function PaymentDetail() {
  const { name = "" } = useParams();
  const { data: pe, isLoading, error, mutate } = useFrappeGetDoc<any>("Payment Entry", name);
  const submitCall = useFrappePostCall("frappe.client.submit");
  const [actErr, setActErr] = useState<string | null>(null);

  if (isLoading) return <Loading label="Loading payment…" />;
  if (error) return <ErrorNote error={error} />;
  if (!pe) return <ErrorNote error="Payment not found." />;

  const status = pe.docstatus === 2 ? "Cancelled" : pe.docstatus === 1 ? "Submitted" : "Draft";
  const deductionTotal = (pe.deductions || []).reduce((s: number, d: any) => s + (d.amount || 0), 0);

  async function submit() {
    setActErr(null);
    try {
      await submitCall.call({ doc: JSON.stringify(pe) });
      mutate();
    } catch (e: any) {
      setActErr(e?.message || "Could not submit.");
    }
  }

  const refCols: Col<any>[] = [
    { head: "Invoice", cell: (r) => <Link to={`/invoices/${encodeURIComponent(r.reference_name)}`} style={{ color: "var(--iris)", fontWeight: 600 }}>{r.reference_name}</Link> },
    { head: "Type", cell: (r) => r.reference_doctype },
    { head: "Outstanding", align: "right", cell: (r) => <Num v={r.outstanding_amount} /> },
    { head: "Allocated", align: "right", cell: (r) => <Num v={r.allocated_amount} /> },
  ];

  return (
    <>
      <Link to="/payments" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Payments
      </Link>
      <PageHead
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>{pe.name}<Chip label={status} /></span>}
        sub={`${pe.party} · ${pe.mode_of_payment || "payment"}`}
        right={
          pe.docstatus === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              <Btn variant="primary" onClick={submit} disabled={submitCall.loading}>{submitCall.loading ? "Submitting…" : "Submit payment"}</Btn>
              {actErr && <span style={{ fontSize: 12, color: "var(--err)" }}>{actErr}</span>}
            </div>
          ) : null
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatTile accent label="Paid amount" value={<Money v={pe.paid_amount} dec={0} />} />
        {deductionTotal ? <StatTile label="Deductions" value={<Num v={deductionTotal} />} /> : null}
        <StatTile label="Unallocated" value={<Num v={pe.unallocated_amount} />} />
      </div>

      <Card style={{ padding: 18, marginBottom: 18 }}>
        <SectionTitle>Details</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
          <KV label="Supplier">{pe.party}</KV>
          <KV label="Company">{pe.company}</KV>
          <KV label="Posting date"><span className="mono">{fmtDate(pe.posting_date)}</span></KV>
          <KV label="Paid from">{pe.paid_from}</KV>
          <KV label="Mode">{pe.mode_of_payment || "—"}</KV>
          <KV label="UTR / ref"><span className="mono" style={{ fontSize: 12.5 }}>{pe.reference_no || "—"}</span></KV>
          <KV label="Ref date"><span className="mono">{fmtDate(pe.reference_date)}</span></KV>
        </div>
      </Card>

      {(pe.references || []).length > 0 && (
        <Card style={{ padding: "18px 0 6px" }}>
          <div style={{ padding: "0 18px" }}><SectionTitle>Against invoices</SectionTitle></div>
          <Table cols={refCols} rows={pe.references} rowKey={(r: any, i: number) => r.name || i} />
        </Card>
      )}
    </>
  );
}
