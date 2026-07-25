/* Who is looking at this app?
 *
 * The same bundle serves staff and contractors. The server decides which:
 * get_portal_context answers only about the SESSION user, so this cannot be
 * used to probe anyone else's access, and the answer is advisory for the UI
 * only — every read and write is scoped server-side regardless.
 */
import { createContext, useContext } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

export interface PortalSupplier {
  name: string;
  supplier_name?: string;
  gstin?: string;
  work_orders?: number;
}

export interface PortalContext {
  is_portal_user: boolean;
  user?: string;
  full_name?: string;
  suppliers: PortalSupplier[];
}

const CTX = createContext<{ ctx?: PortalContext; isLoading: boolean }>({ isLoading: true });

const METHOD = "dux_civil_works.dux_work_orders.api.portal.get_portal_context";

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useFrappeGetCall<{ message: PortalContext }>(METHOD, undefined, "portal-context");
  return <CTX.Provider value={{ ctx: data?.message, isLoading }}>{children}</CTX.Provider>;
}

export const usePortal = () => useContext(CTX);

/** The contractor's own name for the header — a firm, not a person. */
export const portalTitle = (ctx?: PortalContext) =>
  ctx?.suppliers?.[0]?.supplier_name || ctx?.suppliers?.[0]?.name || "Contractor";
