import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Btn, Card, Chip, Col, ErrorNote, Loading, Money, Num, PageHead, Table } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate } from "../lib/format";
import { useCompany, withCompany } from "../lib/company";
import type { WorkOrderRABill } from "../lib/types";

export default function RABills() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { company } = useCompany();

  const { data, isLoading, error } = useFrappeGetDocList<WorkOrderRABill>("Work Order RA Bill", {
    fields: [
      "name",
      "civil_work_order",
      "supplier",
      "bill_date",
      "bill_number",
      "gross_this_bill",
      "total_deductions",
      "net_payable",
      "invoiced_amount",
      "billing_status",
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
    return list.filter((b) =>
      [b.name, b.civil_work_order, b.supplier].filter(Boolean).some((s) => String(s).toLowerCase().includes(ql)),
    );
  }, [data, q]);

  if (isLoading) return <Loading label="Loading RA bills…" />;
  if (error) return <ErrorNote error={error} />;

  const cols: Col<WorkOrderRABill>[] = [
    { head: "RA Bill", cell: (b) => <span style={{ fontWeight: 600 }}>{b.name}</span> },
    { head: "Work Order", cell: (b) => b.civil_work_order || "—" },
    { head: "Supplier", cell: (b) => b.supplier || "—" },
    { head: "Date", cell: (b) => <span className="mono">{fmtDate(b.bill_date)}</span> },
    { head: "Gross", align: "right", cell: (b) => <Num v={b.gross_this_bill} /> },
    { head: "Deductions", align: "right", cell: (b) => <Num v={b.total_deductions} /> },
    { head: "Net Payable", align: "right", cell: (b) => <Money v={b.net_payable} /> },
    { head: "Status", align: "center", cell: (b) => <Chip label={b.billing_status} /> },
  ];

  return (
    <>
      <PageHead
        title="RA Bills"
        sub={`${(data || []).length} running-account bills`}
        right={
          <>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 11, top: 10, color: "var(--text-muted)" }}>
                <Icon name="search" size={16} />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search bill, WO, supplier…"
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
            <Btn variant="primary" onClick={() => nav("/ra-bills/new")}>
              <Icon name="plus" size={15} color="#fff" /> New RA Bill
            </Btn>
          </>
        }
      />
      <Card style={{ padding: "6px 0" }}>
        {rows.length ? (
          <Table cols={cols} rows={rows} rowKey={(b) => b.name} onRowClick={(b) => nav(`/ra-bills/${encodeURIComponent(b.name)}`)} />
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            No RA bills match “{q}”.
          </div>
        )}
      </Card>
    </>
  );
}
