import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import {
  Btn,
  Card,
  Chip,
  Col,
  ErrorNote,
  KV,
  Loading,
  Money,
  Num,
  PageHead,
  SectionTitle,
  Table,
} from "../components/ui";
import { Icon } from "../components/icons";
import { ReviewBar, serverMessage, useReviewStatus } from "../components/ReviewBar";
import { fmtDate, inr, num, pct, qty } from "../lib/format";
import {
  isAddition,
  type WorkOrderRABill,
  type WorkOrderRABillDeduction,
  type WorkOrderRABillItem,
} from "../lib/types";

function BackLink() {
  return (
    <Link
      to="/ra-bills"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}
    >
      <Icon name="arrowLeft" size={15} /> RA Bills
    </Link>
  );
}

/* RA Bill actions.
 *
 * For a company that uses claim review the bill must be APPROVED through the
 * review chain (the server refuses a direct submit), so we show the review
 * actions plus a link into the review screen. Companies that haven't opted
 * in keep the plain Submit button exactly as before.
 */
function BillActions({ b, onChanged }: { b: WorkOrderRABill; onChanged: () => void }) {
  const nav = useNavigate();
  const submitCall = useFrappePostCall("frappe.client.submit");
  const { status, mutate: mutateStatus } = useReviewStatus(b.name);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    try {
      await submitCall.call({ doc: JSON.stringify(b) });
      onChanged();
    } catch (e: any) {
      setErr(serverMessage(e));
    }
  }

  const reviewed = !!status?.review_enabled;
  const fullyInvoiced = ["Fully Invoiced", "Closed", "Cancelled"].includes((b as any).billing_status);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {reviewed && b.docstatus === 0 && (
          <Btn onClick={() => nav(`/ra-bills/${encodeURIComponent(b.name)}/review`)}>
            <Icon name="ruler" size={15} /> Review claim
          </Btn>
        )}
        {!reviewed && b.docstatus === 0 && (
          <Btn variant="primary" onClick={submit} disabled={submitCall.loading}>
            {submitCall.loading ? "Submitting…" : "Submit bill"}
          </Btn>
        )}
        {b.docstatus === 1 && !fullyInvoiced && (
          <Btn variant="primary" onClick={() => nav(`/ra-bills/${encodeURIComponent(b.name)}/record-invoice`)}>
            <Icon name="bill" size={15} color="#fff" /> Record Invoice
          </Btn>
        )}
      </div>
      {reviewed && (
        <ReviewBar raBill={b.name} onChanged={() => { mutateStatus(); onChanged(); }} compact />
      )}
      {err && <span style={{ fontSize: 12, color: "var(--err)", maxWidth: 380, textAlign: "right" }}>{err}</span>}
    </div>
  );
}

/* The bill-computation rail: gross -> deductions/additions -> net payable. */
function Computation({ b }: { b: WorkOrderRABill }) {
  const deductions = (b.deductions || []).filter((d) => !isAddition(d.nature));
  const additions = (b.deductions || []).filter((d) => isAddition(d.nature));

  const Row = ({ d, sign }: { d: WorkOrderRABillDeduction; sign: "-" | "+" }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: "var(--text-secondary)" }}>
        {d.description || d.nature}
        {d.is_auto_suggested ? (
          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-faint)" }}>auto</span>
        ) : null}
      </span>
      <span className="mono" style={{ color: sign === "-" ? "var(--err)" : "var(--ok)", whiteSpace: "nowrap" }}>
        {sign} {num(d.amount)}
      </span>
    </div>
  );

  const line = <div style={{ height: 1, background: "var(--border-subtle)", margin: "6px 0" }} />;
  const invPct = Math.min(100, Math.max(0, Number(b.per_invoiced || 0)));

  return (
    <Card accent style={{ padding: 20, position: "sticky", top: 74 }}>
      <SectionTitle>Bill computation</SectionTitle>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
        <span style={{ color: "var(--text-secondary)" }}>Gross this bill</span>
        <span className="mono">{num(b.gross_this_bill)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0 6px", fontSize: 11.5, color: "var(--text-muted)" }}>
        <span>incl. GST (applied at Purchase Invoice)</span>
        <span className="mono">{num(b.gross_this_bill_with_tax)}</span>
      </div>

      {deductions.length > 0 && (
        <>
          {line}
          <div className="eyebrow" style={{ marginBottom: 2 }}>Deductions</div>
          {deductions.map((d) => (
            <Row key={d.name} d={d} sign="-" />
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, fontSize: 13, fontWeight: 600 }}>
            <span>Total deductions</span>
            <span className="mono" style={{ color: "var(--err)" }}>- {num(b.total_deductions)}</span>
          </div>
        </>
      )}

      {additions.length > 0 && (
        <>
          {line}
          <div className="eyebrow" style={{ marginBottom: 2 }}>Additions</div>
          {additions.map((d) => (
            <Row key={d.name} d={d} sign="+" />
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, fontSize: 13, fontWeight: 600 }}>
            <span>Total additions</span>
            <span className="mono" style={{ color: "var(--ok)" }}>+ {num(b.total_additions)}</span>
          </div>
        </>
      )}

      {line}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Net payable</span>
        <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--cyan)" }}>
          {inr(b.net_payable)}
        </span>
      </div>

      {/* Invoiced progress */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 5 }}>
          <span>Invoiced</span>
          <span className="mono">{num(b.invoiced_amount)} · {pct(b.per_invoiced)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: "var(--bg-sunken)", overflow: "hidden" }}>
          <div style={{ width: `${invPct}%`, height: "100%", background: "var(--gradient-accent)" }} />
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
        Net payable is the certified pre-tax value less site deductions. GST and TDS are applied on the
        Purchase Invoice, not on this certificate.
      </div>
    </Card>
  );
}

export default function RABillDetail() {
  const { name = "" } = useParams();
  const { data: b, isLoading, error, mutate } = useFrappeGetDoc<WorkOrderRABill>("Work Order RA Bill", name);

  if (isLoading) return <Loading label="Loading RA bill…" />;
  if (error) return <ErrorNote error={error} />;
  if (!b) return <ErrorNote error="RA Bill not found." />;

  const items = b.items || [];
  const statusChips = [b.review_state, b.billing_status].filter(Boolean) as string[];

  const cols: Col<WorkOrderRABillItem>[] = [
    { head: "#", cell: (r) => <span className="mono" style={{ color: "var(--text-muted)" }}>{r.item_no}</span>, width: 44 },
    {
      head: "Description",
      cell: (r) => (
        <span>
          {r.description || "—"}
          {r.scope_source && r.scope_source !== "original" ? (
            <span style={{ marginLeft: 6, fontSize: 10, color: "var(--iris)", background: "var(--iris-tint)", padding: "1px 6px", borderRadius: 999 }}>
              {r.scope_source}
            </span>
          ) : null}
        </span>
      ),
    },
    { head: "UOM", cell: (r) => r.uom || "—" },
    { head: "Prev cum.", align: "right", cell: (r) => <span className="mono">{qty(r.previous_cumulative_qty)}</span> },
    { head: "Cumulative", align: "right", cell: (r) => <span className="mono">{qty(r.cumulative_qty)}</span> },
    { head: "This bill", align: "right", cell: (r) => <span className="mono" style={{ fontWeight: 600 }}>{qty(r.this_bill_qty)}</span> },
    { head: "Rate", align: "right", cell: (r) => <Num v={r.rate} /> },
    { head: "Tax %", align: "right", cell: (r) => <span className="mono">{pct(r.tax_pct)}</span> },
    { head: "Amount", align: "right", cell: (r) => <Money v={r.this_bill_amount} /> },
  ];

  return (
    <>
      <BackLink />
      <PageHead
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {b.name}
            {statusChips.map((s) => (
              <Chip key={s} label={s} />
            ))}
            {b.is_final_bill ? <Chip label="Final Bill" /> : null}
          </span>
        }
        sub={
          <>
            Work Order{" "}
            <Link to={`/work-orders/${encodeURIComponent(b.civil_work_order || "")}`} style={{ color: "var(--iris)", fontWeight: 500 }}>
              {b.civil_work_order}
            </Link>
          </>
        }
        right={<BillActions b={b} onChanged={() => mutate()} />}
      />

      {/* Meta */}
      <Card style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 16 }}>
          <KV label="Bill number">{b.bill_number}</KV>
          <KV label="Bill date"><span className="mono">{fmtDate(b.bill_date)}</span></KV>
          <KV label="Period from"><span className="mono">{fmtDate(b.period_from)}</span></KV>
          <KV label="Period to"><span className="mono">{fmtDate(b.period_to)}</span></KV>
          <KV label="Supplier">{b.supplier}</KV>
          <KV label="Company">{b.company}</KV>
        </div>
      </Card>

      {/* Grid + computation */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 18, alignItems: "start" }}>
        <Card style={{ padding: "18px 0 6px" }}>
          <div style={{ padding: "0 18px" }}>
            <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{items.length} items</span>}>
              Measured items
            </SectionTitle>
          </div>
          {items.length ? (
            <Table cols={cols} rows={items} rowKey={(r) => r.name} />
          ) : (
            <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No item lines.</div>
          )}
        </Card>

        <Computation b={b} />
      </div>
    </>
  );
}
