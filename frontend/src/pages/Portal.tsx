/* The contractor portal — the outside-facing half of SiteBill.
 *
 * Deliberately its own visual world (site amber, not office iris) and its own
 * vocabulary: "claims", not "RA bills"; "your work orders", not a doctype
 * list. A contractor commonly holds SEVERAL work orders, so every screen is
 * built around that: the home lists them all, and raising a claim always
 * starts by choosing which work order it is against.
 *
 * Security note: nothing here is a permission boundary. The server scopes
 * every read and write to this contractor's supplier(s); this is just the
 * face on top of it.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useFrappeAuth, useFrappeCreateDoc, useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Card, Chip, ErrorNote, Loading, Money, Num, PageHead, SectionTitle } from "../components/ui";
import { Icon } from "../components/icons";
import { serverMessage } from "../components/ReviewBar";
import { fmtDate, num, pct, qty as fq } from "../lib/format";
import { portalTitle, usePortal } from "../lib/portal";
import type { WorkOrderRABill } from "../lib/types";

const WO_METHOD = "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill.get_portal_work_orders";
const SEED_METHOD = "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill.get_initial_bill_entries";
const APPLY_METHOD = "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill.apply_review_action";
const UPLOAD_METHOD = "/api/method/dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill.upload_supplier_invoice";

const n = (v: any) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const todayISO = () => new Date().toISOString().slice(0, 10);

/* Plain-English status for a contractor — never internal jargon. */
function claimStatus(b: Partial<WorkOrderRABill>): { label: string; tone: string } {
  if (b.docstatus === 2) return { label: "Cancelled", tone: "var(--text-muted)" };
  const s = b.review_state || (b.docstatus === 1 ? "Approved" : "Draft");
  switch (s) {
    case "Draft": return { label: "Draft — not sent", tone: "var(--text-muted)" };
    case "Pending Review": return { label: "With client for review", tone: "#c96a10" };
    case "Returned for Revision": return { label: "Returned to you", tone: "var(--err)" };
    case "Approved": return { label: "Approved", tone: "var(--ok)" };
    case "Rejected": return { label: "Rejected", tone: "var(--err)" };
    default: return { label: String(s), tone: "var(--text-muted)" };
  }
}

/* ---------------- shell ---------------- */

function PortalShell({ children }: { children: React.ReactNode }) {
  const { ctx } = usePortal();
  const { logout } = useFrappeAuth();
  const nav = useNavigate();
  const tabs = [
    { to: "/portal", label: "Work orders" },
    { to: "/portal/claims", label: "My claims" },
  ];
  const here = window.location.hash.replace("#", "") || "/portal";
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <header style={{
        borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)",
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", gap: 16, height: 60 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: "#c96a10", color: "#fff",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, flex: "none",
          }}>{(portalTitle(ctx)[0] || "C").toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {portalTitle(ctx)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Contractor portal</div>
          </div>
          <nav style={{ display: "flex", gap: 4, marginLeft: 18 }}>
            {tabs.map((t) => {
              const active = t.to === "/portal" ? here === "/portal" : here.startsWith(t.to);
              return (
                <Link key={t.to} to={t.to} style={{
                  padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: active ? 650 : 500,
                  color: active ? "#c96a10" : "var(--text-secondary)",
                  background: active ? "rgba(201,106,16,.10)" : "transparent",
                }}>{t.label}</Link>
              );
            })}
          </nav>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{ctx?.full_name || ctx?.user}</span>
            <button
              onClick={() => logout().then(() => { window.location.href = "/login"; }).catch(() => nav("/portal"))}
              style={{
                border: "1px solid var(--border-strong)", background: "var(--bg-surface)", borderRadius: 8,
                padding: "6px 11px", fontSize: 12.5, cursor: "pointer", color: "var(--text-primary)",
              }}
            >Sign out</button>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 1060, margin: "0 auto", padding: "26px 20px 60px" }}>{children}</main>
    </div>
  );
}

/* ---------------- work orders (home) ---------------- */

function PortalHome() {
  const { data, isLoading, error } = useFrappeGetCall<{ message: any[] }>(WO_METHOD, undefined, "portal-wos");
  const wos = data?.message || [];
  if (isLoading) return <Loading label="Loading your work orders…" />;
  if (error) return <ErrorNote error={error} />;

  const totalValue = wos.reduce((s, w) => s + n(w.total_amount), 0);
  const totalCert = wos.reduce((s, w) => s + n(w.certified), 0);

  return (
    <>
      <PageHead title="Your work orders" sub={`${wos.length} work order${wos.length === 1 ? "" : "s"} awarded to you`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Awarded value</div>
          <div style={{ fontSize: 18, marginTop: 5 }}><Money v={totalValue} dec={0} /></div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Certified to date</div>
          <div className="mono" style={{ fontSize: 18, marginTop: 5, color: "var(--ok)" }}>{num(totalCert)}</div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Progress</div>
          <div className="mono" style={{ fontSize: 18, marginTop: 5 }}>{pct(totalValue ? (totalCert / totalValue) * 100 : 0)}</div>
        </Card>
      </div>

      {wos.length === 0 && (
        <Card style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
          No work orders have been issued to you yet.
        </Card>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {wos.map((w) => {
          const prog = n(w.total_amount) ? (n(w.certified) / n(w.total_amount)) * 100 : 0;
          return (
            <Card key={w.name} style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{w.work_title || w.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                    <span className="mono">{w.name}</span> · {w.company}
                    {w.site_location ? ` · ${w.site_location}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="eyebrow">Awarded</div>
                  <div className="mono" style={{ fontWeight: 700 }}>{num(w.total_amount)}</div>
                </div>
                <div style={{ textAlign: "right", minWidth: 120 }}>
                  <div className="eyebrow">Certified</div>
                  <div className="mono" style={{ fontWeight: 700, color: "var(--ok)" }}>{num(w.certified)}</div>
                </div>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "var(--bg-sunken)", overflow: "hidden", margin: "12px 0 8px" }}>
                <div style={{ width: `${Math.min(100, Math.max(0, prog))}%`, height: "100%", background: "#c96a10" }} />
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                <span>{pct(prog)} certified · {w.bills} claim{w.bills === 1 ? "" : "s"} approved</span>
                {w.open_claims > 0 && (
                  <Link to="/portal/claims" style={{ textDecoration: "none" }}>
                    <Chip label={`${w.open_claims} in progress`} />
                  </Link>
                )}
                <Link to={`/portal/work-orders/${encodeURIComponent(w.name)}`} style={{
                  marginLeft: "auto", border: "1px solid var(--border-strong)", padding: "6px 12px",
                  borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)",
                }}>View details</Link>
                <Link to={`/portal/claims/new?wo=${encodeURIComponent(w.name)}`} style={{
                  background: "#c96a10", color: "#fff", padding: "7px 13px",
                  borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                }}>Raise a claim</Link>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}


/* ---------------- one work order ---------------- */

function PortalWorkOrder() {
  const { name = "" } = useParams();
  const { data: w, isLoading, error } = useFrappeGetDoc<any>("Work Order Contract", name);
  const claims = useFrappeGetDocList<WorkOrderRABill>("Work Order RA Bill", {
    fields: ["name", "bill_date", "net_payable", "claimed_net_payable", "review_state", "docstatus"],
    filters: [["civil_work_order", "=", name]],
    limit: 0,
    orderBy: { field: "creation", order: "desc" },
  }, name ? `portal-wo-claims-${name}` : null);

  if (isLoading) return <Loading label="Loading work order…" />;
  if (error) return <ErrorNote error={error} />;
  if (!w) return <ErrorNote error="Work order not found." />;

  const boq = w.boq_items || [];
  const certified = (claims.data || [])
    .filter((c) => c.docstatus === 1)
    .reduce((s, c) => s + n(c.net_payable), 0);

  return (
    <>
      <Link to="/portal" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Your work orders
      </Link>
      <PageHead
        title={w.work_title || w.name}
        sub={<><span className="mono">{w.name}</span> · {w.company}{w.site_location ? ` · ${w.site_location}` : ""}</>}
        right={<Link to={`/portal/claims/new?wo=${encodeURIComponent(w.name)}`} style={{
          background: "#c96a10", color: "#fff", padding: "9px 15px", borderRadius: 9,
          fontSize: 13, fontWeight: 650, display: "inline-block",
        }}>Raise a claim</Link>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Awarded value</div>
          <div style={{ fontSize: 17, marginTop: 5 }}><Money v={w.total_amount} dec={0} /></div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Certified to date</div>
          <div className="mono" style={{ fontSize: 17, marginTop: 5, color: "var(--ok)" }}>{num(certified)}</div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Retention held back</div>
          <div className="mono" style={{ fontSize: 17, marginTop: 5 }}>{w.retention_percentage ? pct(w.retention_percentage) : "None"}</div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">Completion by</div>
          <div className="mono" style={{ fontSize: 15, marginTop: 6 }}>{fmtDate(w.scheduled_completion_date)}</div>
        </Card>
      </div>

      <Card style={{ padding: "18px 0 6px", marginBottom: 18 }}>
        <div style={{ padding: "0 18px" }}>
          <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{boq.length} items</span>}>
            Schedule of work &amp; rates
          </SectionTitle>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
            The agreed scope and rates. Claim against these quantities as work is completed.
          </div>
        </div>
        <div className="scroll-x">
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>{["#", "Description", "UOM", "Qty", "Rate", "Amount"].map((h, i) => (
                <th key={i} style={{ textAlign: i > 2 ? "right" : "left", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {boq.map((r: any) => (
                <tr key={r.name}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{r.item_no}</span></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 420 }}>{r.description}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>{r.uom}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono">{fq(r.estimated_qty)}</span></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono">{num(r.rate)}</span></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ fontWeight: 600 }}>{num(r.amount)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ padding: "12px 14px", textAlign: "right", fontWeight: 650, borderTop: "2px solid var(--border-strong)" }}>Total (excl. GST)</td>
                <td style={{ padding: "12px 14px", textAlign: "right", borderTop: "2px solid var(--border-strong)" }}>
                  <span className="mono" style={{ fontWeight: 700 }}>{num(w.total_amount)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card style={{ padding: "18px 0 6px" }}>
        <div style={{ padding: "0 18px" }}><SectionTitle>Your claims on this work order</SectionTitle></div>
        {(claims.data || []).length === 0 ? (
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No claims raised yet.</div>
        ) : (
          <div className="scroll-x">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>{["Claim", "Date", "Claimed", "Certified", "Status"].map((h, i) => (
                  <th key={i} style={{ textAlign: i > 1 && i < 4 ? "right" : "left", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(claims.data || []).map((c) => {
                  const st = claimStatus(c);
                  return (
                    <tr key={c.name} style={{ cursor: "pointer" }} onClick={() => { window.location.hash = `/portal/claims/${encodeURIComponent(c.name)}`; }}>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono">{fmtDate(c.bill_date)}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono">{n(c.claimed_net_payable) ? num(c.claimed_net_payable) : "—"}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ fontWeight: 600 }}>{num(c.net_payable)}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span style={{ color: st.tone, fontWeight: 600, fontSize: 12 }}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ---------------- my claims ---------------- */


function PortalClaims() {
  const { data, isLoading, error } = useFrappeGetDocList<WorkOrderRABill>("Work Order RA Bill", {
    fields: ["name", "civil_work_order", "bill_date", "gross_this_bill", "net_payable",
      "review_state", "billing_status", "docstatus", "claimed_net_payable"],
    limit: 0,
    orderBy: { field: "creation", order: "desc" },
  }, "portal-claims");

  if (isLoading) return <Loading label="Loading your claims…" />;
  if (error) return <ErrorNote error={error} />;
  const rows = data || [];

  return (
    <>
      <PageHead
        title="Your claims"
        sub={`${rows.length} claim${rows.length === 1 ? "" : "s"} raised`}
        right={<Link to="/portal/claims/new" style={{
          background: "#c96a10", color: "#fff", padding: "9px 15px", borderRadius: 9,
          fontSize: 13, fontWeight: 600, display: "inline-block",
        }}>Raise a claim</Link>}
      />
      {rows.length === 0 ? (
        <Card style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
          You haven't raised any claims yet.
        </Card>
      ) : (
        <Card style={{ padding: "6px 0" }}>
          <div className="scroll-x">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>{["Claim", "Work order", "Date", "Claimed", "Certified", "Status"].map((h, i) => (
                  <th key={i} style={{ textAlign: i > 2 && i < 5 ? "right" : "left", padding: "11px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const st = claimStatus(b);
                  return (
                    <tr key={b.name} style={{ cursor: "pointer" }} onClick={() => { window.location.hash = `/portal/claims/${encodeURIComponent(b.name)}`; }}>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600 }}>{b.name}</td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono" style={{ fontSize: 12 }}>{b.civil_work_order}</span></td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono">{fmtDate(b.bill_date)}</span></td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono">{n(b.claimed_net_payable) ? num(b.claimed_net_payable) : "—"}</span></td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ fontWeight: 600 }}>{num(b.net_payable)}</span></td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                        <span style={{ color: st.tone, fontWeight: 600, fontSize: 12 }}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/* ---------------- raise a claim ---------------- */

function PortalNewClaim() {
  const nav = useNavigate();
  const preset = new URLSearchParams(window.location.hash.split("?")[1] || "").get("wo") || "";
  const { data: woData } = useFrappeGetCall<{ message: any[] }>(WO_METHOD, undefined, "portal-wos");
  const wos = woData?.message || [];
  const [wo, setWo] = useState(preset);
  const [billDate, setBillDate] = useState(todayISO());
  const [entries, setEntries] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const seed = useFrappePostCall(SEED_METHOD);
  const { createDoc, loading } = useFrappeCreateDoc();
  const apply = useFrappePostCall(APPLY_METHOD);

  useEffect(() => {
    if (!wo) { setEntries([]); return; }
    setErr(null);
    seed.call({ work_order_contract: wo })
      .then((r: any) => {
        const list = Array.isArray(r) ? r : r?.message ?? [];
        setEntries(list.map((e: any) => ({ ...e, _prev: n(e.cumulative_qty), cumulative_qty: n(e.cumulative_qty) })));
      })
      .catch((e: any) => setErr(serverMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo]);

  const thisClaim = (e: any) => Math.max(0, n(e.cumulative_qty) - n(e._prev));
  const anything = entries.some((e) => thisClaim(e) > 0);
  // The server refuses to save a claim above the sanctioned ceiling, so stop
  // it here too rather than letting them fill in a whole claim and be rejected.
  const ceiling = (e: any) => (n(e.max_claimable) || n(e.total_sanctioned_qty));
  const over = (e: any) => n(e.cumulative_qty) > ceiling(e) + 1e-9;
  const overLines = entries.filter(over);

  async function send() {
    setErr(null);
    try {
      const doc = await createDoc("Work Order RA Bill", {
        naming_series: "RA-.YYYY.-.####",
        civil_work_order: wo,
        bill_date: billDate,
        bill_entries: entries.map((e) => ({
          item_key: e.item_key, item_no: e.item_no, summary_head: e.summary_head,
          description: e.description, uom: e.uom,
          cumulative_qty: n(e.cumulative_qty), total_sanctioned_qty: n(e.total_sanctioned_qty),
        })),
      });
      // Raise AND send in one step — a draft nobody submits helps no one.
      await apply.call({ ra_bill: doc.name, action: "submit_for_review" });
      nav(`/portal/claims/${encodeURIComponent(doc.name)}`);
    } catch (e: any) {
      setErr(serverMessage(e));
    }
  }

  return (
    <>
      <Link to="/portal/claims" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Your claims
      </Link>
      <PageHead title="Raise a claim" sub="Enter the total quantity completed to date on each item" />

      <Card style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Work order</div>
            <select value={wo} onChange={(e) => setWo(e.target.value)} style={{
              height: 40, width: "100%", padding: "0 11px", borderRadius: 9,
              border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
              color: "var(--text-primary)", fontSize: 13.5,
            }}>
              <option value="">Choose a work order…</option>
              {wos.map((w) => <option key={w.name} value={w.name}>{w.name} — {w.work_title}</option>)}
            </select>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Claim date</div>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} style={{
              height: 40, width: "100%", padding: "0 11px", borderRadius: 9,
              border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
              color: "var(--text-primary)", fontSize: 13.5,
            }} />
          </div>
        </div>
      </Card>

      {wo && (
        <Card style={{ padding: "18px 0 6px", marginBottom: 18 }}>
          <div style={{ padding: "0 18px" }}>
            <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{seed.loading ? "loading…" : `${entries.length} items`}</span>}>
              Work completed
            </SectionTitle>
          </div>
          <div className="scroll-x">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>{["#", "Item", "UOM", "Rate", "Sanctioned", "Already billed", "Total to date", "This claim", "Claim value"].map((h, i) => (
                  <th key={i} style={{ textAlign: i > 2 ? "right" : "left", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.item_key}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{e.item_no}</span></td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 300 }}>{e.description}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>{e.uom}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}>
                      <span className="mono">{num(e.rate)}</span>
                      {e.rate_varies ? <span title="This item is billed across scopes with different rates" style={{ marginLeft: 4, fontSize: 10, color: "var(--text-faint)" }}>*</span> : null}
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{fq(e.total_sanctioned_qty)}</span></td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{fq(e._prev)}</span></td>
                    <td style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}>
                      <input type="number" step="any" value={String(e.cumulative_qty)}
                        onChange={(ev) => setEntries((es) => es.map((x, j) => j === i ? { ...x, cumulative_qty: n(ev.target.value) } : x))}
                        style={{
                          width: 110, height: 32, padding: "0 9px", textAlign: "right", borderRadius: 7,
                          border: `1px solid ${over(e) ? "var(--err)" : thisClaim(e) > 0 ? "#c96a10" : "var(--border-strong)"}`,
                          background: over(e) ? "var(--err-bg)" : thisClaim(e) > 0 ? "rgba(201,106,16,.08)" : "var(--bg-surface)",
                          color: over(e) ? "var(--err)" : "var(--text-primary)", fontSize: 12.5,
                          fontWeight: over(e) ? 700 : 400,
                        }} />
                      {over(e) && (
                        <div style={{ fontSize: 10.5, color: "var(--err)", marginTop: 3, whiteSpace: "nowrap" }}>
                          max {fq(ceiling(e))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}>
                      <span className="mono" style={{ fontWeight: 700, color: thisClaim(e) > 0 ? "#c96a10" : "var(--text-faint)" }}>{fq(thisClaim(e))}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}>
                      <span className="mono" style={{ fontWeight: 700, color: thisClaim(e) > 0 ? "var(--text-primary)" : "var(--text-faint)" }}>{num(thisClaim(e) * n(e.rate))}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {err && (
        <Card style={{ padding: 15, marginBottom: 16, borderColor: "var(--err-bg)" }}>
          <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 3 }}>Could not send this claim</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{err}</div>
        </Card>
      )}

      {wo && entries.length > 0 && (
        <Card style={{ padding: "14px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Value of this claim</span>
          <span className="mono" style={{ fontSize: 19, fontWeight: 700, color: "#c96a10" }}>
            {num(entries.reduce((sum, e) => sum + thisClaim(e) * n(e.rate), 0))}
          </span>
          <span style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--text-muted)" }}>
            Before retention and any deductions the client applies. GST is added on the tax invoice.
          </span>
        </Card>
      )}

      {overLines.length > 0 && (
        <Card style={{ padding: 15, marginBottom: 16, borderLeft: "3px solid var(--err)" }}>
          <div style={{ color: "var(--err)", fontWeight: 650, fontSize: 13 }}>
            {overLines.length} item{overLines.length === 1 ? " exceeds" : "s exceed"} the sanctioned quantity
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>
            You cannot claim more than the work order allows. Reduce the highlighted lines to their
            maximum, or ask the client to issue a variation first.
          </div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        {wo && !anything && overLines.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Increase at least one item above what's already billed.</span>}
        <button onClick={send} disabled={!wo || !anything || overLines.length > 0 || loading || apply.loading} style={{
          background: (!wo || !anything || overLines.length > 0 || loading || apply.loading) ? "var(--border-strong)" : "#c96a10",
          color: "#fff", border: "none", borderRadius: 9, padding: "10px 18px",
          fontSize: 13.5, fontWeight: 650, cursor: (!wo || !anything || overLines.length > 0) ? "not-allowed" : "pointer",
        }}>{loading || apply.loading ? "Sending…" : "Send claim to client"}</button>
      </div>
    </>
  );
}

/* ---------------- one claim ---------------- */

function PortalClaim() {
  const { name = "" } = useParams();
  const { data: b, isLoading, error, mutate } = useFrappeGetDoc<WorkOrderRABill>("Work Order RA Bill", name);
  const apply = useFrappePostCall(APPLY_METHOD);
  const [err, setErr] = useState<string | null>(null);

  if (isLoading) return <Loading label="Loading claim…" />;
  if (error) return <ErrorNote error={error} />;
  if (!b) return <ErrorNote error="Claim not found." />;

  const st = claimStatus(b);
  const claimed = n(b.claimed_net_payable);
  const certified = n(b.net_payable);
  const adjusted = claimed > 0 && Math.abs(certified - claimed) > 0.01;
  const canResend = b.review_state === "Returned for Revision";

  async function resend() {
    setErr(null);
    try { await apply.call({ ra_bill: name, action: "submit_for_review" }); mutate(); }
    catch (e: any) { setErr(serverMessage(e)); }
  }

  return (
    <>
      <Link to="/portal/claims" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> Your claims
      </Link>
      <PageHead
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {b.name}<span style={{ color: st.tone, fontSize: 13, fontWeight: 650 }}>{st.label}</span>
        </span>}
        sub={<>Against work order <span className="mono">{b.civil_work_order}</span> · {fmtDate(b.bill_date)}</>}
        right={canResend ? (
          <button onClick={resend} disabled={apply.loading} style={{
            background: "#c96a10", color: "#fff", border: "none", borderRadius: 9,
            padding: "9px 15px", fontSize: 13, fontWeight: 650, cursor: "pointer",
          }}>{apply.loading ? "Sending…" : "Send again"}</button>
        ) : undefined}
      />

      {b.docstatus === 1 && <InvoiceUpload bill={b} onDone={() => mutate()} />}

      {canResend && (
        <Card style={{ padding: 15, marginBottom: 16, borderLeft: "3px solid var(--err)" }}>
          <div style={{ fontWeight: 650, fontSize: 13, color: "var(--err)" }}>The client has sent this back to you</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>
            See their note below, update the quantities with your site engineer, then send it again.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: "14px 16px" }}>
          <div className="eyebrow">You claimed</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 5 }}>{claimed ? num(claimed) : "—"}</div>
        </Card>
        <Card accent style={{ padding: "14px 16px" }}>
          <div className="eyebrow">{b.docstatus === 1 ? "Certified" : "Currently"}</div>
          <div style={{ fontSize: 18, marginTop: 5 }}><Money v={certified} strong /></div>
        </Card>
        {adjusted && (
          <Card style={{ padding: "14px 16px" }}>
            <div className="eyebrow">Adjusted by client</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 5, color: "var(--err)" }}>{num(certified - claimed)}</div>
          </Card>
        )}
      </div>

      <Card style={{ padding: "18px 0 6px" }}>
        <div style={{ padding: "0 18px" }}><SectionTitle>Items in this claim</SectionTitle></div>
        <div className="scroll-x">
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>{["#", "Item", "UOM", "This claim", "Rate", "Amount"].map((h, i) => (
                <th key={i} style={{ textAlign: i > 2 ? "right" : "left", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(b.items || []).map((it) => (
                <tr key={it.name}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}><span className="mono" style={{ color: "var(--text-muted)" }}>{it.item_no}</span></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", maxWidth: 320 }}>{it.description}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>{it.uom}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono">{fq(it.this_bill_qty)}</span></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><Num v={it.rate} /></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}><span className="mono" style={{ fontWeight: 600 }}>{num(it.this_bill_amount)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(b.deductions || []).length > 0 && (
          <div style={{ padding: "14px 18px 6px", borderTop: "1px solid var(--border-subtle)", marginTop: 8 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Deductions applied by the client</div>
            {(b.deductions || []).map((d) => (
              <div key={d.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                <span style={{ color: "var(--text-secondary)" }}>{d.description || d.nature}</span>
                <span className="mono" style={{ color: "var(--err)" }}>− {num(d.amount)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700, paddingTop: 8, marginTop: 6, borderTop: "1px solid var(--border-subtle)" }}>
              <span>Net payable to you</span>
              <span className="mono" style={{ color: "var(--ok)" }}>{num(certified)}</span>
            </div>
          </div>
        )}
      </Card>

      {err && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--err)" }}>{err}</div>}

      <div style={{ marginTop: 16, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
        GST and TDS are applied on the tax invoice, not on this claim.
      </div>
    </>
  );
}


/* Attach the contractor's own tax invoice to an approved claim.
 * They upload a document and three facts; the client still raises the
 * actual Purchase Invoice. Nothing here touches the ledger. */
function InvoiceUpload({ bill, onDone }: { bill: any; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [no, setNo] = useState(bill.supplier_invoice_no || "");
  const [date, setDate] = useState(bill.supplier_invoice_date || todayISO());
  const [amount, setAmount] = useState(String(n(bill.net_payable) || ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const already = bill.supplier_invoice_file;

  async function send() {
    if (!file) { setErr("Choose your invoice file first."); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("ra_bill", bill.name);
      fd.append("invoice_no", no);
      fd.append("invoice_date", date);
      fd.append("invoice_amount", amount);
      const res = await fetch(UPLOAD_METHOD, {
        method: "POST",
        credentials: "include",
        headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw j;
      onDone();
    } catch (e: any) {
      setErr(serverMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (already) {
    return (
      <Card style={{ padding: 16, marginBottom: 18, borderLeft: "3px solid var(--ok)" }}>
        <div style={{ fontWeight: 650, fontSize: 13, color: "var(--ok)" }}>Your tax invoice is with the client</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, fontSize: 12.5 }}>
          <span><span style={{ color: "var(--text-muted)" }}>Invoice no </span><b>{bill.supplier_invoice_no || "—"}</b></span>
          <span><span style={{ color: "var(--text-muted)" }}>Dated </span><b>{fmtDate(bill.supplier_invoice_date)}</b></span>
          <span><span style={{ color: "var(--text-muted)" }}>Amount </span><b className="mono">{num(bill.supplier_invoice_amount)}</b></span>
          <a href={already} target="_blank" rel="noreferrer" style={{ color: "#c96a10", fontWeight: 600 }}>View document</a>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 18, marginBottom: 18, borderLeft: "3px solid #c96a10" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Upload your tax invoice</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, marginBottom: 12 }}>
        This claim is approved for <b className="mono">{num(bill.net_payable)}</b>. Raise your invoice for that
        amount and attach it here — PDF, scan or phone photo, up to 10 MB.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 5 }}>Invoice no</div>
          <input value={no} onChange={(e) => setNo(e.target.value)} placeholder="e.g. TVC/2026-27/014"
            style={{ height: 36, width: "100%", padding: "0 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 13 }} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 5 }}>Invoice date</div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ height: 36, width: "100%", padding: "0 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 13 }} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 5 }}>Invoice amount</div>
          <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)}
            style={{ height: 36, width: "100%", padding: "0 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <div>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ fontSize: 12.5, color: "var(--text-secondary)" }} />
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
            PDF, JPG, PNG, WEBP, HEIC or TIFF
          </div>
        </div>
        <button onClick={send} disabled={busy || !file} style={{
          marginLeft: "auto", background: (busy || !file) ? "var(--border-strong)" : "#c96a10", color: "#fff",
          border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 650,
          cursor: (busy || !file) ? "not-allowed" : "pointer",
        }}>{busy ? "Uploading…" : "Send invoice to client"}</button>
      </div>
      {n(amount) > 0 && Math.abs(n(amount) - n(bill.net_payable)) > 1 && (
        <div style={{ fontSize: 12, color: "var(--err)", marginTop: 10 }}>
          Heads up: this differs from the approved amount of {num(bill.net_payable)}. The client may query it.
        </div>
      )}
      {err && <div style={{ fontSize: 12.5, color: "var(--err)", marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</div>}
    </Card>
  );
}

/* ---------------- entry ---------------- */


export default function Portal() {
  return (
    <PortalShell>
      <Routes>
        <Route path="/" element={<PortalHome />} />
        <Route path="/work-orders/:name" element={<PortalWorkOrder />} />
        <Route path="/claims" element={<PortalClaims />} />
        <Route path="/claims/new" element={<PortalNewClaim />} />
        <Route path="/claims/:name" element={<PortalClaim />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    </PortalShell>
  );
}
