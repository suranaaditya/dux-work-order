import { useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Btn } from "./ui";

type Transition = { action: string; next_state: string; allowed?: string };

const unwrap = (r: any): Transition[] =>
  Array.isArray(r) ? r : Array.isArray(r?.message) ? r.message : [];

/**
 * Renders the workflow transitions available to the current user for a doc,
 * and applies them via Frappe's standard whitelisted workflow methods.
 */
export function WorkflowBar({ doc, onChanged }: { doc: any; onChanged: () => void }) {
  const getTransitions = useFrappePostCall("frappe.model.workflow.get_transitions");
  const applyWorkflow = useFrappePostCall("frappe.model.workflow.apply_workflow");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (doc?.name && doc?.workflow_state) getTransitions.call({ doc }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.name, doc?.workflow_state]);

  if (!doc?.workflow_state) return null;
  const list = unwrap(getTransitions.result);

  async function apply(action: string) {
    setErr(null);
    try {
      await applyWorkflow.call({ doc, action });
      onChanged();
    } catch (e: any) {
      setErr(e?.message || "Could not apply the action.");
    }
  }

  if (!list.length && !err) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {list.map((t) => (
          <Btn
            key={t.action}
            variant={/reject|cancel/i.test(t.action) ? "secondary" : "primary"}
            onClick={() => apply(t.action)}
            disabled={applyWorkflow.loading}
          >
            {t.action}
          </Btn>
        ))}
      </div>
      {err && <span style={{ fontSize: 12, color: "var(--err)" }}>{err}</span>}
    </div>
  );
}
