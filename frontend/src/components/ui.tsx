import { CSSProperties, ReactNode } from "react";
import { inr, num } from "../lib/format";

/* ---------- status tone ---------- */
type Tone = "ok" | "pending" | "err" | "info" | "neutral";

const TONE_STYLE: Record<Tone, { c: string; bg: string }> = {
  ok: { c: "var(--ok)", bg: "var(--ok-bg)" },
  pending: { c: "var(--pending)", bg: "var(--pending-bg)" },
  err: { c: "var(--err)", bg: "var(--err-bg)" },
  info: { c: "var(--iris)", bg: "var(--iris-tint)" },
  neutral: { c: "var(--text-secondary)", bg: "var(--bg-sunken)" },
};

const STATUS_TONE: Record<string, Tone> = {
  // docstatus / generic
  Draft: "neutral",
  Submitted: "info",
  Cancelled: "err",
  // WO workflow
  Pending: "neutral",
  "Pending Verification": "pending",
  "L1 Approval Pending": "pending",
  "L2 Approval Pending": "pending",
  Approved: "ok",
  Rejected: "err",
  // RA Bill billing_status
  "Pending Approval": "pending",
  "Partially Invoiced": "pending",
  "Fully Invoiced": "ok",
  Closed: "neutral",
  // payments
  Paid: "ok",
  "Part Paid": "pending",
  Unpaid: "err",
};

export function Chip({ label }: { label?: string }) {
  if (!label) return null;
  const tone = STATUS_TONE[label] ?? "neutral";
  const t = TONE_STYLE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        padding: "4px 10px",
        borderRadius: "var(--r-pill)",
        whiteSpace: "nowrap",
        color: t.c,
        background: t.bg,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
      {label}
    </span>
  );
}

/* ---------- card ---------- */
export function Card({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: CSSProperties;
  accent?: boolean;
}) {
  return (
    <div
      className={accent ? "accent-top" : undefined}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-card)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        margin: "0 0 12px",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
        {children}
      </h3>
      {right}
    </div>
  );
}

/* ---------- buttons ---------- */
type BtnVariant = "primary" | "secondary" | "ghost";
export function Btn({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 38,
    padding: "8px 15px",
    fontSize: 13,
    fontWeight: 500,
    borderRadius: "var(--r-pill)",
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    transition: "all .18s var(--spring)",
    whiteSpace: "nowrap",
    opacity: disabled ? 0.45 : 1,
  };
  const variants: Record<BtnVariant, CSSProperties> = {
    primary: {
      color: "#fff",
      background: "linear-gradient(150deg, var(--iris), var(--iris-deep))",
      boxShadow: "var(--shadow-brand)",
    },
    secondary: {
      color: "var(--text-primary)",
      background: "var(--bg-surface)",
      borderColor: "var(--border-strong)",
      boxShadow: "var(--inset-hi)",
    },
    ghost: { color: "var(--text-secondary)", background: "transparent" },
  };
  return (
    <button type={type} onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

/* ---------- numeric display ---------- */
export function Money({ v, dec = 2, strong }: { v: unknown; dec?: number; strong?: boolean }) {
  return (
    <span className="mono" style={{ color: "var(--cyan)", fontWeight: strong ? 700 : 500 }}>
      {inr(v, dec)}
    </span>
  );
}

export function Num({ v, dec = 2 }: { v: unknown; dec?: number }) {
  return (
    <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
      {num(v, dec)}
    </span>
  );
}

/* ---------- KPI tile ---------- */
export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card accent={accent} style={{ padding: "16px 18px" }}>
      <Eyebrow>{label}</Eyebrow>
      <div
        className="mono"
        style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "var(--text-primary)" }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/* ---------- key/value row ---------- */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{children ?? "—"}</span>
    </div>
  );
}

/* ---------- loading / error / empty ---------- */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, color: "var(--text-muted)" }}>
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg =
    (error as { message?: string })?.message ||
    (typeof error === "string" ? error : "Something went wrong.");
  return (
    <Card style={{ padding: 20, borderColor: "var(--err-bg)" }}>
      <div style={{ color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>Couldn’t load data</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{msg}</div>
    </Card>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      {label}
    </div>
  );
}

/* ---------- page header ---------- */
export function PageHead({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 22,
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h1>
        {sub && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 5 }}>{sub}</div>}
      </div>
      {right && <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{right}</div>}
    </div>
  );
}

/* ---------- simple table ---------- */
export type Col<T> = {
  head: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: number | string;
};

export function Table<T>({
  cols,
  rows,
  onRowClick,
  rowKey,
}: {
  cols: Col<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  rowKey: (row: T, i: number) => string;
}) {
  return (
    <div className="scroll-x">
      <table style={{ fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: c.align || "left",
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  borderBottom: "1px solid var(--border-subtle)",
                  whiteSpace: "nowrap",
                  width: c.width,
                }}
              >
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? "pointer" : "default" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--row-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {cols.map((c, j) => (
                <td
                  key={j}
                  style={{
                    textAlign: c.align || "left",
                    padding: "11px 14px",
                    borderBottom: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
