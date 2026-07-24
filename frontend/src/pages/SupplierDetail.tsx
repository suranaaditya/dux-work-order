import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, Col, ErrorNote, KV, Loading, Money, PageHead, SectionTitle, StatTile, Table } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate } from "../lib/format";
import type { WorkOrderContract } from "../lib/types";

const sum = (xs: number[]) => xs.reduce((a, b) => a + (b || 0), 0);

export default function SupplierDetail() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const { data: s, isLoading, error } = useFrappeGetDoc<any>("Supplier", name);
  const wos = useFrappeGetDocList<WorkOrderContract>("Work Order Contract", {
    fields: ["name", "work_title", "wo_date", "total_amount", "workflow_state", "docstatus"],
    filters: [["supplier", "=", name]],
    limit: 0,
    orderBy: { field: "modified", order: "desc" },
  });

  if (isLoading) return <Loading label="Loading supplier…" />;
  if (error) return <ErrorNote error={error} />;
  if (!s) return <ErrorNote error="Supplier not found." />;

  const woList = wos.data || [];
  const contractValue = sum(woList.map((w) => w.total_amount || 0));

  const cols: Col<WorkOrderContract>[] = [
    { head: "WO", cell: (w) => <span style={{ fontWeight: 600 }}>{w.name}</span> },
    { head: "Work", cell: (w) => <span style={{ color: "var(--text-secondary)" }}>{w.work_title || "—"}</span> },
    { head: "Date", cell: (w) => <span className="mono">{fmtDate(w.wo_date)}</span> },
    { head: "Value", align: "right", cell: (w) => <Money v={w.total_amount} dec={0} /> },
    { head: "Status", align: "center", cell: (w) => <Chip label={w.workflow_state || (w.docstatus === 1 ? "Submitted" : "Draft")} /> },
  ];

  return (
    <>
      <Link to="/suppliers" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Suppliers
      </Link>
      <PageHead
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            {s.supplier_name || s.name}
            {s.disabled ? <Chip label="Disabled" /> : null}
          </span>
        }
        sub={s.supplier_group}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatTile accent label="Work Orders" value={woList.length} />
        <StatTile label="Contract value" value={<Money v={contractValue} dec={0} />} />
      </div>

      <Card style={{ padding: 18, marginBottom: 18 }}>
        <SectionTitle>Master</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
          <KV label="Group">{s.supplier_group}</KV>
          <KV label="Type">{s.supplier_type}</KV>
          <KV label="GSTIN"><span className="mono" style={{ fontSize: 12.5 }}>{s.tax_id || "—"}</span></KV>
          <KV label="GST category">{s.gst_category || "—"}</KV>
          <KV label="PAN"><span className="mono" style={{ fontSize: 12.5 }}>{s.pan || "—"}</span></KV>
          <KV label="Country">{s.country || "—"}</KV>
          <KV label="Currency">{s.default_currency || "—"}</KV>
          <KV label="Payment terms">{s.payment_terms || "—"}</KV>
        </div>
      </Card>

      <Card style={{ padding: "18px 0 6px" }}>
        <div style={{ padding: "0 18px" }}>
          <SectionTitle>Work Orders</SectionTitle>
        </div>
        {woList.length ? (
          <Table cols={cols} rows={woList} rowKey={(w) => w.name} onRowClick={(w) => nav(`/work-orders/${encodeURIComponent(w.name)}`)} />
        ) : (
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No work orders for this supplier.</div>
        )}
      </Card>
    </>
  );
}
