import { useMemo, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, ErrorNote, Loading, PageHead, Btn } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate, inr } from "../lib/format";

type ColDef = { key: string; label: string; kind?: "money" | "date" | "num" | "text" };
type Register = { key: string; label: string; doctype: string; fields: string[]; filters?: any[]; columns: ColDef[] };

const REGISTERS: Register[] = [
  {
    key: "wo", label: "Work Order Register", doctype: "Work Order Contract",
    fields: ["name", "supplier", "project", "wo_date", "total_amount", "total_amount_with_tax", "workflow_state"],
    columns: [
      { key: "name", label: "WO" }, { key: "supplier", label: "Supplier" }, { key: "project", label: "Project" },
      { key: "wo_date", label: "Date", kind: "date" }, { key: "total_amount", label: "Value", kind: "money" },
      { key: "total_amount_with_tax", label: "With tax", kind: "money" }, { key: "workflow_state", label: "Status" },
    ],
  },
  {
    key: "ra", label: "RA Bill Register", doctype: "Work Order RA Bill",
    fields: ["name", "civil_work_order", "supplier", "bill_date", "gross_this_bill", "net_payable", "invoiced_amount", "billing_status"],
    columns: [
      { key: "name", label: "RA Bill" }, { key: "civil_work_order", label: "Work Order" }, { key: "supplier", label: "Supplier" },
      { key: "bill_date", label: "Date", kind: "date" }, { key: "gross_this_bill", label: "Gross", kind: "money" },
      { key: "net_payable", label: "Net payable", kind: "money" }, { key: "invoiced_amount", label: "Invoiced", kind: "money" },
      { key: "billing_status", label: "Status" },
    ],
  },
  {
    key: "inv", label: "Invoice Register", doctype: "Purchase Invoice", filters: [["is_wo_ra_bill_invoice", "=", 1]],
    fields: ["name", "supplier", "bill_no", "posting_date", "net_total", "total_taxes_and_charges", "grand_total", "outstanding_amount"],
    columns: [
      { key: "name", label: "Invoice" }, { key: "supplier", label: "Supplier" }, { key: "bill_no", label: "Supplier inv#" },
      { key: "posting_date", label: "Date", kind: "date" }, { key: "net_total", label: "Net", kind: "money" },
      { key: "grand_total", label: "Grand total", kind: "money" }, { key: "outstanding_amount", label: "Outstanding", kind: "money" },
    ],
  },
  {
    key: "pay", label: "Payment Register", doctype: "Payment Entry", filters: [["payment_type", "=", "Pay"], ["party_type", "=", "Supplier"]],
    fields: ["name", "party", "posting_date", "mode_of_payment", "reference_no", "paid_amount"],
    columns: [
      { key: "name", label: "Payment" }, { key: "party", label: "Supplier" }, { key: "posting_date", label: "Date", kind: "date" },
      { key: "mode_of_payment", label: "Mode" }, { key: "reference_no", label: "UTR / ref" }, { key: "paid_amount", label: "Amount", kind: "money" },
    ],
  },
];

function fmt(v: any, kind?: string) {
  if (v == null || v === "") return "—";
  if (kind === "money") return inr(v);
  if (kind === "date") return fmtDate(v);
  return String(v);
}

export default function Reports() {
  const [reg, setReg] = useState(REGISTERS[0]);
  const { data, isLoading, error } = useFrappeGetDocList<any>(reg.doctype, {
    fields: reg.fields,
    filters: reg.filters,
    orderBy: { field: "modified", order: "desc" },
    limit: 0,
  });
  const rows = data || [];

  const csv = useMemo(() => {
    const head = reg.columns.map((c) => c.label).join(",");
    const body = rows
      .map((r) => reg.columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    return head + "\n" + body;
  }, [rows, reg]);

  function exportCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reg.key}-register.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHead
        title="Reports"
        sub="Registers across the work-order to payment chain"
        right={<Btn variant="secondary" onClick={exportCsv} disabled={!rows.length}><Icon name="report" size={15} /> Export CSV</Btn>}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {REGISTERS.map((r) => (
          <button
            key={r.key}
            onClick={() => setReg(r)}
            style={{
              padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: reg.key === r.key ? 600 : 450, cursor: "pointer",
              border: "1px solid " + (reg.key === r.key ? "var(--iris)" : "var(--border-strong)"),
              background: reg.key === r.key ? "var(--iris-tint)" : "var(--bg-surface)",
              color: reg.key === r.key ? "var(--iris)" : "var(--text-secondary)",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Loading label="Loading…" />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <Card style={{ padding: "6px 0" }}>
          <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--text-muted)" }}>{rows.length} rows</div>
          <div className="scroll-x">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  {reg.columns.map((c) => (
                    <th key={c.key} style={{ textAlign: c.kind === "money" ? "right" : "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name || i}>
                    {reg.columns.map((c) => (
                      <td key={c.key} style={{ padding: "9px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: c.kind === "money" ? "right" : "left", whiteSpace: "nowrap", ...(c.kind === "money" ? { fontFamily: "var(--font-mono)" } : {}) }}>
                        {c.key === "name" ? <span style={{ fontWeight: 600 }}>{r[c.key]}</span> : fmt(r[c.key], c.kind)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
