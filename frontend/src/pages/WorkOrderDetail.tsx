import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import {
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
import { WorkflowBar } from "../components/WorkflowBar";
import { fmtDate, pct, qty } from "../lib/format";
import type { WorkOrderBOQItem, WorkOrderContract, WorkOrderRABill } from "../lib/types";

const statusOf = (w: WorkOrderContract) =>
  w.workflow_state || (w.docstatus === 1 ? "Submitted" : w.docstatus === 2 ? "Cancelled" : "Draft");

function BackLink() {
  return (
    <Link to="/work-orders" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
      <Icon name="arrowLeft" size={15} /> Work Orders
    </Link>
  );
}

function Terms({ w }: { w: WorkOrderContract }) {
  const items: [string, React.ReactNode][] = [
    ["Retention", pct(w.retention_percentage)],
    ["Mobilization advance", pct(w.mobilization_advance_pct)],
    ["Mob. recovery", pct(w.mobilization_recovery_pct)],
    ["Material advance", pct(w.material_advance_pct)],
    ["Material recovery", pct(w.material_recovery_pct)],
    ["DLP", `${w.dlp_months || 0} months`],
    ["Labour cess", w.apply_labour_cess ? pct(w.labour_cess_pct) : "—"],
    ["TDS category", w.tds_category || "—"],
    ["Retention release (final)", pct(w.retention_release_on_final_bill)],
    ["Retention release (after DLP)", pct(w.retention_release_after_dlp)],
  ];
  return (
    <Card style={{ padding: 18, marginBottom: 18 }}>
      <SectionTitle>Contract terms</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16 }}>
        {items.map(([k, v]) => (
          <KV key={k} label={k}>
            <span className="mono">{v}</span>
          </KV>
        ))}
      </div>
    </Card>
  );
}

function BOQByHead({ boq }: { boq: WorkOrderBOQItem[] }) {
  const groups = new Map<string, WorkOrderBOQItem[]>();
  boq.forEach((r) => {
    const k = r.summary_head || "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  });
  const cols: Col<WorkOrderBOQItem>[] = [
    { head: "#", cell: (r) => <span className="mono" style={{ color: "var(--text-muted)" }}>{r.item_no}</span>, width: 44 },
    { head: "Description", cell: (r) => r.description || "—" },
    { head: "UOM", cell: (r) => r.uom || "—" },
    { head: "Qty", align: "right", cell: (r) => <Num v={r.estimated_qty} dec={0} /> },
    { head: "Rate", align: "right", cell: (r) => <Num v={r.rate} /> },
    { head: "Tax %", align: "right", cell: (r) => <span className="mono">{pct(r.tax_pct)}</span> },
    { head: "Amount", align: "right", cell: (r) => <Money v={r.amount} /> },
  ];
  return (
    <Card style={{ padding: "18px 0 6px" }}>
      <div style={{ padding: "0 18px" }}>
        <SectionTitle>BOQ — detail</SectionTitle>
      </div>
      {[...groups.entries()].map(([head, rows]) => (
        <div key={head} style={{ marginBottom: 6 }}>
          <div
            style={{
              padding: "8px 18px",
              background: "var(--bg-sunken)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--iris)",
              borderTop: "1px solid var(--border-subtle)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            {head}
          </div>
          <Table cols={cols} rows={rows} rowKey={(r) => r.name} />
        </div>
      ))}
    </Card>
  );
}

export default function WorkOrderDetail() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const { data: w, isLoading, error, mutate } = useFrappeGetDoc<WorkOrderContract>("Work Order Contract", name);
  const bills = useFrappeGetDocList<WorkOrderRABill>("Work Order RA Bill", {
    fields: ["name", "bill_date", "bill_number", "gross_this_bill", "net_payable", "billing_status", "docstatus"],
    filters: [["civil_work_order", "=", name]],
    limit: 0,
    orderBy: { field: "bill_number", order: "asc" },
  });

  if (isLoading) return <Loading label="Loading work order…" />;
  if (error) return <ErrorNote error={error} />;
  if (!w) return <ErrorNote error="Work order not found." />;

  const summary = w.summary_items || [];
  const boq = w.boq_items || [];
  const variations = w.variations_register || [];

  const summaryCols: Col<(typeof summary)[number]>[] = [
    { head: "Summary head", cell: (s) => <span style={{ fontWeight: 500 }}>{s.summary_head}</span> },
    { head: "Amount", align: "right", cell: (s) => <Money v={s.amount} /> },
    { head: "Tax", align: "right", cell: (s) => <Num v={s.tax_amount} /> },
    { head: "With tax", align: "right", cell: (s) => <Money v={s.amount_with_tax} /> },
  ];

  const billCols: Col<WorkOrderRABill>[] = [
    { head: "Bill", cell: (b) => <span style={{ fontWeight: 600 }}>{b.name}</span> },
    { head: "No.", cell: (b) => b.bill_number },
    { head: "Date", cell: (b) => <span className="mono">{fmtDate(b.bill_date)}</span> },
    { head: "Gross", align: "right", cell: (b) => <Num v={b.gross_this_bill} /> },
    { head: "Net Payable", align: "right", cell: (b) => <Money v={b.net_payable} /> },
    { head: "Status", align: "center", cell: (b) => <Chip label={b.billing_status} /> },
  ];

  return (
    <>
      <BackLink />
      <PageHead
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            {w.name}
            <Chip label={statusOf(w)} />
          </span>
        }
        sub={w.work_title}
        right={<WorkflowBar doc={w} onChanged={() => mutate()} />}
      />

      {/* Commercial summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginBottom: 18 }}>
        <Card accent style={{ padding: "16px 18px" }}>
          <div className="eyebrow">Contract value</div>
          <div style={{ marginTop: 8, fontSize: 20 }}><Money v={w.total_amount} strong /></div>
        </Card>
        <Card style={{ padding: "16px 18px" }}>
          <div className="eyebrow">Tax</div>
          <div className="mono" style={{ marginTop: 8, fontSize: 20 }}><Num v={w.total_tax_amount} /></div>
        </Card>
        <Card style={{ padding: "16px 18px" }}>
          <div className="eyebrow">With tax</div>
          <div style={{ marginTop: 8, fontSize: 20 }}><Money v={w.total_amount_with_tax} strong /></div>
        </Card>
      </div>

      {/* Details */}
      <Card style={{ padding: 18, marginBottom: 18 }}>
        <SectionTitle>Details</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
          <KV label="Contractor">{w.supplier_name || w.supplier}</KV>
          <KV label="Project">{w.project || "—"}</KV>
          <KV label="Company">{w.company}</KV>
          <KV label="WO date"><span className="mono">{fmtDate(w.wo_date)}</span></KV>
          <KV label="Scheduled start"><span className="mono">{fmtDate(w.scheduled_start_date)}</span></KV>
          <KV label="Scheduled completion"><span className="mono">{fmtDate(w.scheduled_completion_date)}</span></KV>
          <KV label="Site location">{w.site_location || "—"}</KV>
        </div>
      </Card>

      <Terms w={w} />

      {/* Summary (layer 1) */}
      <Card style={{ padding: "18px 0 6px", marginBottom: 18 }}>
        <div style={{ padding: "0 18px" }}>
          <SectionTitle>Work Order summary</SectionTitle>
        </div>
        {summary.length ? (
          <Table cols={summaryCols} rows={summary} rowKey={(s) => s.name} />
        ) : (
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No summary heads.</div>
        )}
      </Card>

      {/* BOQ (layer 2) */}
      {boq.length > 0 && <BOQByHead boq={boq} />}

      {/* Variations */}
      {variations.length > 0 && (
        <Card style={{ padding: "18px 0 6px", marginTop: 18 }}>
          <div style={{ padding: "0 18px" }}>
            <SectionTitle>Variations</SectionTitle>
          </div>
          <Table
            cols={[
              { head: "Variation", cell: (v) => v.variation || `VO-${v.variation_number}` },
              { head: "Date", cell: (v) => <span className="mono">{fmtDate(v.variation_date)}</span> },
              { head: "Value", align: "right", cell: (v) => <Money v={v.total_amount} /> },
              { head: "Status", align: "center", cell: (v) => <Chip label={v.status} /> },
            ]}
            rows={variations}
            rowKey={(v) => v.name}
          />
        </Card>
      )}

      {/* Linked RA Bills */}
      <Card style={{ padding: "18px 0 6px", marginTop: 18 }}>
        <div style={{ padding: "0 18px" }}>
          <SectionTitle>RA Bills against this WO</SectionTitle>
        </div>
        {bills.data && bills.data.length ? (
          <Table
            cols={billCols}
            rows={bills.data}
            rowKey={(b) => b.name}
            onRowClick={(b) => nav(`/ra-bills/${encodeURIComponent(b.name)}`)}
          />
        ) : (
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No RA Bills yet.</div>
        )}
      </Card>
    </>
  );
}
