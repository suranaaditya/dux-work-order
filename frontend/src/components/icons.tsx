// Thin-stroke line icons (1.7 width) — DUX icon style. No emoji, no fills.
const P: Record<string, string> = {
  dashboard: "M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-4H4z",
  doc: "M6 2h8l4 4v16H6zM14 2v4h4",
  bill: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11",
  ruler: "M3 8l5-5 13 13-5 5zM7 7l2 2M11 5l2 2M9 13l2 2M13 11l2 2",
  rupee: "M7 4h10M7 8h10M13 4c3 0 3 8-3 8H7l7 8",
  report: "M4 4v16h16M8 16V10M12 16V6M16 16v-4",
  building: "M6 21V3h12v18M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1",
  chevron: "M9 6l6 6-6 6",
  arrowLeft: "M15 18l-6-6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
};

export function Icon({
  name,
  size = 18,
  color = "currentColor",
  sw = 1.7,
}: {
  name: keyof typeof P | string;
  size?: number;
  color?: string;
  sw?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "0 0 auto" }}
    >
      <path d={P[name] || P.doc} />
    </svg>
  );
}
