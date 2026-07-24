import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappePostCall } from "frappe-react-sdk";
import { Card, PageHead, SectionTitle, Btn, Money, Num } from "../components/ui";
import { Icon } from "../components/icons";
import { Field, DateInput, LinkField, NumberInput } from "../components/form";
import { qty as fq } from "../lib/format";

const SEED_METHOD =
  "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill.get_initial_bill_entries";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const n = (s: any) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

type Entry = {
  item_key: string;
  item_no: string;
  summary_head: string;
  description: string;
  uom: string;
  total_sanctioned_qty: number;
  cumulative_qty: number; // editable — new cumulative to date
  _prev: number; // previously billed (seed default)
  remarks?: string | null;
};

export default function NewRABill() {
  const nav = useNavigate();
  const seed = useFrappePostCall(SEED_METHOD);
  const { createDoc, loading } = useFrappeCreateDoc();
  const [wo, setWo] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    if (!wo) {
      setEntries([]);
      return;
    }
    seed
      .call({ work_order_contract: wo })
      .then((r: any) => {
        const list = Array.isArray(r) ? r : (r?.message ?? []);
        setEntries(list.map((e: any) => ({ ...e, _prev: n(e.cumulative_qty), cumulative_qty: n(e.cumulative_qty) })));
      })
      .catch((e: any) => setErr(e?.message || "Could not load BOQ items for this work order."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo]);

  const setCum = (i: number, v: string) =>
    setEntries((es) => es.map((e, j) => (j === i ? { ...e, cumulative_qty: n(v) } : e)));

  const thisBill = (e: Entry) => Math.max(0, e.cumulative_qty - e._prev);
  const anyBilled = entries.some((e) => thisBill(e) > 0);
  const canSubmit = wo && billDate && anyBilled;

  async function submit() {
    setErr(null);
    try {
      const doc = await createDoc("Work Order RA Bill", {
        naming_series: "RA-.YYYY.-.####",
        civil_work_order: wo,
        bill_date: billDate,
        bill_entries: entries.map((e) => ({
          item_key: e.item_key,
          item_no: e.item_no,
          summary_head: e.summary_head,
          description: e.description,
          uom: e.uom,
          cumulative_qty: e.cumulative_qty,
          total_sanctioned_qty: e.total_sanctioned_qty,
          remarks: e.remarks || undefined,
        })),
      });
      nav(`/ra-bills/${encodeURIComponent(doc.name)}`);
    } catch (e: any) {
      setErr(e?.message || e?._server_messages || "Could not create the RA bill.");
    }
  }

  return (
    <>
      <Link to="/ra-bills" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> RA Bills
      </Link>
      <PageHead title="New RA Bill" sub="Certify cumulative work done against a work order" />

      <Card style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          <Field label="Work Order" required>
            <LinkField doctype="Work Order Contract" value={wo} onChange={setWo} placeholder="Select approved WO" extraFilters={[["docstatus", "=", 1]]} displayField="work_title" />
          </Field>
          <Field label="Bill date" required>
            <DateInput value={billDate} onChange={setBillDate} />
          </Field>
        </div>
      </Card>

      {wo && (
        <Card style={{ padding: "18px 0 6px", marginBottom: 18 }}>
          <div style={{ padding: "0 18px" }}>
            <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{seed.loading ? "loading…" : `${entries.length} items`}</span>}>
              Certify cumulative quantities
            </SectionTitle>
          </div>
          {entries.length ? (
            <div className="scroll-x">
              <table style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {["#", "Description", "UOM", "Sanctioned", "Prev. billed", "Cumulative", "This bill"].map((h, i) => (
                      <th key={i} style={{ textAlign: i < 3 ? "left" : "right", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={e.item_key}>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{e.item_no}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 320 }}>{e.description}</td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>{e.uom}</td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono">{fq(e.total_sanctioned_qty)}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{fq(e._prev)}</span></td>
                      <td style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right", width: 130 }}>
                        <NumberInput value={String(e.cumulative_qty)} onChange={(v) => setCum(i, v)} align="right" />
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}>
                        <span className="mono" style={{ fontWeight: 600, color: thisBill(e) > 0 ? "var(--cyan)" : "var(--text-faint)" }}>{fq(thisBill(e))}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !seed.loading && <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No billable items on this work order.</div>
          )}
        </Card>
      )}

      {err && (
        <Card style={{ padding: 16, marginBottom: 18, borderColor: "var(--err-bg)" }}>
          <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>Could not create</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{typeof err === "string" ? err : JSON.stringify(err)}</div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        {!canSubmit && wo && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Enter a cumulative qty above the previously-billed amount for at least one item.</span>}
        <Btn variant="primary" onClick={submit} disabled={!canSubmit || loading}>
          {loading ? "Creating…" : "Create RA Bill"}
        </Btn>
      </div>
    </>
  );
}
