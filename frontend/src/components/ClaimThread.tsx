/* The conversation on a claim.
 *
 * One thread per claim rather than a chat window: the reason a quantity was
 * cut stays next to the claim it affected, and reads back as evidence months
 * later. Messages and the system's own events share one timeline, so the
 * history is continuous.
 *
 * Used by BOTH sides — the contractor portal and the staff review screen —
 * with only the accent colour differing, because it is the same conversation.
 */
import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Card, SectionTitle } from "./ui";
import { serverMessage } from "./ReviewBar";

const BASE = "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill";
const GET = `${BASE}.get_claim_thread`;
const POST = `${BASE}.post_claim_comment`;

export interface ThreadEntry {
  name: string;
  kind: "message" | "event";
  text: string;
  by: string;
  by_name: string;
  side: "contractor" | "client";
  at: string;
}

const initials = (s: string) =>
  (s || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** "25 Jul, 4:10 pm" — a site engineer reads this, not an ISO string. */
function when(iso: string) {
  const d = new Date((iso || "").replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

export function ClaimThread({ raBill, accent = "var(--iris)" }: { raBill: string; accent?: string }) {
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: ThreadEntry[] }>(
    GET, { ra_bill: raBill }, raBill ? `thread-${raBill}` : undefined,
  );
  const post = useFrappePostCall(POST);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const entries = data?.message || [];

  async function send() {
    const body = text.trim();
    if (!body) return;
    setErr(null);
    try {
      await post.call({ ra_bill: raBill, text: body });
      setText("");
      mutate();
    } catch (e: any) {
      setErr(serverMessage(e));
    }
  }

  return (
    <Card style={{ padding: 18 }}>
      <SectionTitle right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {entries.filter((e) => e.kind === "message").length} message{entries.filter((e) => e.kind === "message").length === 1 ? "" : "s"}
      </span>}>
        Conversation
      </SectionTitle>

      {isLoading && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>}

      {!isLoading && entries.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "6px 0 12px" }}>
          Nothing yet. Ask a question or explain a quantity here — it stays attached to this claim.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {entries.map((e) =>
          e.kind === "event" ? (
            <div key={e.name} style={{
              display: "flex", gap: 9, alignItems: "baseline", fontSize: 12,
              color: "var(--text-muted)", padding: "3px 0 3px 38px",
            }}>
              <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{e.by_name}</span>
              <span>{e.text}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{when(e.at)}</span>
            </div>
          ) : (
            <div key={e.name} style={{ display: "flex", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flex: "none", display: "grid", placeItems: "center",
                color: "#fff", fontSize: 10.5, fontWeight: 800,
                background: e.side === "contractor" ? "#c96a10" : accent,
              }}>{initials(e.by_name)}</div>
              <div style={{
                flex: 1, border: "1px solid var(--border-subtle)", borderRadius: 10,
                padding: "8px 12px", background: "var(--bg-surface)",
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 3 }}>
                  <b style={{ fontSize: 12.5 }}>{e.by_name}</b>
                  <span style={{
                    fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase",
                    padding: "1px 6px", borderRadius: 999,
                    background: e.side === "contractor" ? "rgba(201,106,16,.12)" : "var(--iris-tint)",
                    color: e.side === "contractor" ? "#c96a10" : accent,
                  }}>{e.side === "contractor" ? "Contractor" : "Client"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>{when(e.at)}</span>
                </div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{e.text}</div>
              </div>
            </div>
          ),
        )}
      </div>

      <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) send(); }}
          placeholder="Write a message…"
          rows={2}
          style={{
            flex: 1, padding: "9px 12px", borderRadius: 9, resize: "vertical",
            border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
            color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
        <button onClick={send} disabled={!text.trim() || post.loading} style={{
          background: (!text.trim() || post.loading) ? "var(--border-strong)" : accent,
          color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px",
          fontSize: 13, fontWeight: 650, cursor: text.trim() ? "pointer" : "not-allowed",
        }}>{post.loading ? "Sending…" : "Send"}</button>
      </div>
      {err && <div style={{ fontSize: 12, color: "var(--err)", marginTop: 8 }}>{err}</div>}
    </Card>
  );
}
