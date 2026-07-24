import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, Col, ErrorNote, Loading, Money, PageHead, Table } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useCompany, withCompany } from "../lib/company";

interface PE {
  name: string;
  party?: string;
  posting_date?: string;
  paid_amount?: number;
  mode_of_payment?: string;
  reference_no?: string;
  docstatus?: 0 | 1 | 2;
}

export default function Payments() {
  const nav = useNavigate();
  const { company } = useCompany();
  const { data, isLoading, error } = useFrappeGetDocList<PE>("Payment Entry", {
    fields: ["name", "party", "posting_date", "paid_amount", "mode_of_payment", "reference_no", "docstatus"],
    filters: withCompany(company, [["payment_type", "=", "Pay"], ["party_type", "=", "Supplier"]]),
    orderBy: { field: "modified", order: "desc" },
    limit: 100,
  });

  if (isLoading) return <Loading label="Loading payments…" />;
  if (error) return <ErrorNote error={error} />;
  const rows = data || [];

  const cols: Col<PE>[] = [
    { head: "Payment", cell: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
    { head: "Supplier", cell: (p) => p.party },
    { head: "Date", cell: (p) => <span className="mono">{fmtDate(p.posting_date)}</span> },
    { head: "Mode", cell: (p) => p.mode_of_payment || "—" },
    { head: "UTR / ref", cell: (p) => <span className="mono" style={{ fontSize: 12 }}>{p.reference_no || "—"}</span> },
    { head: "Amount", align: "right", cell: (p) => <Money v={p.paid_amount} dec={0} /> },
    { head: "Status", align: "center", cell: (p) => <Chip label={p.docstatus === 2 ? "Cancelled" : p.docstatus === 1 ? "Submitted" : "Draft"} /> },
  ];

  return (
    <>
      <PageHead title="Payments" sub={`${rows.length} supplier payments`} />
      <Card style={{ padding: "6px 0" }}>
        {rows.length ? (
          <Table cols={cols} rows={rows} rowKey={(p) => p.name} onRowClick={(p) => nav(`/payments/${encodeURIComponent(p.name)}`)} />
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No payments yet. Use “Record Payment” on a submitted invoice.</div>
        )}
      </Card>
    </>
  );
}
