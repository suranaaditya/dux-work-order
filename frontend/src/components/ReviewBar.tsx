/* Claim-review action bar for RA bills.
 *
 * Claim review is opt-in per company, so this renders NOTHING for a company
 * that hasn't enabled it — those bills keep the plain Submit button they
 * always had. The available actions come from the server (role-checked
 * there), never from a client-side guess.
 */
import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Btn } from "./ui";
import type { ReviewAction, ReviewStatus } from "../lib/types";

const BASE = "dux_civil_works.dux_work_orders.doctype.work_order_ra_bill.work_order_ra_bill";
export const REVIEW_STATE_METHOD = `${BASE}.get_review_state`;
export const REVIEW_APPLY_METHOD = `${BASE}.apply_review_action`;

/** Live review status for one RA bill. */
export function useReviewStatus(raBill: string) {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: ReviewStatus }>(
    REVIEW_STATE_METHOD,
    { ra_bill: raBill },
    raBill ? `review-${raBill}` : undefined,
  );
  return { status: data?.message, isLoading, error, mutate };
}

/** Which actions need a reason typed in before they fire. */
const NEEDS_REASON: Record<string, string> = {
  return_for_revision: "Tell the contractor what needs fixing",
  reject: "Reason for rejecting this claim",
};

const TONE: Record<string, "primary" | "danger" | "ghost"> = {
  approve: "primary",
  submit_for_review: "primary",
  reject: "danger",
  return_for_revision: "ghost",
  reopen: "ghost",
};

export function ReviewBar({
  raBill,
  onChanged,
  compact,
}: {
  raBill: string;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const { status, mutate } = useReviewStatus(raBill);
  const apply = useFrappePostCall(REVIEW_APPLY_METHOD);
  const [pending, setPending] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!status?.review_enabled) return null;
  const actions = status.actions || [];
  if (!actions.length) return null;

  async function run(action: ReviewAction, comment?: string) {
    setErr(null);
    try {
      await apply.call({ ra_bill: raBill, action: action.action, comment: comment || undefined });
      setPending(null);
      setReason("");
      mutate();
      onChanged?.();
    } catch (e: any) {
      setErr(serverMessage(e));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {actions.map((a) => (
          <Btn
            key={a.action}
            variant={TONE[a.action] === "primary" ? "primary" : "ghost"}
            onClick={() => (NEEDS_REASON[a.action] ? setPending(a) : run(a))}
            disabled={apply.loading}
            style={TONE[a.action] === "danger" ? { color: "var(--err)", borderColor: "var(--err)" } : undefined}
          >
            {apply.loading ? "Working…" : a.label}
          </Btn>
        ))}
      </div>

      {pending && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={NEEDS_REASON[pending.action]}
            style={{
              height: 34, minWidth: compact ? 200 : 300, padding: "0 11px", borderRadius: 8,
              border: "1px solid var(--border-strong)", background: "var(--bg-surface)",
              color: "var(--text-primary)", fontSize: 13,
            }}
          />
          <Btn variant="primary" onClick={() => run(pending, reason)} disabled={!reason.trim() || apply.loading}>
            Confirm
          </Btn>
          <Btn onClick={() => { setPending(null); setReason(""); }}>Cancel</Btn>
        </div>
      )}

      {err && <span style={{ fontSize: 12, color: "var(--err)", maxWidth: 420, textAlign: "right" }}>{err}</span>}
    </div>
  );
}

/** Frappe hides the real reason in _server_messages; surface it. */
export function serverMessage(e: any): string {
  const raw = e?._server_messages || e?.response?.data?._server_messages;
  if (raw) {
    try {
      const msgs = JSON.parse(raw).map((s: any) => {
        try { return JSON.parse(s).message; } catch { return String(s); }
      });
      const joined = msgs.filter(Boolean).join("\n");
      if (joined) return stripTags(joined);
    } catch { /* fall through */ }
  }
  return stripTags(e?.exception || e?.message || "Something went wrong.");
}

const stripTags = (s: string) => String(s).replace(/<[^>]*>/g, "");
