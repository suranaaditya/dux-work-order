import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { Btn, Card, Chip, Col, ErrorNote, KV, Loading, Money, Num, PageHead, SectionTitle, Table } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate, num, pct } from "../lib/format";
import type { VariationLineType, WorkOrderVariation, WorkOrderVariationItem } from "../lib/types";

const TYPE_TONE: Record<string, { c: string; bg: string }> = {
  "Additional Qty": { c: "var(--ok)", bg: "var(--ok-bg)" },
  "New Item": { c: "var(--iris)", bg: "var(--iris-tint)" },
  "Reduced Qty": { c: "var(--err)", bg: "var(--err-bg)" },
};
function TypeBadge({ t }: { t?: VariationLineType }) {
  if (!t) return null;
  const s = TYPE_TONE[t] || { c: "var(--text-secondary)", bg: "var(--bg-sunken)" };
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: s.c, background: s.bg, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {t}
    </span>
  );
}

const statusOf = (v: WorkOrderVariation) => (v.docstatus === 1 ? "Submitted" : v.docstatus === 2 ? "Cancelled" : "Draft");

function Actions({ v, onChanged }: { v: WorkOrderVariation; onChanged: () => void }) {
  const submitCall = useFrappePostCall("frappe.client.submit");
  const cancelCall = useFrappePostCall("frappe.client.cancel");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    try {
      await submitCall.call({ doc: JSON.stringify(v) });
      onChanged();
    } catch (e: any) {
      setErr(e?.message || e?._server_messages || "Could not submit.");
    }
  }
  async function cancel() {
    setErr(null);
    try {
      await cancelCall.call({ doctype: "Work Order Variation", name: v.name });
      onChanged();
    } catch (e: any) {
      setErr(e?.message || e?._server_messages || "Could not cancel.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 10 }}>
        {v.docstatus === 0 && (
          <Btn variant="primary" onClick={submit} disabled={submitCall.loading}>
            {submitCall.loading ? "Submitting…" : "Submit variation"}
          </Btn>
        )}
        {v.docstatus === 1 && (
          <Btn variant="secondary" onClick={cancel} disabled={cancelCall.loading}>
            {cancelCall.loading ? "Cancelling…" : "Cancel variation"}
          </Btn>
        )}
      </div>
      {err && <span style={{ fontSize: 12, color: "var(--err)", maxWidth: 320, textAlign: "right", whiteSpace: "pre-wrap" }}>{err}</span>}
    </div>
  );
}

export default function VariationDetail() {
  const { name = "" } = useParams();
  const { data: v, isLoading, error, mutate } = useFrappeGetDoc<WorkOrderVariation>("Work Order Variation", name);

  if (isLoading) return <Loading label="Loading variation…" />;
  if (error) return <ErrorNote error={error} />;
  if (!v) return <ErrorNote error="Variation not found." />;

  const items = v.variation_items || [];

  const cols: Col<WorkOrderVariationItem>[] = [
    { head: "Type", cell: (r) => <TypeBadge t={r.line_type} /> },
    { head: "#", cell: (r) => <span className="mono" style={{ color: "var(--text-muted)" }}>{r.item_no || "—"}</span>, width: 44 },
    { head: "Head", cell: (r) => r.summary_head },
    { head: "Description", cell: (r) => r.description || "—" },
    { head: "UOM", cell: (r) => r.uom || "—" },
    { head: "Qty", align: "right", cell: (r) => <span className="mono" style={{ color: (r.qty || 0) < 0 ? "var(--err)" : "var(--text-primary)" }}>{num(r.qty, 2)}</span> },
    { head: "Rate", align: "right", cell: (r) => <Num v={r.rate} /> },
    { head: "Tax %", align: "right", cell: (r) => <span className="mono">{pct(r.tax_pct)}</span> },
    { head: "Amount", align: "right", cell: (r) => <span className="mono" style={{ color: (r.amount || 0) < 0 ? "var(--err)" : "var(--cyan)", fontWeight: 500 }}>{num(r.amount, 2)}</span> },
  ];

  const isDraft = v.docstatus === 0;
  const isLive = v.docstatus === 1;

  return (
    <>
      <Link to="/variations" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Variations
      </Link>
      <PageHead
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {v.name}
            <Chip label={statusOf(v)} />
          </span>
        }
        sub={
          <>
            Work Order{" "}
            <Link to={`/work-orders/${encodeURIComponent(v.work_order_contract || "")}`} style={{ color: "var(--iris)", fontWeight: 500 }}>
              {v.work_order_contract}
            </Link>
          </>
        }
        right={<Actions v={v} onChanged={() => mutate()} />}
      />

      {/* Billing-effect note */}
      <Card style={{ padding: 14, marginBottom: 18, borderColor: isLive ? "var(--ok-bg)" : "var(--pending-bg)" }}>
        <div style={{ fontSize: 12.5, color: isLive ? "var(--ok)" : "var(--pending)" }}>
          {isDraft && "Draft — this variation does not affect billing yet. Submit it to update the work-order scope and all future RA Bills."}
          {isLive && "Live — this variation's scope is reflected in the work order and applied to every new RA Bill (sanctioned quantities and new items)."}
          {v.docstatus === 2 && "Cancelled — this variation no longer affects the work order or billing."}
        </div>
      </Card>

      {/* Totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginBottom: 18 }}>
        <Card accent style={{ padding: "16px 18px" }}>
          <div className="eyebrow">Net change</div>
          <div style={{ marginTop: 8, fontSize: 20 }}><Money v={v.total_amount} strong /></div>
        </Card>
        <Card style={{ padding: "16px 18px" }}>
          <div className="eyebrow">Tax</div>
          <div className="mono" style={{ marginTop: 8, fontSize: 20 }}><Num v={v.total_tax_amount} /></div>
        </Card>
        <Card style={{ padding: "16px 18px" }}>
          <div className="eyebrow">With tax</div>
          <div style={{ marginTop: 8, fontSize: 20 }}><Money v={v.total_amount_with_tax} strong /></div>
        </Card>
      </div>

      {/* Meta */}
      <Card style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16 }}>
          <KV label="Variation no.">{v.variation_number ?? "—"}</KV>
          <KV label="Date"><span className="mono">{fmtDate(v.variation_date)}</span></KV>
          <KV label="Supplier">{v.supplier}</KV>
          <KV label="Company">{v.company}</KV>
        </div>
        <div style={{ marginTop: 14 }}>
          <KV label="Reason for change">{v.reason_for_change || "—"}</KV>
        </div>
      </Card>

      {/* Lines */}
      <Card style={{ padding: "18px 0 6px" }}>
        <div style={{ padding: "0 18px" }}>
          <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{items.length} lines</span>}>
            Variation lines
          </SectionTitle>
        </div>
        {items.length ? (
          <Table cols={cols} rows={items} rowKey={(r) => r.name} />
        ) : (
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No lines.</div>
        )}
      </Card>
    </>
  );
}
