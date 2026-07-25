/* Review an RA bill claim: what the contractor claimed against what you
 * certify, with deductions, before approving.
 *
 * The client never sends money figures — only certified quantities and
 * deduction amounts. The server re-runs the allocator and deduction engine
 * on save and returns the authoritative totals, so this screen cannot drift
 * from the backend's arithmetic.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { Btn, Card, Chip, ErrorNote, Loading, Money, Num, PageHead, SectionTitle } from "../components/ui";
import { Icon } from "../components/icons";
import { ReviewBar, serverMessage, useReviewStatus } from "../components/ReviewBar";
import { ClaimThread } from "../components/ClaimThread";
import { num, qty as fq } from "../lib/format";
import { isAddition, type WorkOrderRABill } from "../lib/types";

const UPDATE_METHOD =
  "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill.update_certified_quantities";

const n = (v: any) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

export default function ReviewRABill() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const { data: bill, isLoading, error, mutate } = useFrappeGetDoc<WorkOrderRABill>("Work Order RA Bill", name);
  const { status, mutate: mutateStatus } = useReviewStatus(name);
  const save = useFrappePostCall(UPDATE_METHOD);

  // certified qty per line, keyed by item_key; seeded from the server doc
  const [certified, setCertified] = useState<Record<string, number>>({});
  const [dedAmounts, setDedAmounts] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!bill) return;
    const c: Record<string, number> = {};
    (bill.bill_entries || []).forEach((e) => { if (e.item_key) c[e.item_key] = n(e.cumulative_qty); });
    setCertified(c);
    const d: Record<string, number> = {};
    (bill.deductions || []).forEach((x) => { d[x.name] = n(x.amount); });
    setDedAmounts(d);
    setDirty(false);
  }, [bill?.name, bill?.modified]);

  // What the contractor originally claimed, for the side-by-side.
  const claimedTotal = n(bill?.claimed_net_payable);

  const deductions = useMemo(() => (bill?.deductions || []).filter((d) => !isAddition(d.nature)), [bill]);
  const additions = useMemo(() => (bill?.deductions || []).filter((d) => isAddition(d.nature)), [bill]);

  if (isLoading) return <Loading label="Loading claim…" />;
  if (error) return <ErrorNote error={error} />;
  if (!bill) return <ErrorNote error="RA bill not found." />;

  const editable = bill.docstatus === 0;

  async function persist() {
    setSaveErr(null);
    try {
      await save.call({
        ra_bill: name,
        entries: JSON.stringify(
          (bill!.bill_entries || []).map((e) => ({
            item_key: e.item_key,
            cumulative_qty: certified[e.item_key || ""] ?? n(e.cumulative_qty),
          })),
        ),
        deductions: JSON.stringify(
          (bill!.deductions || []).map((d) => ({ name: d.name, amount: dedAmounts[d.name] ?? n(d.amount) })),
        ),
      });
      await mutate();
      mutateStatus();
      setDirty(false);
    } catch (e: any) {
      setSaveErr(serverMessage(e));
    }
  }

  return (
    <>
      <Link to={`/ra-bills/${encodeURIComponent(name)}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> {name}
      </Link>
      <PageHead
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          Review claim {status?.review_state ? <Chip label={status.review_state} /> : null}
        </span>}
        sub={<>{bill.supplier} · work order{" "}
          <Link to={`/work-orders/${encodeURIComponent(bill.civil_work_order || "")}`} style={{ color: "var(--iris)", fontWeight: 500 }}>
            {bill.civil_work_order}
          </Link>
        </>}
        right={<ReviewBar raBill={name} onChanged={() => { mutate(); mutateStatus(); }} />}
      />

      {/* claimed vs certified headline */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Claimed by contractor</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 5 }}>
            {claimedTotal ? num(claimedTotal) : "—"}
          </div>
        </Card>
        <Card accent style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Certified now</div>
          <div style={{ fontSize: 18, marginTop: 5 }}><Money v={bill.net_payable} strong /></div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Adjustment</div>
          <div className="mono" style={{
            fontSize: 18, fontWeight: 700, marginTop: 5,
            color: claimedTotal && n(bill.net_payable) < claimedTotal ? "var(--err)" : "var(--text-primary)",
          }}>
            {claimedTotal ? num(n(bill.net_payable) - claimedTotal) : "—"}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 330px", gap: 18, alignItems: "start" }}>
        {/* certify grid */}
        <Card style={{ padding: "18px 0 6px" }}>
          <div style={{ padding: "0 18px" }}>
            <SectionTitle right={editable ? undefined : <span style={{ fontSize: 12, color: "var(--text-muted)" }}>approved — read only</span>}>
              Certify quantities
            </SectionTitle>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
              Certify less than claimed on any line. Amounts recompute on the server when you save.
            </div>
          </div>
          <div className="scroll-x">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  {["#", "Description", "UOM", "Sanctioned", "Certified", "Note"].map((h, i) => (
                    <th key={i} style={{ textAlign: i > 2 && i < 5 ? "right" : "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(bill.bill_entries || []).map((e) => {
                  const key = e.item_key || e.name;
                  const val = certified[key] ?? n(e.cumulative_qty);
                  const changed = Math.abs(val - n(e.cumulative_qty)) > 1e-9;
                  return (
                    <tr key={e.name}>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{e.item_no}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 340 }}>{e.description || "—"}</td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>{e.uom || "—"}</td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{fq(e.total_sanctioned_qty)}</span></td>
                      <td style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right", width: 130 }}>
                        {editable ? (
                          <input
                            type="number" step="any" value={String(val)}
                            onChange={(ev) => { setCertified((c) => ({ ...c, [key]: n(ev.target.value) })); setDirty(true); }}
                            style={{
                              width: 110, height: 32, padding: "0 9px", textAlign: "right", borderRadius: 7,
                              fontFamily: "var(--font-mono, monospace)", fontSize: 12.5,
                              border: `1px solid ${changed ? "var(--iris)" : "var(--border-strong)"}`,
                              background: changed ? "var(--iris-tint)" : "var(--bg-surface)",
                              color: changed ? "var(--iris)" : "var(--text-primary)",
                              fontWeight: changed ? 700 : 400,
                            }}
                          />
                        ) : <span className="mono">{fq(val)}</span>}
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", fontSize: 11.5, color: "var(--text-muted)" }}>{e.remarks || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {editable && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", padding: "12px 18px 6px", borderTop: "1px solid var(--border-subtle)", marginTop: 8 }}>
              {saveErr && <span style={{ fontSize: 12, color: "var(--err)", marginRight: "auto", whiteSpace: "pre-wrap" }}>{saveErr}</span>}
              {dirty && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Unsaved changes</span>}
              <Btn variant="primary" onClick={persist} disabled={!dirty || save.loading}>
                {save.loading ? "Saving…" : "Save certified quantities"}
              </Btn>
            </div>
          )}
        </Card>

        {/* computation + deductions */}
        <Card accent style={{ padding: 18, position: "sticky", top: 74 }}>
          <SectionTitle>Computation</SectionTitle>
          <Row label="Gross this bill" value={num(bill.gross_this_bill)} />
          {deductions.length > 0 && <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Deductions</div>}
          {deductions.map((d) => (
            <div key={d.name} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "5px 0" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {d.description || d.nature}
                {d.is_auto_suggested ? <span style={{ marginLeft: 5, fontSize: 10, color: "var(--text-faint)" }}>auto</span> : null}
              </span>
              {editable ? (
                <input
                  type="number" step="any" value={String(dedAmounts[d.name] ?? n(d.amount))}
                  onChange={(ev) => { setDedAmounts((m) => ({ ...m, [d.name]: n(ev.target.value) })); setDirty(true); }}
                  style={{
                    width: 108, height: 30, padding: "0 8px", textAlign: "right", borderRadius: 7,
                    border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
                    color: "var(--err)", fontSize: 12.5, fontFamily: "var(--font-mono, monospace)",
                  }}
                />
              ) : (
                <span className="mono" style={{ color: "var(--err)" }}>− {num(d.amount)}</span>
              )}
            </div>
          ))}
          {additions.map((d) => (
            <Row key={d.name} label={d.description || d.nature || ""} value={`+ ${num(d.amount)}`} tone="var(--ok)" />
          ))}
          <div style={{ height: 1, background: "var(--border-subtle)", margin: "10px 0" }} />
          <Row label="Total deductions" value={`− ${num(bill.total_deductions)}`} tone="var(--err)" strong />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 8, marginTop: 6, borderTop: "2px solid var(--border-strong)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Net payable</span>
            <span className="mono" style={{ fontSize: 19, fontWeight: 700, color: "var(--cyan)" }}>{num(bill.net_payable)}</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
            GST and TDS are applied on the Purchase Invoice, not on this certificate.
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <ClaimThread raBill={name} />
      </div>
    </>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: React.ReactNode; tone?: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: "var(--text-secondary)", fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span className="mono" style={{ color: tone || "var(--text-primary)", fontWeight: strong ? 700 : 500 }}>{value}</span>
    </div>
  );
}
