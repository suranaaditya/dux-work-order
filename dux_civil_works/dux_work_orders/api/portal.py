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
from frappe import _

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


# ------------------------------------------------------------------
# Granting portal access (staff only)
# ------------------------------------------------------------------
# Everything here is an ADMIN action performed by your own team. A portal
# user can never reach it — a contractor granting portal access would be a
# privilege-escalation hole, so every entry point refuses them explicitly
# rather than relying on the UI not offering the option.


def _assert_can_manage_access():
	"""Only staff who may edit a Supplier can hand out logins."""
	if is_portal_user():
		frappe.throw(_("Not permitted."), frappe.PermissionError)
	if not frappe.has_permission("Supplier", "write"):
		frappe.throw(
			_("You need permission to edit Suppliers to manage portal access."),
			frappe.PermissionError,
		)


@frappe.whitelist()
def list_portal_users(supplier):
	"""The logins that can currently see this supplier's work."""
	_assert_can_manage_access()
	rows = frappe.db.get_all(
		"Portal User",
		filters={"parent": supplier, "parenttype": "Supplier"},
		fields=["user"],
	)
	out = []
	for r in rows:
		u = frappe.db.get_value(
			"User", r["user"],
			["name", "full_name", "enabled", "last_login", "user_type", "last_active"],
			as_dict=True,
		)
		if not u:
			continue
		u["has_portal_role"] = PORTAL_ROLE in frappe.get_roles(u["name"])
		u["never_signed_in"] = not u.get("last_login")
		out.append(u)
	return out


@frappe.whitelist()
def grant_portal_access(supplier, email, full_name=None, send_invite=1):
	"""Create (or link) a contractor login for this supplier.

	No password is ever set here. Frappe emails the person a link and they
	choose their own — so nobody, including us, handles their credentials.
	"""
	_assert_can_manage_access()

	if not frappe.db.exists("Supplier", supplier):
		frappe.throw(_("No such supplier."))

	email = (email or "").strip().lower()
	if not email:
		frappe.throw(_("An email address is required — it is their username."))
	from frappe.utils import validate_email_address
	validate_email_address(email, throw=True)

	existing_type = frappe.db.get_value("User", email, "user_type")
	if existing_type == "System User":
		# Refuse rather than quietly turning a staff account into a portal one.
		frappe.throw(
			_("{0} is already a staff user on this system. Use a different address for contractor access.").format(email),
			title=_("That is a staff account"),
		)

	created = False
	if not existing_type:
		user = frappe.new_doc("User")
		user.email = email
		parts = (full_name or "").strip().split(" ", 1)
		user.first_name = parts[0] or email.split("@")[0]
		if len(parts) > 1:
			user.last_name = parts[1]
		user.user_type = "Website User"        # forced: never a desk account
		user.enabled = 1
		user.send_welcome_email = 1 if int(send_invite or 0) else 0
		user.append("roles", {"role": PORTAL_ROLE})
		user.insert(ignore_permissions=True)
		created = True
	else:
		user = frappe.get_doc("User", email)
		if PORTAL_ROLE not in [r.role for r in (user.roles or [])]:
			user.append("roles", {"role": PORTAL_ROLE})
			user.save(ignore_permissions=True)

	sup = frappe.get_doc("Supplier", supplier)
	if not any((r.user or "") == email for r in (sup.portal_users or [])):
		sup.append("portal_users", {"user": email})
		sup.save(ignore_permissions=True)

	frappe.db.commit()
	return {
		"user": email,
		"created": created,
		"invited": bool(int(send_invite or 0)) and created,
		"message": _("Access granted to {0}.").format(email),
	}


@frappe.whitelist()
def revoke_portal_access(supplier, user, disable_login=0):
	"""Remove this login's access to this supplier.

	The User record is kept — they may hold access to another supplier, and
	deleting it would orphan the comments and claims they authored. Optionally
	disable the login outright.
	"""
	_assert_can_manage_access()

	sup = frappe.get_doc("Supplier", supplier)
	before = len(sup.portal_users or [])
	sup.portal_users = [r for r in (sup.portal_users or []) if (r.user or "") != user]
	if len(sup.portal_users) != before:
		sup.save(ignore_permissions=True)

	still_linked = frappe.db.count("Portal User", {"user": user, "parenttype": "Supplier"})
	if int(disable_login or 0) and not still_linked:
		frappe.db.set_value("User", user, "enabled", 0)

	# End any live session immediately rather than waiting for it to expire.
	frappe.db.sql("delete from tabSessions where user=%s", (user,))
	frappe.db.commit()
	return {"user": user, "still_has_other_suppliers": bool(still_linked)}


@frappe.whitelist()
def set_portal_user_enabled(user, enabled):
	"""Suspend or restore a contractor login."""
	_assert_can_manage_access()
	if frappe.db.get_value("User", user, "user_type") != "Website User":
		frappe.throw(_("Not a portal login."), frappe.PermissionError)
	on = 1 if int(enabled or 0) else 0
	frappe.db.set_value("User", user, "enabled", on)
	if not on:
		frappe.db.sql("delete from tabSessions where user=%s", (user,))
	frappe.db.commit()
	return {"user": user, "enabled": on}


@frappe.whitelist()
def send_portal_invite(user, return_link=0):
	"""Email them a fresh set-password link.

	`return_link` also hands the link back so it can be sent over WhatsApp,
	which is how a site contractor is usually reached. It is single-use and
	expires — treat it like a password.
	"""
	_assert_can_manage_access()
	if frappe.db.get_value("User", user, "user_type") != "Website User":
		frappe.throw(_("Not a portal login."), frappe.PermissionError)

	doc = frappe.get_doc("User", user)
	link = doc.reset_password(send_email=not int(return_link or 0))
	frappe.db.commit()
	return {
		"user": user,
		"emailed": not bool(int(return_link or 0)),
		"link": link if int(return_link or 0) else None,
	}
