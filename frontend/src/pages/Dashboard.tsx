import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, ErrorNote, Loading, Money, PageHead, StatTile, Table, Col } from "../components/ui";
import { fmtDate } from "../lib/format";
import type { WorkOrderContract, WorkOrderRABill } from "../lib/types";

const sum = (xs: number[]) => xs.reduce((a, b) => a + (b || 0), 0);

export default function Dashboard() {
  const nav = useNavigate();

  const wos = useFrappeGetDocList<WorkOrderContract>("Work Order Contract", {
    fields: ["name", "supplier_name", "work_title", "total_amount", "workflow_state", "docstatus", "wo_date", "company"],
    limit: 0,
    orderBy: { field: "modified", order: "desc" },
  });

  const bills = useFrappeGetDocList<WorkOrderRABill>("Work Order RA Bill", {
    fields: [
      "name",
      "civil_work_order",
      "supplier",
      "bill_date",
      "bill_number",
      "gross_this_bill",
      "total_deductions",
      "net_payable",
      "billing_status",
      "docstatus",
    ],
    limit: 0,
    orderBy: { field: "modified", order: "desc" },
  });

  if (wos.isLoading || bills.isLoading) return <Loading label="Loading dashboard…" />;
  if (wos.error) return <ErrorNote error={wos.error} />;
  if (bills.error) return <ErrorNote error={bills.error} />;

  const woList = wos.data || [];
  const billList = bills.data || [];
  const submitted = billList.filter((b) => b.docstatus === 1);

  const contractValue = sum(woList.map((w) => w.total_amount || 0));
  const certified = sum(submitted.map((b) => b.net_payable || 0));
  const deductions = sum(submitted.map((b) => b.total_deductions || 0));

  const billCols: Col<WorkOrderRABill>[] = [
    { head: "Bill", cell: (b) => <span style={{ fontWeight: 600 }}>{b.name}</span> },
    { head: "Work Order", cell: (b) => b.civil_work_order || "—" },
    { head: "Date", cell: (b) => <span className="mono">{fmtDate(b.bill_date)}</span> },
    { head: "Net Payable", align: "right", cell: (b) => <Money v={b.net_payable} /> },
    { head: "Status", align: "center", cell: (b) => <Chip label={b.billing_status} /> },
  ];

  return (
    <>
      <PageHead title="Dashboard" sub="Live figures from dux_civil_works on erp.jewonline.in" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <StatTile accent label="Contracts" value={woList.length} sub={`${woList.filter((w) => w.docstatus === 1).length} submitted`} />
        <StatTile label="Contract value" value={<Money v={contractValue} dec={0} />} />
        <StatTile label="RA Bills" value={billList.length} sub={`${submitted.length} submitted`} />
        <StatTile label="Certified (net payable)" value={<Money v={certified} dec={0} />} />
        <StatTile label="Deductions held" value={<Money v={deductions} dec={0} />} />
      </div>

      <Card style={{ padding: "18px 6px 6px" }}>
        <div style={{ padding: "0 14px 6px", fontSize: 15, fontWeight: 600 }}>Recent RA Bills</div>
        {billList.length ? (
          <Table
            cols={billCols}
            rows={billList.slice(0, 8)}
            rowKey={(b) => b.name}
            onRowClick={(b) => nav(`/ra-bills/${encodeURIComponent(b.name)}`)}
          />
        ) : (
          <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>No RA Bills yet.</div>
        )}
      </Card>
    </>
  );
}
