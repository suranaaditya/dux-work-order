/* Work Order Statement — the full money trail for one work order.
 *
 * Contract -> Certified (RA bills) -> Invoiced (PIs, incl. GST/TDS) -> Paid,
 * plus retention / mobilisation held, a WO -> RA -> Invoice -> Payment
 * cascade, and a chronological ledger with a running balance.
 *
 * Frontend-only: assembled from parent-doctype list reads plus the
 * Payment Entry Reference child table. No new backend endpoint.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Card, Chip, ErrorNote, Loading, Money, Num, PageHead, SectionTitle } from "../components/ui";
import { Icon } from "../components/icons";
import { fmtDate, inr, num, pct } from "../lib/format";
import { useChildTable, usePaymentsForInvoices } from "../components/payments";
import { isAddition, type WorkOrderAdvanceRegister, type WorkOrderContract, type WorkOrderRABill } from "../lib/types";

const money = (v?: number) => Number(v || 0);
const csvCell = (v: any) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type PIRow = {
  name: string;
  posting_date?: string;
  bill_no?: string;
  net_total?: number;
  total_taxes_and_charges?: number;
  grand_total?: number;
  outstanding_amount?: number;
  docstatus?: 0 | 1 | 2;
};

/* One stage of the Contract -> Certified -> Invoiced -> Paid strip. */
function Stage({ label, dot, value, sub, fill, pctWidth, strong }: {
  label: string; dot: string; value: React.ReactNode; sub: string; fill: string; pctWidth: number; strong?: boolean;
}) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flex: "none" }} />
        <span className="eyebrow">{label}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: strong ? fill : "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--bg-sunken)", overflow: "hidden", marginTop: 9 }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pctWidth))}%`, height: "100%", borderRadius: 999, background: fill }} />
      </div>
    </Card>
  );
}

/* A single row inside the cascade tree. */
function CascadeRow({ to, id, meta, chip, chipTone, amount, accent, indent, tint }: {
  to: string; id: string; meta: string; chip: string; chipTone: string; amount: number;
  accent: string; indent: number; tint?: string;
}) {
  return (
    <div style={{ marginLeft: indent, position: "relative" }}>
      <div style={{ position: "absolute", left: -13, top: 0, bottom: 0, width: 2, background: "var(--border-subtle)" }} />
      <div style={{ position: "absolute", left: -17, top: 17, width: 10, height: 10, borderRadius: "50%", background: accent, border: "2px solid var(--bg-surface)" }} />
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "10px 12px", margin: "6px 0", borderRadius: 10,
        border: "1px solid var(--border-subtle)", borderLeft: `3px solid ${accent}`,
        background: tint || "var(--bg-surface)",
      }}>
        <Link to={to} style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{id}</Link>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{meta}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
          padding: "2px 7px", borderRadius: 999, color: chipTone, background: `color-mix(in srgb, ${chipTone} 12%, transparent)`,
        }}>{chip}</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 13.5 }}>{num(amount)}</span>
      </div>
    </div>
  );
}

function Line({ label, value, tone, sub, strong, top }: {
  label: string; value: React.ReactNode; tone?: string; sub?: string; strong?: boolean; top?: boolean;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 14, alignItems: "baseline",
      padding: strong ? "10px 0 2px" : "6px 0",
      borderTop: top ? "2px solid var(--border-strong)" : undefined,
      marginTop: top ? 6 : undefined,
    }}>
      <span style={{ fontSize: 13, color: strong ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: strong ? 600 : 400 }}>
        {label}{sub ? <span style={{ color: "var(--text-faint)", fontSize: 11.5, marginLeft: 6 }}>{sub}</span> : null}
      </span>
      <span className="mono" style={{ color: tone || "var(--text-primary)", fontWeight: strong ? 700 : 500, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

export default function WorkOrderStatement() {
  const { name = "" } = useParams();
  const { data: wo, isLoading, error } = useFrappeGetDoc<WorkOrderContract>("Work Order Contract", name);

  const bills = useFrappeGetDocList<WorkOrderRABill>("Work Order RA Bill", {
    fields: ["name", "bill_date", "bill_number", "gross_this_bill", "gross_this_bill_with_tax",
      "total_deductions", "total_additions", "net_payable", "invoiced_amount", "billing_status", "docstatus"],
    filters: [["civil_work_order", "=", name], ["docstatus", "=", 1]],
    limit: 0,
    orderBy: { field: "bill_number", order: "asc" },
  }, name ? `stmt-bills-${name}` : null);

  const billNames = (bills.data || []).map((b) => b.name);

  // PI lines carry wo_ra_bill -> map invoices back to their RA bill.
  // Child-doctype listing needs `parent` in the query string (see payments.tsx).
  const piLinks = useChildTable<any>(
    "Purchase Invoice Item",
    "Purchase Invoice",
    ["name", "parent", "wo_ra_bill"],
    [["wo_ra_bill", "in", billNames], ["docstatus", "=", 1]],
    billNames.length > 0,
  );

  const piNames = Array.from(new Set((piLinks.data || []).map((r: any) => r.parent).filter(Boolean)));

  const pis = useFrappeGetDocList<PIRow>("Purchase Invoice", {
    fields: ["name", "posting_date", "bill_no", "net_total", "total_taxes_and_charges", "grand_total", "outstanding_amount", "docstatus"],
    filters: [["name", "in", piNames]],
    limit: 0,
  }, piNames.length ? `stmt-pis-${piNames.join(",")}` : null);

  const pay = usePaymentsForInvoices(piNames);

  // Advance register (mobilisation / material) — one per WO, may not exist.
  const adv = useFrappeGetDocList<WorkOrderAdvanceRegister>("Work Order Advance Register", {
    fields: ["name", "mobilization_paid", "mobilization_recovered", "mobilization_outstanding",
      "material_paid", "material_recovered", "material_outstanding",
      "total_paid", "total_recovered", "total_outstanding"],
    filters: [["civil_work_order", "=", name]],
    limit: 1,
  }, name ? `stmt-adv-${name}` : null);

  // Deduction breakdown needs the full RA bill docs (child tables are inline).
  const fullBills = useFrappeGetDocList<any>("Work Order RA Bill", {
    fields: ["name", "deductions"],
    filters: [["civil_work_order", "=", name], ["docstatus", "=", 1]],
    limit: 0,
  }, billNames.length ? `stmt-ded-${billNames.join(",")}` : null);

  const model = useMemo(() => {
    const bl = bills.data || [];
    const piList = pis.data || [];
    const piByName = new Map(piList.map((p) => [p.name, p]));

    // RA bill -> its invoices
    const raToPis = new Map<string, string[]>();
    (piLinks.data || []).forEach((r: any) => {
      if (!r.wo_ra_bill || !r.parent) return;
      const arr = raToPis.get(r.wo_ra_bill) || [];
      if (!arr.includes(r.parent)) arr.push(r.parent);
      raToPis.set(r.wo_ra_bill, arr);
    });

    // invoice -> its payments
    const piToPays = new Map<string, typeof pay.rows>();
    pay.rows.forEach((p) => {
      const arr = piToPays.get(p.invoice) || [];
      arr.push(p);
      piToPays.set(p.invoice, arr);
    });

    const contract = money(wo?.total_amount);
    const certifiedGross = bl.reduce((s, b) => s + money(b.gross_this_bill), 0);
    const certifiedNet = bl.reduce((s, b) => s + money(b.net_payable), 0);
    const totalDeductions = bl.reduce((s, b) => s + money(b.total_deductions), 0);
    const totalAdditions = bl.reduce((s, b) => s + money(b.total_additions), 0);
    const invNet = piList.reduce((s, p) => s + money(p.net_total), 0);
    const invGrand = piList.reduce((s, p) => s + money(p.grand_total), 0);
    const invOutstanding = piList.reduce((s, p) => s + money(p.outstanding_amount), 0);
    const paid = pay.totalPaid;

    // Split each invoice's tax into GST (add) vs TDS (deduct) is only on the
    // full doc; at list level total_taxes_and_charges is the net of both.
    const invTaxNet = piList.reduce((s, p) => s + money(p.total_taxes_and_charges), 0);

    // deduction breakdown by nature across all bills
    const byNature = new Map<string, number>();
    (fullBills.data || []).forEach((b: any) => {
      (b.deductions || []).forEach((d: any) => {
        if (isAddition(d.nature)) return;
        byNature.set(d.nature, (byNature.get(d.nature) || 0) + money(d.amount));
      });
    });

    const a = (adv.data || [])[0];

    // ledger events
    type Ev = { date: string; label: string; owed: number; paid: number; ref: string; to: string };
    const events: Ev[] = [];
    bl.forEach((b) => {
      events.push({ date: b.bill_date || "", label: `${b.name} certified (net)`, owed: money(b.net_payable), paid: 0, ref: b.name, to: `/ra-bills/${encodeURIComponent(b.name)}` });
    });
    piList.forEach((p) => {
      const tax = money(p.total_taxes_and_charges);
      if (Math.abs(tax) > 0.009) {
        events.push({ date: p.posting_date || "", label: `${p.name} tax (GST less TDS)`, owed: tax, paid: 0, ref: p.name, to: `/invoices/${encodeURIComponent(p.name)}` });
      }
    });
    pay.rows.forEach((p) => {
      events.push({ date: p.posting_date || "", label: `${p.payment}${p.mode_of_payment ? ` (${p.mode_of_payment})` : ""}`, owed: 0, paid: p.allocated, ref: p.payment, to: `/payments/${encodeURIComponent(p.payment)}` });
    });
    events.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    let running = 0;
    const ledger = events.map((e) => {
      running += e.owed - e.paid;
      return { ...e, running };
    });

    return {
      bl, piByName, raToPis, piToPays, contract, certifiedGross, certifiedNet,
      totalDeductions, totalAdditions, invNet, invGrand, invOutstanding, invTaxNet, paid,
      byNature, adv: a, ledger,
      balanceToCertify: contract - certifiedGross,
      pctCertified: contract > 0 ? (certifiedGross / contract) * 100 : 0,
      pctPaid: invGrand > 0 ? (paid / invGrand) * 100 : 0,
    };
  }, [wo, bills.data, pis.data, piLinks.data, pay.rows, pay.totalPaid, adv.data, fullBills.data]);

  if (isLoading) return <Loading label="Loading statement…" />;
  if (error) return <ErrorNote error={error} />;
  if (!wo) return <ErrorNote error="Work order not found." />;

  const retention = model.byNature.get("Retention") || 0;
  const mobRecovered = model.byNature.get("Mobilization Recovery") || 0;
  const matRecovered = model.byNature.get("Material Recovery") || 0;
  const cess = model.byNature.get("Labour Cess") || 0;
  const otherDed = model.totalDeductions - retention - mobRecovered - matRecovered - cess;
  const busy = bills.isLoading || pis.isLoading || pay.isLoading;

  function exportCsv() {
    const rows: any[][] = [];
    rows.push(["Work Order Statement", wo!.name]);
    rows.push(["Contractor", wo!.supplier_name || wo!.supplier || ""]);
    rows.push(["Work", wo!.work_title || ""]);
    rows.push([]);
    rows.push(["Summary", "Amount"]);
    rows.push(["Contract value (excl. GST)", model.contract]);
    rows.push(["Certified gross to date", model.certifiedGross]);
    rows.push(["Balance to certify", model.balanceToCertify]);
    rows.push(["Retention held", retention]);
    rows.push(["Mobilization recovered", mobRecovered]);
    rows.push(["Material recovered", matRecovered]);
    rows.push(["Labour cess", cess]);
    rows.push(["Other deductions", otherDed]);
    rows.push(["Additions", model.totalAdditions]);
    rows.push(["Net payable (certified)", model.certifiedNet]);
    rows.push(["Invoiced net (taxable)", model.invNet]);
    rows.push(["Invoice tax (GST less TDS)", model.invTaxNet]);
    rows.push(["Invoiced grand total", model.invGrand]);
    rows.push(["Paid to date", model.paid]);
    rows.push(["Outstanding to pay", model.invOutstanding]);
    if (model.adv) {
      rows.push([]);
      rows.push(["Advances", "Paid", "Recovered", "Outstanding"]);
      rows.push(["Mobilization", money(model.adv.mobilization_paid), money(model.adv.mobilization_recovered), money(model.adv.mobilization_outstanding)]);
      rows.push(["Material", money(model.adv.material_paid), money(model.adv.material_recovered), money(model.adv.material_outstanding)]);
    }
    rows.push([]);
    rows.push(["Cascade", "Date", "Gross", "Net / Grand", "Status"]);
    model.bl.forEach((b) => {
      rows.push([b.name, b.bill_date || "", money(b.gross_this_bill), money(b.net_payable), b.billing_status || ""]);
      (model.raToPis.get(b.name) || []).forEach((pn) => {
        const p = model.piByName.get(pn);
        rows.push([`  ${pn}`, p?.posting_date || "", money(p?.net_total), money(p?.grand_total), `outstanding ${money(p?.outstanding_amount)}`]);
        (model.piToPays.get(pn) || []).forEach((pmt) => {
          rows.push([`    ${pmt.payment}`, pmt.posting_date || "", "", pmt.allocated, pmt.mode_of_payment || ""]);
        });
      });
    });
    rows.push([]);
    rows.push(["Ledger date", "Event", "Owed +", "Paid -", "Running"]);
    model.ledger.forEach((e) => rows.push([e.date, e.label, e.owed || "", e.paid || "", e.running]));

    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${wo!.name}-statement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Link to={`/work-orders/${encodeURIComponent(name)}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> {name}
      </Link>
      <PageHead
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          Statement <Chip label={wo.supplier_name || wo.supplier || ""} />
        </span>}
        sub={<>{wo.name} · {wo.work_title || "—"}</>}
        right={
          <button onClick={exportCsv} className="btn" style={{
            display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 14px",
            borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
            color: "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>Export CSV</button>
        }
      />

      {/* stage strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 16 }}>
        <Stage label="Contract" dot="var(--iris)" fill="var(--iris)" pctWidth={100}
          value={<Money v={model.contract} dec={0} />} sub="sanctioned scope" />
        <Stage label="Certified · RA bills" dot="var(--cyan)" fill="var(--cyan)" pctWidth={model.pctCertified} strong
          value={<Money v={model.certifiedGross} dec={0} />}
          sub={`${pct(model.pctCertified)} of contract · ${model.bl.length} bill${model.bl.length === 1 ? "" : "s"}`} />
        <Stage label="Invoiced" dot="#6c7be0" fill="#6c7be0" pctWidth={model.invGrand > 0 ? 100 : 0}
          value={<Money v={model.invGrand} dec={0} />}
          sub={`incl. tax ${num(model.invTaxNet)} · ${model.piByName.size} invoice${model.piByName.size === 1 ? "" : "s"}`} />
        <Stage label="Paid" dot="var(--ok)" fill="var(--ok)" pctWidth={model.pctPaid} strong
          value={<Money v={model.paid} dec={0} />}
          sub={`${pct(model.pctPaid)} of invoiced · ${pay.rows.length} payment${pay.rows.length === 1 ? "" : "s"}`} />
      </div>

      {/* held / outstanding call-outs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
        {[
          { k: "Balance to certify", v: model.balanceToCertify, tone: "var(--text-primary)" },
          { k: "Retention held", v: retention, tone: retention > 0 ? "var(--err)" : "var(--text-primary)" },
          { k: "Advance outstanding", v: money(model.adv?.total_outstanding), tone: money(model.adv?.total_outstanding) > 0 ? "var(--err)" : "var(--text-primary)" },
          { k: "Outstanding to pay", v: model.invOutstanding, tone: model.invOutstanding > 0.009 ? "var(--err)" : "var(--ok)" },
        ].map((s) => (
          <Card key={s.k} style={{ padding: "12px 14px" }}>
            <div className="eyebrow">{s.k}</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 5, color: s.tone }}>{num(s.v)}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,.95fr)", gap: 18, alignItems: "start" }}>
        {/* cascade */}
        <Card style={{ padding: "18px 18px 12px" }}>
          <SectionTitle right={busy ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>loading…</span> : undefined}>
            The cascade
          </SectionTitle>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>
            Each RA bill, the invoice raised against it, and the payment that settled it.
          </div>
          {model.bl.length === 0 && (
            <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 13 }}>No submitted RA bills against this work order yet.</div>
          )}
          <div style={{ paddingLeft: 18 }}>
            {model.bl.map((b) => {
              const pisFor = model.raToPis.get(b.name) || [];
              return (
                <div key={b.name}>
                  <CascadeRow
                    to={`/ra-bills/${encodeURIComponent(b.name)}`} id={b.name}
                    meta={`${fmtDate(b.bill_date)} · gross ${num(b.gross_this_bill)}${money(b.total_deductions) ? ` · less ${num(b.total_deductions)}` : ""}`}
                    chip="Certified" chipTone="var(--iris)" amount={money(b.net_payable)}
                    accent="var(--iris)" indent={0}
                  />
                  {pisFor.length === 0 && (
                    <div style={{ marginLeft: 22, padding: "6px 12px", fontSize: 12, color: "var(--text-faint)" }}>Not yet invoiced</div>
                  )}
                  {pisFor.map((pn) => {
                    const p = model.piByName.get(pn);
                    const pays = model.piToPays.get(pn) || [];
                    const out = money(p?.outstanding_amount);
                    return (
                      <div key={pn}>
                        <CascadeRow
                          to={`/invoices/${encodeURIComponent(pn)}`} id={pn}
                          meta={`${fmtDate(p?.posting_date)} · net ${num(p?.net_total)} + tax ${num(p?.total_taxes_and_charges)}`}
                          chip={out > 0.009 ? "Part-paid" : "Invoiced"} chipTone="#6c7be0"
                          amount={money(p?.grand_total)} accent="#6c7be0" indent={22}
                        />
                        {pays.length === 0 && (
                          <div style={{ marginLeft: 44, padding: "6px 12px", fontSize: 12, color: "var(--text-faint)" }}>No payment yet</div>
                        )}
                        {pays.map((pmt) => (
                          <CascadeRow
                            key={pmt.payment} to={`/payments/${encodeURIComponent(pmt.payment)}`} id={pmt.payment}
                            meta={`${fmtDate(pmt.posting_date)}${pmt.mode_of_payment ? ` · ${pmt.mode_of_payment}` : ""}${pmt.reference_no ? ` · ${pmt.reference_no}` : ""}`}
                            chip={out > 0.009 ? "Part payment" : "Paid"} chipTone="var(--ok)"
                            amount={pmt.allocated} accent="var(--ok)" indent={44}
                          />
                        ))}
                        {out > 0.009 && (
                          <div style={{ marginLeft: 44, padding: "4px 12px 8px", fontSize: 12, color: "var(--err)" }}>
                            Outstanding on this invoice <span className="mono" style={{ fontWeight: 600 }}>{num(out)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {model.bl.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", padding: "10px 2px 0", borderTop: "1px dashed var(--border-strong)", marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
              <span>Certified <b className="mono" style={{ color: "var(--text-primary)" }}>{num(model.certifiedNet)}</b> · Invoiced <b className="mono" style={{ color: "var(--text-primary)" }}>{num(model.invGrand)}</b> · Paid <b className="mono" style={{ color: "var(--ok)" }}>{num(model.paid)}</b></span>
              <Chip label={model.invOutstanding > 0.009 ? "Part settled" : "Fully settled"} />
            </div>
          )}
        </Card>

        {/* statement + ledger */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Card style={{ padding: 18 }}>
            <SectionTitle>Statement</SectionTitle>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
              Contract down to cash — retention and advances as their own lines.
            </div>
            <Line label="Contract value" sub="excl. GST" value={num(model.contract)} />
            <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Progress</div>
            <Line label="Certified to date" sub={`${model.bl.length} RA bill${model.bl.length === 1 ? "" : "s"}`} value={num(model.certifiedGross)} tone="var(--cyan)" />
            <Line label="Balance to certify" sub={pct(100 - model.pctCertified)} value={num(model.balanceToCertify)} />
            <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Site deductions (held back)</div>
            <Line label="Retention held" value={num(retention)} tone={retention > 0 ? "var(--err)" : undefined} />
            <Line label="Mobilisation recovered" value={num(mobRecovered)} tone={mobRecovered > 0 ? "var(--err)" : undefined} />
            <Line label="Material recovered" value={num(matRecovered)} tone={matRecovered > 0 ? "var(--err)" : undefined} />
            <Line label="Labour cess" value={num(cess)} tone={cess > 0 ? "var(--err)" : undefined} />
            {Math.abs(otherDed) > 0.009 && <Line label="Other deductions" value={num(otherDed)} tone="var(--err)" />}
            {model.totalAdditions > 0.009 && <Line label="Additions" value={num(model.totalAdditions)} tone="var(--ok)" />}
            <Line label="Net payable (certified)" value={num(model.certifiedNet)} strong top />
            <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Invoicing</div>
            <Line label="Net taxable invoiced" value={num(model.invNet)} />
            <Line label="Tax on invoices" sub="GST less TDS" value={num(model.invTaxNet)} tone="var(--cyan)" />
            <Line label="Invoiced grand total" value={num(model.invGrand)} strong top />
            <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Settlement</div>
            <Line label="Paid to date" sub={`${pay.rows.length} payment${pay.rows.length === 1 ? "" : "s"}`} value={num(model.paid)} tone="var(--ok)" />
            <Line label="Outstanding to pay" value={inr(model.invOutstanding)} strong top
              tone={model.invOutstanding > 0.009 ? "var(--err)" : "var(--ok)"} />
          </Card>

          {(model.adv || retention > 0) && (
            <Card style={{ padding: 18 }}>
              <SectionTitle>Retention &amp; advances</SectionTitle>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
                Money held back or advanced against this work order.
              </div>
              <Line label="Retention held to date" value={num(retention)} sub={wo.retention_percentage ? `@ ${pct(wo.retention_percentage)}` : undefined} />
              {model.adv ? (
                <>
                  <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Mobilisation</div>
                  <Line label="Advance paid" value={num(model.adv.mobilization_paid)} />
                  <Line label="Recovered" value={num(model.adv.mobilization_recovered)} tone="var(--ok)" />
                  <Line label="Outstanding" value={num(model.adv.mobilization_outstanding)} strong
                    tone={money(model.adv.mobilization_outstanding) > 0 ? "var(--err)" : undefined} />
                  <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>Material</div>
                  <Line label="Advance paid" value={num(model.adv.material_paid)} />
                  <Line label="Recovered" value={num(model.adv.material_recovered)} tone="var(--ok)" />
                  <Line label="Outstanding" value={num(model.adv.material_outstanding)} strong
                    tone={money(model.adv.material_outstanding) > 0 ? "var(--err)" : undefined} />
                </>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
                  No advance register for this work order — no mobilisation or material advance has been paid.
                </div>
              )}
            </Card>
          )}

          <Card style={{ padding: "18px 0 6px" }}>
            <div style={{ padding: "0 18px" }}>
              <SectionTitle>Transaction ledger</SectionTitle>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
                Every money event, chronological, with the running amount owed.
              </div>
            </div>
            {model.ledger.length ? (
              <div className="scroll-x">
                <table style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>{["Date", "Event", "Owed +", "Paid −", "Running"].map((h, i) => (
                      <th key={i} style={{ textAlign: i > 1 ? "right" : "left", padding: "9px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {model.ledger.map((e, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                        <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
                          <Link to={e.to} style={{ color: "var(--text-secondary)" }}>{e.label}</Link>
                        </td>
                        <td className="mono" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right" }}>{e.owed ? num(e.owed) : "—"}</td>
                        <td className="mono" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right", color: e.paid ? "var(--ok)" : undefined }}>{e.paid ? num(e.paid) : "—"}</td>
                        <td className="mono" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right", fontWeight: 600, color: Math.abs(e.running) < 0.009 ? "var(--ok)" : "var(--text-primary)" }}>{num(e.running)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>No transactions yet.</div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
