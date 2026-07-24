import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, Col, ErrorNote, Loading, Money, PageHead, Table } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useCompany, withCompany } from "../lib/company";
import type { WorkOrderVariation } from "../lib/types";

const statusOf = (v: WorkOrderVariation) => (v.docstatus === 1 ? "Submitted" : v.docstatus === 2 ? "Cancelled" : "Draft");

export default function Variations() {
  const nav = useNavigate();
  const { company } = useCompany();
  const { data, isLoading, error } = useFrappeGetDocList<WorkOrderVariation>("Work Order Variation", {
    fields: ["name", "work_order_contract", "variation_date", "reason_for_change", "total_amount_with_tax", "docstatus"],
    filters: withCompany(company),
    orderBy: { field: "modified", order: "desc" },
    limit: 0,
  });

  if (isLoading) return <Loading label="Loading variations…" />;
  if (error) return <ErrorNote error={error} />;
  const rows = data || [];

  const cols: Col<WorkOrderVariation>[] = [
    { head: "Variation", cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { head: "Work Order", cell: (v) => <span className="mono" style={{ fontSize: 12 }}>{v.work_order_contract}</span> },
    { head: "Date", cell: (v) => <span className="mono">{fmtDate(v.variation_date)}</span> },
    { head: "Reason", cell: (v) => <span style={{ display: "inline-block", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{v.reason_for_change || "—"}</span> },
    { head: "Value (incl. tax)", align: "right", cell: (v) => <Money v={v.total_amount_with_tax} dec={0} /> },
    { head: "Status", align: "center", cell: (v) => <Chip label={statusOf(v)} /> },
  ];

  return (
    <>
      <PageHead title="Variations" sub={`${rows.length} scope changes across work orders`} />
      <Card style={{ padding: "6px 0" }}>
        {rows.length ? (
          <Table cols={cols} rows={rows} rowKey={(v) => v.name} onRowClick={(v) => nav(`/variations/${encodeURIComponent(v.name)}`)} />
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            No variations yet. Open an approved work order and use “New Variation”.
          </div>
        )}
      </Card>
    </>
  );
}
