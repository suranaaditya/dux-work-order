import frappe


def get_context(context):
    """Serve the SiteBill SPA (www/sitebill.html) as a dynamic, per-session
    template page so Frappe renders the injected `{{ csrf_token }}` to the real
    token. Without a context controller Frappe may serve the built HTML as a
    static page, leaving the placeholder literal and breaking SPA writes.
    """
    token = ""
    try:
        if getattr(frappe, "session", None) and frappe.session.data:
            token = frappe.session.data.get("csrf_token") or ""
    except Exception:
        token = ""
    context.csrf_token = token
    context.no_cache = 1
    return context
