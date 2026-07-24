import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Icon } from "./icons";

const inputStyle: CSSProperties = {
  height: 40,
  width: "100%",
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: 14,
  outline: "none",
};

export function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
        {label}
        {required && <span style={{ color: "var(--err)", marginLeft: 3 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
  );
}

export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  suffix,
  align = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  align?: "left" | "right";
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, textAlign: align, fontFamily: "var(--font-mono)", paddingRight: suffix ? 30 : 12 }}
      />
      {suffix && (
        <span style={{ position: "absolute", right: 10, top: 11, fontSize: 12, color: "var(--text-muted)" }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{ ...inputStyle, height: "auto", padding: "10px 12px", lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }}
    />
  );
}

/* ERPNext-style searchable Link field backed by /api/resource. */
export function LinkField({
  doctype,
  value,
  onChange,
  placeholder = "Select…",
  extraFilters = [],
  displayField,
  height = 40,
}: {
  doctype: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  extraFilters?: any[];
  displayField?: string;
  height?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // debounce the query
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  // close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const filters = [...extraFilters];
  if (dq) filters.push(["name", "like", `%${dq}%`]);
  const fields = ["name", ...(displayField ? [displayField] : [])];
  const { data } = useFrappeGetDocList(doctype, { fields, filters, limit: 12, orderBy: { field: "modified", order: "desc" } }, open ? undefined : null);

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height,
          padding: "0 12px",
          borderRadius: 10,
          border: "1px solid " + (open ? "var(--iris)" : "var(--border-strong)"),
          background: "var(--bg-surface)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
          boxShadow: open ? "0 0 0 3px var(--iris-tint)" : "none",
        }}
      >
        <span style={{ color: "var(--text-faint)", display: "flex" }}>
          <Icon name="search" size={15} />
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || placeholder}
        </span>
        <Icon name="chevron" size={14} color="var(--text-muted)" sw={2} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: height + 6,
            left: 0,
            right: 0,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 12,
            boxShadow: "var(--shadow-pop)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid var(--border-subtle)" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${doctype}…`}
              style={{ ...inputStyle, height: 34, fontSize: 13 }}
            />
          </div>
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {(data || []).length ? (
              (data || []).map((o: any, i: number) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => {
                    onChange(o.name);
                    setOpen(false);
                    setQ("");
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    width: "100%",
                    padding: "9px 12px",
                    border: "none",
                    borderTop: i ? "1px solid var(--border-subtle)" : "none",
                    background: o.name === value ? "var(--iris-tint)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--row-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = o.name === value ? "var(--iris-tint)" : "transparent")}
                >
                  <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{o.name}</span>
                  {displayField && o[displayField] && o[displayField] !== o.name && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{o[displayField]}</span>
                  )}
                </button>
              ))
            ) : (
              <div style={{ padding: "14px 12px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
                No matches
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
