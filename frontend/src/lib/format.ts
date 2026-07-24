// Indian-system number + date formatting, ported from the SiteBill prototype.

const toNum = (n: unknown): number => {
  const v = typeof n === "string" ? parseFloat(n) : (n as number);
  return Number.isFinite(v) ? (v as number) : 0;
};

const inrFmt = (dec: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

const numFmt = (dec: number) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

/** ₹1,28,93,103.00 — Indian grouping with rupee symbol. */
export const inr = (n: unknown, dec = 2): string => inrFmt(dec).format(toNum(n));

/** 1,28,93,103.00 — Indian grouping, no symbol (for tabular numeric cells). */
export const num = (n: unknown, dec = 2): string => numFmt(dec).format(toNum(n));

/** 4.02 Cr / 76.98 L / 8,400 — short Indian magnitude forms for KPI tiles. */
export const inrShort = (n: unknown): string => {
  const v = toNum(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${numFmt(0).format(abs)}`;
};

/** 3.5 -> "3.5%" (trims trailing zeros). */
export const pct = (n: unknown): string => {
  const v = toNum(n);
  return `${Number(v.toFixed(2))}%`;
};

/** Frappe stores dates as yyyy-mm-dd; render dd-mm-yyyy. */
export const fmtDate = (d?: string | null): string => {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
};

/** Quantity: up to 3 dp, trailing zeros trimmed. */
export const qty = (n: unknown): string => {
  const v = toNum(n);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(v);
};
