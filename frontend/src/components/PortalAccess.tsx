/* Give a contractor access to the portal.
 *
 * We never set or see a password: Frappe emails them a link and they choose
 * their own. Their email address IS their username.
 */
import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Btn, Card, SectionTitle } from "./ui";
import { serverMessage } from "./ReviewBar";
import { fmtDate } from "../lib/format";

const B = "dux_civil_works.dux_work_orders.api.portal";
const LIST = `${B}.list_portal_users`;
const GRANT = `${B}.grant_portal_access`;
const REVOKE = `${B}.revoke_portal_access`;
const TOGGLE = `${B}.set_portal_user_enabled`;
const INVITE = `${B}.send_portal_invite`;

interface PortalUser {
  name: string;
  full_name?: string;
  enabled?: 0 | 1;
  last_login?: string;
  never_signed_in?: boolean;
  has_portal_role?: boolean;
}

const inputStyle: React.CSSProperties = {
  height: 38, width: "100%", padding: "0 11px", borderRadius: 9,
  border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
  color: "var(--text-primary)", fontSize: 13.5,
};

export function PortalAccess({ supplier }: { supplier: string }) {
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: PortalUser[] }>(
    LIST, { supplier }, supplier ? `portal-users-${supplier}` : undefined,
  );
  const grant = useFrappePostCall(GRANT);
  const revoke = useFrappePostCall(REVOKE);
  const toggle = useFrappePostCall(TOGGLE);
  const invite = useFrappePostCall(INVITE);

  const [adding, setAdding] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const users = data?.message || [];

  async function add() {
    setErr(null); setNote(null);
    try {
      const r: any = await grant.call({ supplier, email: email.trim(), full_name: fullName.trim(), send_invite: 1 });
      const m = r?.message || r;
      setNote(m?.created
        ? `Access granted. An email with a link to set their own password has gone to ${m.user}.`
        : `${m.user} already had a login — it now also covers this supplier.`);
      setEmail(""); setFullName(""); setAdding(false);
      mutate();
    } catch (e: any) { setErr(serverMessage(e)); }
  }

  async function act(fn: () => Promise<any>, msg?: string) {
    setErr(null); setNote(null); setLink(null);
    try { await fn(); if (msg) setNote(msg); mutate(); }
    catch (e: any) { setErr(serverMessage(e)); }
  }

  return (
    <Card style={{ padding: 18 }}>
      <SectionTitle right={
        !adding ? <Btn onClick={() => { setAdding(true); setErr(null); setNote(null); }}>Give portal access</Btn> : undefined
      }>
        Portal access
      </SectionTitle>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: -4, marginBottom: 12, maxWidth: "70ch" }}>
        People here can sign in to the contractor portal and see only this supplier&rsquo;s work orders,
        raise claims and upload invoices. Their email address is their username; they set their own
        password from a link we email them.
      </div>

      {adding && (
        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 11, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Their name</div>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Rakesh Kumar" style={inputStyle} />
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Their email (this is the username)</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rakesh@contractor.co.in" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginRight: "auto" }}>
              We email them a link to set their own password — no password is set here.
            </span>
            <Btn onClick={() => { setAdding(false); setErr(null); }}>Cancel</Btn>
            <Btn variant="primary" onClick={add} disabled={!email.trim() || grant.loading}>
              {grant.loading ? "Granting…" : "Grant access & send invite"}
            </Btn>
          </div>
        </div>
      )}

      {isLoading && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>}

      {!isLoading && users.length === 0 && !adding && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "4px 0 6px" }}>
          Nobody from this contractor can sign in yet.
        </div>
      )}

      {users.length > 0 && (
        <div className="scroll-x">
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>{["Person", "Username (email)", "Status", "Last signed in", ""].map((h, i) => (
                <th key={i} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted)",
                  borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.name}>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600 }}>
                    {u.full_name || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className="mono" style={{ fontSize: 12 }}>{u.name}</span>
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
                    {!u.enabled ? <span style={{ color: "var(--err)", fontWeight: 600, fontSize: 12 }}>Suspended</span>
                      : u.never_signed_in ? <span style={{ color: "var(--warn, #c96a10)", fontWeight: 600, fontSize: 12 }}>Invited</span>
                      : <span style={{ color: "var(--ok)", fontWeight: 600, fontSize: 12 }}>Active</span>}
                    {!u.has_portal_role && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--err)" }}>no portal role</span>}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {u.last_login ? fmtDate(u.last_login) : "never"}
                    </span>
                  </td>
                  <td style={{ padding: "6px 12px", borderBottom: "1px solid var(--border-subtle)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => act(() => invite.call({ user: u.name, return_link: 0 }),
                        `A fresh set-password link has been emailed to ${u.name}.`)}
                      style={linkBtn}>Resend invite</button>
                    <button onClick={async () => {
                        setErr(null); setNote(null);
                        try {
                          const r: any = await invite.call({ user: u.name, return_link: 1 });
                          setLink((r?.message || r)?.link || null);
                        } catch (e: any) { setErr(serverMessage(e)); }
                      }} style={linkBtn}>Copy link</button>
                    <button onClick={() => act(() => toggle.call({ user: u.name, enabled: u.enabled ? 0 : 1 }),
                        u.enabled ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`)}
                      style={linkBtn}>{u.enabled ? "Suspend" : "Restore"}</button>
                    <button onClick={() => {
                        if (!window.confirm(`Remove ${u.name}'s access to ${supplier}? They will be signed out immediately.`)) return;
                        act(() => revoke.call({ supplier, user: u.name, disable_login: 1 }), `${u.name} no longer has access.`);
                      }} style={{ ...linkBtn, color: "var(--err)" }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {link && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 9, background: "var(--bg-sunken)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 5 }}>
            Single-use invite link — send it to them directly (WhatsApp, SMS). It expires, and anyone holding it can set their password, so treat it like one.
          </div>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
            style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 11.5 }} />
        </div>
      )}

      {note && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--ok)" }}>{note}</div>}
      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--err)", whiteSpace: "pre-wrap" }}>{err}</div>}
    </Card>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", padding: "4px 7px",
  fontSize: 12, color: "var(--iris)", fontWeight: 600,
};
