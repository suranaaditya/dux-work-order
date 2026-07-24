import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFrappeCreateDoc, useFrappePostCall } from "frappe-react-sdk";
import { Card, PageHead, SectionTitle, Btn, Money, ErrorNote, Loading, KV } from "../components/ui";
import { Icon } from "../components/icons";
import { Field, TextInput, DateInput, NumberInput, LinkField } from "../components/form";

const PE_METHOD = "erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const n = (s: any) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

export default function RecordPayment() {
  const { name = "" } = useParams();
  const nav = useNavigate();
  const getPE = useFrappePostCall(PE_METHOD);
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const [base, setBase] = useState<any>(null);
  const [f, setF] = useState({ paid_amount: "", mode_of_payment: "", paid_from: "", reference_no: "", reference_date: todayISO() });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    getPE
      .call({ dt: "Purchase Invoice", dn: name })
      .then((r: any) => {
        const pe = r?.message ?? r;
        setBase(pe);
        setF({
          paid_amount: String(pe.paid_amount || pe.received_amount || ""),
          mode_of_payment: pe.mode_of_payment || "",
          paid_from: pe.paid_from || "",
          reference_no: "",
          reference_date: todayISO(),
        });
      })
      .catch((e: any) => setErr(e?.message || "Could not prepare the payment."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (getPE.loading && !base) return <Loading label="Preparing payment…" />;
  if (err && !base) return <ErrorNote error={err} />;
  if (!base) return <Loading label="Preparing payment…" />;

  const company = base.company;
  const supplier = base.party;
  const outstanding = n(base.references?.[0]?.outstanding_amount ?? base.paid_amount);
  const setForm = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    setErr(null);
    try {
      const amt = n(f.paid_amount);
      const doc: any = {
        ...base,
        doctype: "Payment Entry",
        posting_date: f.reference_date,
        mode_of_payment: f.mode_of_payment || undefined,
        paid_from: f.paid_from || base.paid_from,
        paid_amount: amt,
        received_amount: amt,
        reference_no: f.reference_no || undefined,
        reference_date: f.reference_no ? f.reference_date : undefined,
      };
      // allocate the paid amount to the invoice reference
      if (doc.references?.length) {
        doc.references = doc.references.map((r: any, i: number) => ({ ...r, allocated_amount: i === 0 ? amt : 0 }));
      }
      const created = await createDoc("Payment Entry", doc);
      nav(`/payments/${encodeURIComponent(created.name)}`);
    } catch (e: any) {
      const m = e?.message || e?._server_messages || e?.exception || "Could not create the payment.";
      setErr(typeof m === "string" ? m : JSON.stringify(m));
    }
  }

  return (
    <>
      <Link to={`/invoices/${encodeURIComponent(name)}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <Icon name="arrowLeft" size={15} /> {name}
      </Link>
      <PageHead title="Record Payment" sub={`Payment Entry to ${supplier} against ${name}`} />

      <Card style={{ padding: 18, marginBottom: 18 }}>
        <SectionTitle>Against invoice</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
          <KV label="Supplier">{supplier}</KV>
          <KV label="Company">{company}</KV>
          <KV label="Invoice">{name}</KV>
          <KV label="Outstanding"><Money v={outstanding} dec={0} /></KV>
        </div>
      </Card>

      <Card style={{ padding: 20, marginBottom: 18 }}>
        <SectionTitle>Payment</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          <Field label="Paid amount" required>
            <NumberInput value={f.paid_amount} onChange={(v) => setForm("paid_amount", v)} align="right" />
          </Field>
          <Field label="Paid from (bank / cash)" required hint="Account the money is paid from">
            <LinkField doctype="Account" value={f.paid_from} onChange={(v) => setForm("paid_from", v)} placeholder="Bank / cash account" extraFilters={[["company", "=", company], ["is_group", "=", 0], ["account_type", "in", ["Bank", "Cash"]]]} />
          </Field>
          <Field label="Mode of payment">
            <LinkField doctype="Mode of Payment" value={f.mode_of_payment} onChange={(v) => setForm("mode_of_payment", v)} placeholder="NEFT / Cheque / Cash" />
          </Field>
          <Field label="Reference no (UTR / cheque)">
            <TextInput value={f.reference_no} onChange={(v) => setForm("reference_no", v)} placeholder="e.g. UTR / cheque no" />
          </Field>
          <Field label="Reference date">
            <DateInput value={f.reference_date} onChange={(v) => setForm("reference_date", v)} />
          </Field>
        </div>
      </Card>

      {err && (
        <Card style={{ padding: 16, marginBottom: 18, borderColor: "var(--err-bg)" }}>
          <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>Could not record payment</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{err}</div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        <Btn variant="primary" onClick={submit} disabled={creating || !n(f.paid_amount) || !f.paid_from}>
          {creating ? "Recording…" : "Record Payment (Draft)"}
        </Btn>
      </div>
    </>
  );
}
