import { CSSProperties, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDoc } from "frappe-react-sdk";
import { Btn, Card, ErrorNote, Loading, PageHead, SectionTitle } from "../components/ui";
import { Icon } from "../components/icons";
import { Field, DateInput, LinkField, NumberInput, TextArea, TextInput } from "../components/form";
import { inr, num } from "../lib/format";
import type { VariationLineType, WorkOrderBOQItem, WorkOrderContract } from "../lib/types";

const LINE_TYPES: VariationLineType[] = ["Additional Qty", "New Item", "Reduced Qty"];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const n = (s: any) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};
let SEQ = 0;
const uid = () => `l${++SEQ}`;

type Line = {
  _id: string;
  line_type: VariationLineType;
  original_boq_row_uid: string; // "" for New Item
  item_no: string;
  summary_head: string;
  description: string;
  uom: string;
  qty: string; // positive in the UI; controller signs it
  rate: string;
  tax_pct: string;
  deviation_limit_pct: string;
  remarks: string;
  original_qty: number; // frozen contract qty of the referenced row (guard/display)
};

const blankLine = (): Line => ({
  _id: uid(),
  line_type: "Additional Qty",
  original_boq_row_uid: "",
  item_no: "",
  summary_head: "",
  description: "",
  uom: "",
  qty: "",
  rate: "",
  tax_pct: "",
  deviation_limit_pct: "",
  remarks: "",
  original_qty: 0,
});

const isRef = (t: VariationLineType) => t === "Additional Qty" || t === "Reduced Qty";
const signOf = (t: VariationLineType) => (t === "Reduced Qty" ? -1 : 1);
const lineAmount = (l: Line) => signOf(l.line_type) * Math.abs(n(l.qty)) * n(l.rate);

const inputStyle: CSSProperties = {
  height: 40,
  width: "100%",
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: 14,
  outline: "none",
};
const lockedStyle: CSSProperties = { ...inputStyle, background: "var(--bg-sunken)", color: "var(--text-muted)", cursor: "not-allowed" };

const TYPE_TONE: Record<VariationLineType, { c: string; bg: string }> = {
  "Additional Qty": { c: "var(--ok)", bg: "var(--ok-bg)" },
  "New Item": { c: "var(--iris)", bg: "var(--iris-tint)" },
  "Reduced Qty": { c: "var(--err)", bg: "var(--err-bg)" },
};
function TypeBadge({ t }: { t: VariationLineType }) {
  const s = TYPE_TONE[t];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: s.c, background: s.bg, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {t}
    </span>
  );
}

export default function NewVariation() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const { data: wo, isLoading, error } = useFrappeGetDoc<WorkOrderContract>("Work Order Contract", name);
  const { createDoc, loading } = useFrappeCreateDoc();

  const [variationDate, setVariationDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [err, setErr] = useState<string | null>(null);

  const boq: WorkOrderBOQItem[] = wo?.boq_items || [];
  const boqByUid = useMemo(() => {
    const m = new Map<string, WorkOrderBOQItem>();
    boq.forEach((r) => r.boq_row_uid && m.set(r.boq_row_uid, r));
    return m;
  }, [boq]);

  const patch = (id: string, up: Partial<Line>) => setLines((ls) => ls.map((l) => (l._id === id ? { ...l, ...up } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._id !== id) : ls));

  const changeType = (id: string, t: VariationLineType) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l._id !== id) return l;
        // switching to/from New Item resets the referenced-row linkage
        if (t === "New Item") {
          return { ...l, line_type: t, original_boq_row_uid: "", item_no: "", summary_head: "", uom: "", original_qty: 0 };
        }
        return { ...l, line_type: t };
      })
    );

  const pickBoqRow = (id: string, boq_row_uid: string) => {
    const r = boqByUid.get(boq_row_uid);
    if (!r) {
      patch(id, { original_boq_row_uid: "", item_no: "", summary_head: "", uom: "", original_qty: 0 });
      return;
    }
    patch(id, {
      original_boq_row_uid: boq_row_uid,
      item_no: r.item_no || "",
      summary_head: r.summary_head || "",
      uom: r.uom || "",
      description: r.description || "",
      rate: String(r.rate ?? ""),
      tax_pct: String(r.tax_pct ?? ""),
      deviation_limit_pct: String(r.deviation_limit_pct ?? ""),
      original_qty: Number(r.estimated_qty || 0),
    });
  };

  const totals = useMemo(() => {
    let amt = 0;
    let tax = 0;
    lines.forEach((l) => {
      const a = lineAmount(l);
      amt += a;
      tax += (a * n(l.tax_pct)) / 100;
    });
    return { amt, tax, withTax: amt + tax };
  }, [lines]);

  const lineError = (l: Line): string | null => {
    if (isRef(l.line_type) && !l.original_boq_row_uid) return "Pick a BOQ row";
    if (!l.summary_head) return "Summary head required";
    if (!l.description.trim()) return "Description required";
    if (!l.uom) return "UOM required";
    if (Math.abs(n(l.qty)) <= 0) return "Qty required";
    if (n(l.rate) <= 0) return "Rate required";
    if (l.line_type === "Reduced Qty" && Math.abs(n(l.qty)) > l.original_qty)
      return `Cannot reduce more than the contract qty (${num(l.original_qty, 2)})`;
    return null;
  };
  const firstError = lines.map(lineError).find(Boolean) || null;
  const canSubmit = !!wo && !!variationDate && !!reason.trim() && lines.length > 0 && !firstError;

  async function submit() {
    setErr(null);
    if (!wo) return;
    try {
      const doc = await createDoc("Work Order Variation", {
        work_order_contract: name,
        company: wo.company,
        supplier: wo.supplier,
        variation_date: variationDate,
        reason_for_change: reason.trim(),
        variation_items: lines.map((l) => ({
          line_type: l.line_type,
          original_boq_row_uid: l.line_type === "New Item" ? undefined : l.original_boq_row_uid,
          item_no: l.item_no || undefined,
          summary_head: l.summary_head,
          description: l.description.trim(),
          uom: l.uom,
          qty: Math.abs(n(l.qty)), // positive; controller stores signed
          rate: n(l.rate),
          tax_pct: n(l.tax_pct) || 0,
          deviation_limit_pct:
            l.line_type === "Reduced Qty" || l.deviation_limit_pct === "" ? undefined : n(l.deviation_limit_pct),
          remarks: l.remarks || undefined,
        })),
      });
      nav(`/variations/${encodeURIComponent(doc.name)}`);
    } catch (e: any) {
      setErr(e?.message || e?._server_messages || "Could not create the variation.");
    }
  }

  if (isLoading) return <Loading label="Loading work order…" />;
  if (error) return <ErrorNote error={error} />;
  if (!wo) return <ErrorNote error="Work order not found." />;

  const notApproved = wo.docstatus !== 1;

  return (
    <>
      <Link to={`/work-orders/${encodeURIComponent(name)}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> {name}
      </Link>
      <PageHead title="New Variation" sub={<>Scope change against <strong>{wo.work_title || name}</strong> · {wo.supplier_name || wo.supplier}</>} />

      {notApproved && (
        <Card style={{ padding: 14, marginBottom: 18, borderColor: "var(--pending-bg)" }}>
          <div style={{ fontSize: 12.5, color: "var(--pending)" }}>
            This work order is not approved yet. Variations normally apply to an approved contract.
          </div>
        </Card>
      )}

      {/* Header */}
      <Card style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          <Field label="Variation date" required>
            <DateInput value={variationDate} onChange={setVariationDate} />
          </Field>
          <Field label="Reason for change" required hint="Why is the scope changing?">
            <TextArea value={reason} onChange={setReason} rows={2} placeholder="e.g. Client added false-ceiling work in the lobby" />
          </Field>
        </div>
      </Card>

      {/* Lines */}
      <Card style={{ padding: "18px", marginBottom: 18 }}>
        <SectionTitle
          right={
            <Btn variant="secondary" onClick={addLine}>
              <Icon name="plus" size={15} /> Add line
            </Btn>
          }
        >
          Variation lines
        </SectionTitle>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {lines.map((l, i) => {
            const le = lineError(l);
            const ref = isRef(l.line_type);
            const locked = ref; // summary_head + uom locked to the original
            return (
              <div key={l._id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--bg-card)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>#{i + 1}</span>
                    <TypeBadge t={l.line_type} />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(l._id)}
                    disabled={lines.length === 1}
                    title="Remove line"
                    style={{ display: "inline-flex", background: "transparent", border: "none", color: lines.length === 1 ? "var(--text-faint)" : "var(--text-muted)", cursor: lines.length === 1 ? "not-allowed" : "pointer", padding: 4 }}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, marginBottom: 12 }}>
                  <Field label="Line type">
                    <select value={l.line_type} onChange={(e) => changeType(l._id, e.target.value as VariationLineType)} style={inputStyle}>
                      {LINE_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>

                  {ref ? (
                    <Field label="Original BOQ row" required hint="Additional / reduced qty applies to this existing item">
                      <select value={l.original_boq_row_uid} onChange={(e) => pickBoqRow(l._id, e.target.value)} style={inputStyle}>
                        <option value="">Select BOQ row…</option>
                        {boq.map((r) => (
                          <option key={r.boq_row_uid} value={r.boq_row_uid}>
                            #{r.item_no} · {r.description} ({r.uom}) · {num(r.estimated_qty, 2)} @ {num(r.rate, 2)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field label="Summary head" required hint="Service item (Work Order Items group)">
                      <LinkField
                        doctype="Item"
                        value={l.summary_head}
                        onChange={(v) => patch(l._id, { summary_head: v })}
                        extraFilters={[["item_group", "=", "Work Order Items"]]}
                        displayField="item_name"
                        placeholder="Select service item"
                      />
                    </Field>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <Field label="Description" required>
                    <TextInput value={l.description} onChange={(v) => patch(l._id, { description: v })} placeholder="Line description" />
                  </Field>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, alignItems: "end" }}>
                  <Field label="UOM" required>
                    {locked ? (
                      <input value={l.uom} readOnly style={lockedStyle} />
                    ) : (
                      <LinkField doctype="UOM" value={l.uom} onChange={(v) => patch(l._id, { uom: v })} placeholder="Unit" />
                    )}
                  </Field>
                  <Field label={l.line_type === "Reduced Qty" ? "Reduce qty by" : "Qty"} required>
                    <NumberInput value={l.qty} onChange={(v) => patch(l._id, { qty: v })} align="right" />
                  </Field>
                  <Field label="Rate" required>
                    {l.line_type === "Reduced Qty" ? (
                      <input value={l.rate} readOnly style={{ ...lockedStyle, textAlign: "right", fontFamily: "var(--font-mono)" }} />
                    ) : (
                      <NumberInput value={l.rate} onChange={(v) => patch(l._id, { rate: v })} align="right" />
                    )}
                  </Field>
                  <Field label="Tax %">
                    {l.line_type === "Reduced Qty" ? (
                      <input value={l.tax_pct} readOnly style={{ ...lockedStyle, textAlign: "right", fontFamily: "var(--font-mono)" }} />
                    ) : (
                      <NumberInput value={l.tax_pct} onChange={(v) => patch(l._id, { tax_pct: v })} align="right" suffix="%" />
                    )}
                  </Field>
                  {l.line_type !== "Reduced Qty" && (
                    <Field label="Deviation %">
                      <NumberInput value={l.deviation_limit_pct} onChange={(v) => patch(l._id, { deviation_limit_pct: v })} align="right" suffix="%" />
                    </Field>
                  )}
                  <Field label="Amount">
                    <div className="mono" style={{ height: 40, display: "flex", alignItems: "center", justifyContent: "flex-end", fontWeight: 600, color: lineAmount(l) < 0 ? "var(--err)" : "var(--cyan)" }}>
                      {inr(lineAmount(l))}
                    </div>
                  </Field>
                </div>

                {le && <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--err)" }}>{le}</div>}
              </div>
            );
          })}
        </div>

        {/* Running total */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 28, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ textAlign: "right" }}>
            <div className="eyebrow">Net change</div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: totals.amt < 0 ? "var(--err)" : "var(--text-primary)" }}>{inr(totals.amt)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="eyebrow">Tax</div>
            <div className="mono" style={{ fontSize: 15 }}>{num(totals.tax)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="eyebrow">With tax</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: totals.withTax < 0 ? "var(--err)" : "var(--cyan)" }}>{inr(totals.withTax)}</div>
          </div>
        </div>
      </Card>

      {err && (
        <Card style={{ padding: 16, marginBottom: 18, borderColor: "var(--err-bg)" }}>
          <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>Could not create</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{typeof err === "string" ? err : JSON.stringify(err)}</div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        {firstError && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{firstError}</span>}
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>You'll submit it on the next screen.</span>
        <Btn variant="primary" onClick={submit} disabled={!canSubmit || loading}>
          {loading ? "Creating…" : "Create Variation"}
        </Btn>
      </div>
    </>
  );
}
