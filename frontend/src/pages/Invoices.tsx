import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, Col, ErrorNote, Loading, Money, Num, PageHead, Table } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useCompany, withCompany } from "../lib/company";

interface PI {
  name: string;
  supplier?: string;
  bill_no?: string;
  posting_date?: string;
  net_total?: number;
  total_taxes_and_charges?: number;
  grand_total?: number;
  docstatus?: 0 | 1 | 2;
}

export default function Invoices() {
  const nav = useNavigate();
  const { company } = useCompany();
  const { data, isLoading, error } = useFrappeGetDocList<PI>("Purchase Invoice", {
    fields: ["name", "supplier", "bill_no", "posting_date", "net_total", "total_taxes_and_charges", "grand_total", "docstatus"],
    filters: withCompany(company, [["is_wo_ra_bill_invoice", "=", 1]]),
    orderBy: { field: "modified", order: "desc" },
    limit: 0,
  });

  if (isLoading) return <Loading label="Loading invoices…" />;
  if (error) return <ErrorNote error={error} />;
  const rows = data || [];

  const cols: Col<PI>[] = [
    { head: "Invoice", cell: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
    { head: "Supplier", cell: (p) => p.supplier },
    { head: "Supplier inv#", cell: (p) => <span className="mono" style={{ fontSize: 12 }}>{p.bill_no || "—"}</span> },
    { head: "Date", cell: (p) => <span className="mono">{fmtDate(p.posting_date)}</span> },
    { head: "Net", align: "right", cell: (p) => <Num v={p.net_total} /> },
    { head: "GST", align: "right", cell: (p) => <Num v={p.total_taxes_and_charges} /> },
    { head: "Grand total", align: "right", cell: (p) => <Money v={p.grand_total} dec={0} /> },
    { head: "Status", align: "center", cell: (p) => <Chip label={p.docstatus === 2 ? "Cancelled" : p.docstatus === 1 ? "Submitted" : "Draft"} /> },
  ];

  return (
    <>
      <PageHead title="Invoices" sub={`${rows.length} purchase invoices from RA bills`} />
      <Card style={{ padding: "6px 0" }}>
        {rows.length ? (
          <Table cols={cols} rows={rows} rowKey={(p) => p.name} onRowClick={(p) => nav(`/invoices/${encodeURIComponent(p.name)}`)} />
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No invoices recorded yet. Use “Record Invoice” on a submitted RA bill.</div>
        )}
      </Card>
    </>
  );
}
