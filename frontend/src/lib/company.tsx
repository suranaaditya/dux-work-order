import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";

type Ctx = { company: string; setCompany: (c: string) => void; companies: string[] };
const CompanyCtx = createContext<Ctx>({ company: "", setCompany: () => {}, companies: [] });
export const useCompany = () => useContext(CompanyCtx);

/** Scopes the whole app to a selected company (persisted). Defaults to Gaya. */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { data } = useFrappeGetDocList<any>("Company", { fields: ["name"], limit: 0, orderBy: { field: "name", order: "asc" } });
  const companies: string[] = (data || []).map((c) => c.name);
  const [company, setC] = useState<string>(() => localStorage.getItem("sitebill_company") || "");
  const setCompany = (c: string) => {
    setC(c);
    localStorage.setItem("sitebill_company", c);
  };
  useEffect(() => {
    if (companies.length && (!company || !companies.includes(company))) {
      const gaya = companies.find((c) => /Gaya Railway Infra/i.test(c));
      setCompany(gaya || companies[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return <CompanyCtx.Provider value={{ company, setCompany, companies }}>{children}</CompanyCtx.Provider>;
}

/** Prepend a company filter to a filters array (no-op until a company is chosen). */
export const withCompany = (company: string, filters: any[] = []): any[] =>
  company ? [["company", "=", company], ...filters] : filters;
