import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Btn, Card, Chip, Col, ErrorNote, Loading, Money, PageHead, Table } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate } from "../lib/format";
import { useCompany, withCompany } from "../lib/company";
import type { WorkOrderContract } from "../lib/types";

const statusOf = (w: WorkOrderContract) =>
  w.workflow_state || (w.docstatus === 1 ? "Submitted" : w.docstatus === 2 ? "Cancelled" : "Draft");

export default function WorkOrders() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { company } = useCompany();

  const { data, isLoading, error } = useFrappeGetDocList<WorkOrderContract>("Work Order Contract", {
    fields: [
      "name",
      "supplier_name",
      "supplier",
      "work_title",
      "wo_date",
      "company_abbr",
      "total_amount",
      "total_amount_with_tax",
      "workflow_state",
      "docstatus",
    ],
    filters: withCompany(company),
    limit: 0,
    orderBy: { field: "modified", order: "desc" },
  });

  const rows = useMemo(() => {
    const list = data || [];
    const ql = q.trim().toLowerCase();
    if (!ql) return list;
    return list.filter((w) =>
      [w.name, w.supplier_name, w.work_title, w.company_abbr]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(ql)),
    );
  }, [data, q]);

  if (isLoading) return <Loading label="Loading work orders…" />;
  if (error) return <ErrorNote error={error} />;

  const cols: Col<WorkOrderContract>[] = [
    { head: "WO Number", cell: (w) => <span style={{ fontWeight: 600 }}>{w.name}</span> },
    { head: "Contractor", cell: (w) => w.supplier_name || w.supplier || "—" },
    {
      head: "Work",
      cell: (w) => (
        <span style={{ color: "var(--text-secondary)", maxWidth: 320, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
          {w.work_title || "—"}
        </span>
      ),
    },
    { head: "Date", cell: (w) => <span className="mono">{fmtDate(w.wo_date)}</span> },
    { head: "Value", align: "right", cell: (w) => <Money v={w.total_amount} dec={0} /> },
    { head: "Status", align: "center", cell: (w) => <Chip label={statusOf(w)} /> },
  ];

  return (
    <>
      <PageHead
        title="Work Orders"
        sub={`${(data || []).length} contracts`}
        right={
          <>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 11, top: 10, color: "var(--text-muted)" }}>
                <Icon name="search" size={16} />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search WO, contractor…"
                style={{
                  height: 38,
                  width: 240,
                  padding: "0 12px 0 34px",
                  borderRadius: 10,
                  border: "1px solid var(--border-strong)",
                  background: "var(--bg-surface)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>
            <Btn variant="primary" onClick={() => nav("/work-orders/new")}>
              <Icon name="plus" size={15} color="#fff" /> New Work Order
            </Btn>
          </>
        }
      />
      <Card style={{ padding: "6px 0" }}>
        {rows.length ? (
          <Table
            cols={cols}
            rows={rows}
            rowKey={(w) => w.name}
            onRowClick={(w) => nav(`/work-orders/${encodeURIComponent(w.name)}`)}
          />
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            No work orders match “{q}”.
          </div>
        )}
      </Card>
    </>
  );
}
