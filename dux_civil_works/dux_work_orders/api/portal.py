"""Contractor portal — identity resolution and the server-side data boundary.

A contractor signs in as a Frappe **Website User** (no desk access) that is
listed in the native ``Supplier.portal_users`` child table. Several people at
one contracting firm can be listed against the same Supplier, so they share
one commercial identity while keeping individual logins.

A contractor may hold MANY work orders. Scoping is therefore done at the
**supplier** level, never per work order: resolve the user to their
supplier(s), then every Work Order Contract / RA Bill for those suppliers is
visible and nothing else is.

This module is the boundary. It is wired in ``hooks.py`` as:

    permission_query_conditions -> list/report queries (returns a SQL clause)
    has_permission              -> single-document reads

Both entry points are also safe to call directly from whitelisted endpoints.

Design rules (deliberate, please preserve):

1. **Internal users are never restricted.** Every entry point returns "no
   restriction" unless the user actually holds ``PORTAL_ROLE``. Adding these
   hooks therefore cannot change what an existing staff user sees.
2. **Fail closed for portal users.** A portal user whose supplier mapping is
   missing or ambiguous sees nothing (``1=0``), never everything.
3. **Never interpolate a name into SQL unescaped.** Supplier names are user
   data; they go through ``frappe.db.escape``.
4. The frontend is convenience. A hand-typed document name, a guessed URL or
   a raw ``/api/resource`` call all fail here, identically.
"""

import frappe

#: Role that marks a login as an external contractor. Internal staff must
#: never hold this role — holding it is what triggers scoping.
PORTAL_ROLE = "Contractor Portal"

#: Doctype -> the fieldname holding the Supplier on that doctype.
SUPPLIER_FIELD = {
	"Work Order Contract": "supplier",
	"Work Order RA Bill": "supplier",
}


def is_portal_user(user=None):
	"""True only for an external contractor login.

	Administrator and Guest are never portal users. Everything else is
	decided by the role, so revoking the role instantly revokes portal
	scoping (and, with it, portal access).
	"""
	user = user or frappe.session.user
	if not user or user in ("Administrator", "Guest"):
		return False
	return PORTAL_ROLE in frappe.get_roles(user)


def get_portal_suppliers(user=None):
	"""Supplier(s) this portal user is allowed to see. Empty for staff.

	Read from the native ``Supplier.portal_users`` child table, so supplier
	access is granted in the standard ERPNext place rather than a bespoke
	mapping. Cached for the life of the request — permission hooks fire on
	every row of every list.
	"""
	user = user or frappe.session.user
	if not is_portal_user(user):
		return []

	cache = getattr(frappe.local, "_dux_portal_suppliers", None)
	if cache is None:
		cache = frappe.local._dux_portal_suppliers = {}
	if user in cache:
		return cache[user]

	rows = frappe.db.get_all(
		"Portal User",
		filters={"user": user, "parenttype": "Supplier"},
		fields=["parent"],
	)
	suppliers = sorted({r.get("parent") for r in rows if r.get("parent")})
	cache[user] = suppliers
	return suppliers


def _scope_clause(doctype, user=None):
	"""SQL clause restricting `doctype` to the portal user's supplier(s).

	Returns "" (no restriction) for staff, and "1=0" for a portal user with
	no supplier mapping — never an unrestricted query.
	"""
	user = user or frappe.session.user
	if not is_portal_user(user):
		return ""

	fieldname = SUPPLIER_FIELD.get(doctype)
	if not fieldname:
		# Unknown doctype: refuse rather than guess.
		return "1=0"

	suppliers = get_portal_suppliers(user)
	if not suppliers:
		return "1=0"

	joined = ", ".join(frappe.db.escape(s) for s in suppliers)
	return "`tab{0}`.`{1}` in ({2})".format(doctype, fieldname, joined)


def _doc_allowed(doc, user=None):
	"""True if `doc` belongs to one of the portal user's suppliers."""
	user = user or frappe.session.user
	if not is_portal_user(user):
		return True

	doctype = getattr(doc, "doctype", None)
	fieldname = SUPPLIER_FIELD.get(doctype)
	if not fieldname:
		return False

	value = doc.get(fieldname) if hasattr(doc, "get") else None

	# A brand-new RA Bill has no supplier yet — it is fetched from the linked
	# work order during validate. Resolve it here too, or creating a claim
	# would be denied before the document ever gets a supplier.
	if not value and doctype == "Work Order RA Bill":
		wo = doc.get("civil_work_order") if hasattr(doc, "get") else None
		if wo:
			value = frappe.db.get_value("Work Order Contract", wo, "supplier")

	return bool(value) and value in get_portal_suppliers(user)


# ------------------------------------------------------------------
# hooks.py entry points — one pair per exposed doctype.
#
# Kept as thin named wrappers (rather than one generic function) because
# Frappe resolves these by dotted path per doctype, and an explicit name
# makes it obvious in hooks.py exactly what is exposed to the portal.
# ------------------------------------------------------------------


def work_order_query_conditions(user=None):
	return _scope_clause("Work Order Contract", user)


def work_order_has_permission(doc, ptype=None, user=None):
	return _doc_allowed(doc, user)


def ra_bill_query_conditions(user=None):
	return _scope_clause("Work Order RA Bill", user)


def ra_bill_has_permission(doc, ptype=None, user=None):
	return _doc_allowed(doc, user)


# ------------------------------------------------------------------
# Portal session context
# ------------------------------------------------------------------


@frappe.whitelist()
def get_portal_context():
	"""Who am I, and what am I allowed to see?

	The portal UI calls this once on load. It never accepts a user argument
	— the answer is always about the *session* user, so this cannot be used
	to enumerate somebody else's access.
	"""
	user = frappe.session.user
	if not is_portal_user(user):
		return {"is_portal_user": False, "suppliers": []}

	suppliers = get_portal_suppliers(user)
	out = []
	for name in suppliers:
		info = (
			frappe.db.get_value(
				"Supplier", name, ["name", "supplier_name", "gstin"], as_dict=True
			)
			or {}
		)
		# A contractor may hold many work orders — report them per supplier.
		info["work_orders"] = frappe.db.count(
			"Work Order Contract", {"supplier": name, "docstatus": 1}
		)
		out.append(info)

	return {
		"is_portal_user": True,
		"user": user,
		"full_name": frappe.db.get_value("User", user, "full_name"),
		"suppliers": out,
	}
