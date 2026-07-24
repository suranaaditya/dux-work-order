import { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";
import { Icon } from "./icons";

type NavItem = { to: string; label: string; icon: string; soon?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/work-orders", label: "Work Orders", icon: "doc" },
  { to: "/ra-bills", label: "RA Bills", icon: "bill" },
  { to: "/suppliers", label: "Suppliers", icon: "users", soon: true },
  { to: "/measurement-book", label: "Measurement Book", icon: "ruler", soon: true },
  { to: "/payments", label: "Payments", icon: "rupee", soon: true },
  { to: "/reports", label: "Reports", icon: "report", soon: true },
];

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px 18px" }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: "linear-gradient(150deg, var(--iris), var(--cyan))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: 15,
          boxShadow: "var(--shadow-brand)",
        }}
      >
        S
      </div>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>SiteBill</div>
        <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Work Orders & Billing</div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside
      style={{
        width: 232,
        flex: "0 0 232px",
        borderRight: "1px solid var(--border-subtle)",
        background: "var(--bg-card)",
        padding: "22px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      <Brand />
      {NAV.map((n) => {
        const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
        const common: React.CSSProperties = {
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "10px 12px",
          borderRadius: 10,
          fontSize: 13.5,
          fontWeight: active ? 600 : 450,
          color: n.soon
            ? "var(--text-faint)"
            : active
              ? "var(--iris)"
              : "var(--text-secondary)",
          background: active ? "var(--iris-tint)" : "transparent",
          cursor: n.soon ? "default" : "pointer",
          transition: "all .15s ease",
        };
        const inner = (
          <>
            <Icon name={n.icon} size={18} color={active && !n.soon ? "var(--iris)" : "var(--text-muted)"} />
            <span style={{ flex: 1 }}>{n.label}</span>
            {n.soon && (
              <span style={{ fontSize: 9, color: "var(--text-faint)", fontWeight: 600, letterSpacing: ".04em" }}>
                SOON
              </span>
            )}
          </>
        );
        return n.soon ? (
          <div key={n.to} style={common}>
            {inner}
          </div>
        ) : (
          <NavLink key={n.to} to={n.to} style={common}>
            {inner}
          </NavLink>
        );
      })}
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 10, color: "var(--text-faint)", padding: "0 6px" }}>
        dux_civil_works · slice 1
      </div>
    </aside>
  );
}

function Topbar() {
  const { currentUser } = useFrappeAuth();
  return (
    <header
      style={{
        height: 58,
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-card)",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 14,
        padding: "0 clamp(16px,3vw,34px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--iris-tint)",
            color: "var(--iris)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {(currentUser || "?").slice(0, 1).toUpperCase()}
        </div>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{currentUser || "Guest"}</span>
      </div>
    </header>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Topbar />
        <main
          style={{
            flex: 1,
            padding: "26px clamp(16px,3vw,34px)",
            maxWidth: 1360,
            width: "100%",
            margin: "0 auto",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
