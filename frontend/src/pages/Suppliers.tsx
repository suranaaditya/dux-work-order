import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, Col, ErrorNote, Loading, PageHead, Table } from "../components/ui";
import { Icon } from "../components/icons";

interface Supplier {
  name: string;
  supplier_name?: string;
  supplier_group?: string;
  supplier_type?: string;
  country?: string;
  tax_id?: string;
  disabled?: 0 | 1;
}

export default function Suppliers() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useFrappeGetDocList<Supplier>("Supplier", {
    fields: ["name", "supplier_name", "supplier_group", "supplier_type", "country", "tax_id", "disabled"],
    limit: 0,
    orderBy: { field: "modified", order: "desc" },
  });

  const rows = useMemo(() => {
    const list = data || [];
    const ql = q.trim().toLowerCase();
    if (!ql) return list;
    return list.filter((s) =>
      [s.name, s.supplier_name, s.supplier_group, s.tax_id].filter(Boolean).some((x) => String(x).toLowerCase().includes(ql)),
    );
  }, [data, q]);

  if (isLoading) return <Loading label="Loading suppliers…" />;
  if (error) return <ErrorNote error={error} />;

  const cols: Col<Supplier>[] = [
    { head: "Supplier", cell: (s) => <span style={{ fontWeight: 600 }}>{s.supplier_name || s.name}</span> },
    { head: "Group", cell: (s) => s.supplier_group || "—" },
    { head: "Type", cell: (s) => s.supplier_type || "—" },
    { head: "GSTIN", cell: (s) => <span className="mono" style={{ fontSize: 12 }}>{s.tax_id || "—"}</span> },
    { head: "Country", cell: (s) => s.country || "—" },
    { head: "", align: "center", cell: (s) => (s.disabled ? <Chip label="Disabled" /> : null) },
  ];

  return (
    <>
      <PageHead
        title="Suppliers"
        sub={`${(data || []).length} suppliers`}
        right={
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 11, top: 10, color: "var(--text-muted)" }}>
              <Icon name="search" size={16} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, group, GSTIN…"
              style={{ height: 38, width: 260, padding: "0 12px 0 34px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", fontSize: 13, outline: "none" }}
            />
          </div>
        }
      />
      <Card style={{ padding: "6px 0" }}>
        {rows.length ? (
          <Table cols={cols} rows={rows} rowKey={(s) => s.name} onRowClick={(s) => nav(`/suppliers/${encodeURIComponent(s.name)}`)} />
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No suppliers match “{q}”.</div>
        )}
      </Card>
    </>
  );
}
