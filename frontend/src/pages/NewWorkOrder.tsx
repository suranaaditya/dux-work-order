import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { Card, PageHead, SectionTitle, Btn, Money, Num } from "../components/ui";
import { Icon } from "../components/icons";
import { Field, TextInput, DateInput, NumberInput, TextArea, LinkField } from "../components/form";

type BoqRow = {
  item_no: string;
  summary_head: string;
  description: string;
  uom: string;
  estimated_qty: string;
  rate: string;
  tax_pct: string;
};

const emptyRow = (n: number): BoqRow => ({
  item_no: String(n),
  summary_head: "",
  description: "",
  uom: "",
  estimated_qty: "",
  rate: "",
  tax_pct: "18",
});

// Work Order Settings defaults (erp.jewonline.in)
const DEFAULT_TERMS = {
  retention_percentage: "5",
  mobilization_advance_pct: "10",
  mobilization_recovery_pct: "10",
  material_advance_pct: "0",
  material_recovery_pct: "0",
  dlp_months: "12",
  retention_release_on_final_bill: "100",
  retention_release_after_dlp: "0",
  labour_cess_pct: "1",
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const n = (s: string) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

export default function NewWorkOrder() {
  const nav = useNavigate();
  const { createDoc, loading } = useFrappeCreateDoc();
  const [err, setErr] = useState<string | null>(null);

  const [head, setHead] = useState({
    company: "",
    supplier: "",
    project: "",
    wo_date: todayISO(),
    work_title: "",
    site_location: "",
    work_description: "",
  });
  const [terms, setTerms] = useState({ ...DEFAULT_TERMS, apply_labour_cess: false, tds_category: "" });
  const [rows, setRows] = useState<BoqRow[]>([emptyRow(1)]);

  const setH = (k: keyof typeof head, v: string) => setHead((s) => ({ ...s, [k]: v }));
  const setT = (k: string, v: any) => setTerms((s) => ({ ...s, [k]: v }));
  const setRow = (i: number, k: keyof BoqRow, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow(rs.length + 1)]);
  const delRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i).map((r, k) => ({ ...r, item_no: String(k + 1) })) : rs));

  const rowAmount = (r: BoqRow) => n(r.estimated_qty) * n(r.rate);
  const total = rows.reduce((s, r) => s + rowAmount(r), 0);
  const totalTax = rows.reduce((s, r) => s + (rowAmount(r) * n(r.tax_pct)) / 100, 0);

  const completeRows = rows.filter((r) => r.summary_head && r.description && r.uom && n(r.estimated_qty) > 0 && n(r.rate) > 0);
  const canSubmit = head.company && head.supplier && head.work_title && head.wo_date && completeRows.length > 0;

  async function submit() {
    setErr(null);
    try {
      const payload: any = {
        naming_series: "WO-.company_abbr.-.YYYY.-.####",
        company: head.company,
        supplier: head.supplier,
        wo_date: head.wo_date,
        work_title: head.work_title,
        site_location: head.site_location || undefined,
        work_description: head.work_description || undefined,
        retention_percentage: n(terms.retention_percentage),
        mobilization_advance_pct: n(terms.mobilization_advance_pct),
        mobilization_recovery_pct: n(terms.mobilization_recovery_pct),
        material_advance_pct: n(terms.material_advance_pct),
        material_recovery_pct: n(terms.material_recovery_pct),
        dlp_months: n(terms.dlp_months),
        retention_release_on_final_bill: n(terms.retention_release_on_final_bill),
        retention_release_after_dlp: n(terms.retention_release_after_dlp),
        apply_labour_cess: terms.apply_labour_cess ? 1 : 0,
        labour_cess_pct: n(terms.labour_cess_pct),
        boq_items: completeRows.map((r) => ({
          item_no: r.item_no,
          summary_head: r.summary_head,
          description: r.description,
          uom: r.uom,
          estimated_qty: n(r.estimated_qty),
          rate: n(r.rate),
          tax_pct: n(r.tax_pct),
        })),
      };
      if (head.project) payload.project = head.project;
      if (terms.tds_category) payload.tds_category = terms.tds_category;

      const doc = await createDoc("Work Order Contract", payload);
      nav(`/work-orders/${encodeURIComponent(doc.name)}`);
    } catch (e: any) {
      const msg =
        e?.message ||
        e?._server_messages ||
        (e?.exception ? String(e.exception) : "Could not create the work order.");
      setErr(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
  }

  const itemFilter = [["item_group", "=", "Work Order Items"]];

  return (
    <>
      <Link to="/work-orders" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Work Orders
      </Link>
      <PageHead title="New Work Order" sub="Create a Work Order Contract" />

      {/* Details */}
      <Card style={{ padding: 20, marginBottom: 18 }}>
        <SectionTitle>Details</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          <Field label="Company" required>
            <LinkField doctype="Company" value={head.company} onChange={(v) => setH("company", v)} placeholder="Select company" />
          </Field>
          <Field label="Contractor (Supplier)" required>
            <LinkField doctype="Supplier" value={head.supplier} onChange={(v) => setH("supplier", v)} placeholder="Select supplier" displayField="supplier_name" />
          </Field>
          <Field label="Project">
            <LinkField doctype="Project" value={head.project} onChange={(v) => setH("project", v)} placeholder="(optional)" displayField="project_name" />
          </Field>
          <Field label="WO date" required>
            <DateInput value={head.wo_date} onChange={(v) => setH("wo_date", v)} />
          </Field>
          <Field label="Work title" required>
            <TextInput value={head.work_title} onChange={(v) => setH("work_title", v)} placeholder="e.g. Renovation of Hostel Block C" />
          </Field>
          <Field label="Site location">
            <TextInput value={head.site_location} onChange={(v) => setH("site_location", v)} placeholder="(optional)" />
          </Field>
        </div>
        <div style={{ marginTop: 16 }}>
          <Field label="Work description">
            <TextArea value={head.work_description} onChange={(v) => setH("work_description", v)} placeholder="Scope summary (optional)" />
          </Field>
        </div>
      </Card>

      {/* BOQ */}
      <Card style={{ padding: 20, marginBottom: 18 }}>
        <SectionTitle right={<Btn variant="secondary" onClick={addRow}><Icon name="doc" size={14} /> Add item</Btn>}>
          BOQ items
        </SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--bg-sunken)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Item {r.item_no}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="mono" style={{ fontSize: 13, color: "var(--cyan)" }}><Money v={rowAmount(r)} /></span>
                  {rows.length > 1 && (
                    <button type="button" onClick={() => delRow(i)} style={{ border: "none", background: "transparent", color: "var(--err)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 3 }}>
                      <Icon name="close" size={13} /> Remove
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.7fr 0.7fr 0.6fr", gap: 10 }}>
                <Field label="Summary head" required>
                  <LinkField doctype="Item" value={r.summary_head} onChange={(v) => setRow(i, "summary_head", v)} placeholder="Service item" extraFilters={itemFilter} displayField="item_name" />
                </Field>
                <Field label="UOM" required>
                  <LinkField doctype="UOM" value={r.uom} onChange={(v) => setRow(i, "uom", v)} placeholder="Unit" />
                </Field>
                <Field label="Qty" required>
                  <NumberInput value={r.estimated_qty} onChange={(v) => setRow(i, "estimated_qty", v)} align="right" />
                </Field>
                <Field label="Rate" required>
                  <NumberInput value={r.rate} onChange={(v) => setRow(i, "rate", v)} align="right" />
                </Field>
                <Field label="Tax %">
                  <NumberInput value={r.tax_pct} onChange={(v) => setRow(i, "tax_pct", v)} align="right" suffix="%" />
                </Field>
              </div>
              <div style={{ marginTop: 10 }}>
                <Field label="Description" required>
                  <TextInput value={r.description} onChange={(v) => setRow(i, "description", v)} placeholder="Item description" />
                </Field>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tax</div>
            <div className="mono"><Num v={totalTax} /></div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Total (excl. tax)</div>
            <div style={{ fontSize: 18 }}><Money v={total} strong /></div>
          </div>
        </div>
      </Card>

      {/* Terms */}
      <Card style={{ padding: 20, marginBottom: 18 }}>
        <SectionTitle>Contract terms</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
          {[
            ["Retention %", "retention_percentage"],
            ["Mobilization advance %", "mobilization_advance_pct"],
            ["Mob. recovery %", "mobilization_recovery_pct"],
            ["Material advance %", "material_advance_pct"],
            ["Material recovery %", "material_recovery_pct"],
            ["DLP (months)", "dlp_months"],
            ["Retention release final %", "retention_release_on_final_bill"],
            ["Retention release after DLP %", "retention_release_after_dlp"],
          ].map(([label, key]) => (
            <Field key={key} label={label}>
              <NumberInput value={(terms as any)[key]} onChange={(v) => setT(key, v)} align="right" />
            </Field>
          ))}
          <Field label="TDS category">
            <LinkField doctype="Tax Withholding Category" value={terms.tds_category} onChange={(v) => setT("tds_category", v)} placeholder="(optional)" />
          </Field>
          <Field label="Labour cess">
            <label style={{ display: "flex", alignItems: "center", gap: 8, height: 40, fontSize: 13 }}>
              <input type="checkbox" checked={terms.apply_labour_cess} onChange={(e) => setT("apply_labour_cess", e.target.checked)} />
              Apply {terms.apply_labour_cess ? `@ ${terms.labour_cess_pct}%` : ""}
            </label>
          </Field>
        </div>
      </Card>

      {err && (
        <Card style={{ padding: 16, marginBottom: 18, borderColor: "var(--err-bg)" }}>
          <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>Could not create</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{err}</div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        {!canSubmit && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Company, contractor, title and at least one complete BOQ item are required.
          </span>
        )}
        <Btn variant="primary" onClick={submit} disabled={!canSubmit || loading}>
          {loading ? "Creating…" : "Create Work Order"}
        </Btn>
      </div>
    </>
  );
}
