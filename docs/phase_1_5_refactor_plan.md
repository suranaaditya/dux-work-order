# Phase 1.5 — Refactor plan

Executable spec for the Phase 1.5 refactor of dux_civil_works. This is
the artifact of Commit 1.5a (this commit). Commits 1.5b and 1.5c will
execute against this plan.

Read DESIGN.md Section 8 first for the architectural rationale behind
this refactor. Read CLAUDE.md "DocType rename procedure (Frappe v16)"
for the validated rename pattern this plan invokes.

## 1. Scope summary

Phase 1.5 lands in three commits:

| Commit | Title | Touches |
|---|---|---|
| **1.5a** (this) | Plan document | `docs/phase_1_5_refactor_plan.md` only |
| **1.5b** (next) | Consolidated rename pass | 10 doctype renames + 1 module rename; all Python/JS literals updated; smoke test updated |
| **1.5c** (after) | Single-document structural refactor + bug fixes | Civil Work Order BOQ deleted; BOQ rows absorbed into Work Order Contract; `boq_row_uid` added; deviation bug + amount visibility bug fixed |

1.5a is read-only audit + writing this file. No code changes.

## 2. Rename map

Approved by user prior to this commit. Final mapping:

| Current | New |
|---|---|
| Civil Works Settings | Work Order Settings |
| Civil Works Company Account | Work Order Company Account |
| Civil Work Order | Work Order Contract |
| Civil Work Order Summary Item | Work Order Summary Item |
| Civil Work Order BOQ | **(NOT RENAMED — deleted in 1.5c)** |
| Civil BOQ Item | Work Order BOQ Item |
| Civil Advance Register | Work Order Advance Register |
| Civil Advance Tranche | Work Order Advance Tranche |
| Civil Advance Recovery | Work Order Advance Recovery |
| Work Order RA Bill | (already renamed in pilot — no change) |
| Civil RA Bill Item | Work Order RA Bill Item |
| Civil RA Bill Deduction | Work Order RA Bill Deduction |
| Module: Dux Civil Works | Module: Dux Work Orders |
| App folder `dux_civil_works` | (NOT renamed — internal identifier stays) |

Naming rationale recap (full version in DESIGN.md):
- "Work Order" alone collides with ERPNext's manufacturing Work Order
  doctype. The "Contract" suffix on the parent disambiguates at the
  Frappe layer; the user-facing label can still read "Work Order".
- Child doctypes drop the "Civil" prefix and gain "Work Order" — they
  don't collide because ERPNext doesn't ship child doctypes with these
  names.
- "Civil Work Order BOQ" is deliberately excluded from the rename
  because the doctype is being deleted in 1.5c. Renaming it first would
  be wasted work and add a transient name to the audit trail.

## 3. Rename order (safe sequence)

Renames within Frappe's `rename_doc` are atomic at the DB level but
have a natural dependency order. Children before parents prevents a
transient state where the parent's Table options point at a not-yet-
renamed child.

**Sequence:**

1. Civil Works Company Account → Work Order Company Account
2. Civil Work Order Summary Item → Work Order Summary Item
3. Civil BOQ Item → Work Order BOQ Item
4. Civil Advance Tranche → Work Order Advance Tranche
5. Civil Advance Recovery → Work Order Advance Recovery
6. Civil RA Bill Item → Work Order RA Bill Item
7. Civil RA Bill Deduction → Work Order RA Bill Deduction
8. Civil Works Settings → Work Order Settings (Single; renamed after its child)
9. Civil Advance Register → Work Order Advance Register (parent of tranche + recovery)
10. Civil Work Order → Work Order Contract (parent of summary item; self-references amended_from)

11. Module rename: Dux Civil Works → Dux Work Orders, then reassign each
    renamed doctype's `module` field

`Civil Work Order BOQ` is left untouched throughout 1.5b. Its `boq_items`
table option (currently pointing at `Civil BOQ Item`) WILL be auto-
updated to `Work Order BOQ Item` by step 3's rename_doc — verified
behaviour in the pilot. After 1.5c deletes Civil Work Order BOQ entirely,
this transient pointer goes away.

## 4. Per-rename impact

For every rename, the steps below MUST run. Items marked
**auto-handled** are taken care of by `frappe.rename_doc(...)` natively;
items marked **manual** require an explicit fix script in the same
console invocation.

### 4.1 Civil Works Company Account → Work Order Company Account
- **Auto-handled inbound:** Civil Works Settings.company_accounts (Table)
- **Self-references:** none
- **Python literals:** none found
- **JS literals:** none
- **JSON cross-refs:** civil_works_settings.json (Table option — auto-rewritten on rename)
- **Manual:** none

### 4.2 Civil Work Order Summary Item → Work Order Summary Item
- **Auto-handled inbound:** Civil Work Order.summary_items (Table)
- **Self-references:** none
- **Python literals:**
  - `dux_civil_works/doctype/civil_work_order_boq/civil_work_order_boq.py:68` — string literal `"Civil Work Order Summary Item"` (manual replace)
- **JS literals:** none
- **JSON cross-refs:** civil_work_order.json (Table option — auto-rewritten)
- **Manual:** update the literal above

### 4.3 Civil BOQ Item → Work Order BOQ Item
- **Auto-handled inbound:** Civil Work Order BOQ.boq_items (Table)
- **Self-references:** none
- **Python literals:**
  - `dux_civil_works/doctype/work_order_ra_bill/work_order_ra_bill.py:70` — literal `"Civil BOQ Item"`
- **JS literals:** none
- **JSON cross-refs:** civil_work_order_boq.json (Table option — auto-rewritten)
- **Manual:** update the literal above

### 4.4 Civil Advance Tranche → Work Order Advance Tranche
- **Auto-handled inbound:** Civil Advance Register.tranches (Table)
- **Self-references:** none
- **Python literals:** none
- **JS literals:** none
- **JSON cross-refs:** civil_advance_register.json (auto-rewritten)
- **Manual:** none

### 4.5 Civil Advance Recovery → Work Order Advance Recovery
- **Auto-handled inbound:** Civil Advance Register.recoveries (Table)
- **Self-references:** none
- **Python literals:** none
- **JS literals:** none
- **JSON cross-refs:** civil_advance_register.json (auto-rewritten)
- **Manual:** none

### 4.6 Civil RA Bill Item → Work Order RA Bill Item
- **Auto-handled inbound:** Work Order RA Bill.items (Table)
- **Self-references:** none
- **Python literals:** none
- **JS literals:** none
- **JSON cross-refs:** work_order_ra_bill.json (auto-rewritten)
- **Manual:** none

### 4.7 Civil RA Bill Deduction → Work Order RA Bill Deduction
- **Auto-handled inbound:** Work Order RA Bill.deductions (Table)
- **Self-references:** none
- **Python literals:** none
- **JS literals:** none
- **JSON cross-refs:** work_order_ra_bill.json (auto-rewritten)
- **Manual:** none

### 4.8 Civil Works Settings → Work Order Settings
- **Auto-handled inbound:** (none — Single, accessed via frappe.get_single / frappe.get_cached_doc)
- **Self-references:** none
- **Python literals (manual replace):**
  - `dux_civil_works/doctype/civil_work_order_boq/civil_work_order_boq.py:43`
  - `dux_civil_works/doctype/work_order_ra_bill/work_order_ra_bill.py:230`
  - `dux_civil_works/doctype/civil_work_order/civil_work_order.py:78`
- **JS literals:**
  - `dux_civil_works/doctype/civil_works_settings/civil_works_settings.js:4` (commented form.on hook — auto-regenerated by Frappe on rename, BUT the controller .js will be moved to the new folder; verify content post-rename)
- **JSON cross-refs:** none outside its own folder
- **Manual:** update the 3 Python literals; verify .js regenerated correctly

### 4.9 Civil Advance Register → Work Order Advance Register
- **Auto-handled inbound:** (none — no Link fields point at it; accessed via `frappe.db.get_value("Civil Advance Register", {"civil_work_order": ...})` SQL filter)
- **Self-references:** none
- **Python literals (manual replace):**
  - `dux_civil_works/doctype/civil_advance_register/civil_advance_register.py:32, 94, 97, 100, 111, 122` (6 occurrences)
  - `dux_civil_works/doctype/work_order_ra_bill/work_order_ra_bill.py:363, 367`
  - `scripts/regression_smoke_test.py:136, 144`
- **JS literals:**
  - `dux_civil_works/doctype/civil_advance_register/civil_advance_register.js:4` (commented form.on — handled by file move)
- **JSON cross-refs:** none outside its own folder
- **Manual:** update all 9 Python literals

### 4.10 Civil Work Order → Work Order Contract
- **Auto-handled inbound:**
  - Civil Advance Register.civil_work_order (Link)
  - Civil Work Order BOQ.civil_work_order (Link)
  - Work Order RA Bill.civil_work_order (Link)
- **SELF-REFERENCE (manual fix required):**
  - Civil Work Order.amended_from (Link) options=Civil Work Order
  - After rename_doc, the doctype's own DocField row for `amended_from`
    still has `options = 'Civil Work Order'`. Fix script must update
    this field's `options` to `'Work Order Contract'` and call
    `frappe.clear_cache(doctype='Work Order Contract')`. Procedure
    validated in the Civil RA Bill → Work Order RA Bill pilot
    (commit `1c8253c`).
- **Python literals (manual replace):**
  - `dux_civil_works/doctype/civil_work_order_boq/civil_work_order_boq.py:30`
  - `dux_civil_works/doctype/civil_advance_register/civil_advance_register.py:20, 99`
  - `dux_civil_works/doctype/work_order_ra_bill/work_order_ra_bill.py:115, 164`
  - `scripts/regression_smoke_test.py:54, 66`
  - Note: the `civil_work_order` FIELD NAME on inbound Link doctypes
    (Civil Advance Register, Civil Work Order BOQ, Work Order RA Bill)
    is a separate question. The rename_doc only changes the OPTIONS,
    not the fieldname. The fieldname `civil_work_order` is now
    semantically slightly off; it can stay as-is (rename of fields is
    not part of this phase) or be renamed to `work_order_contract` in
    a later pass. **Decision: keep field names as-is in 1.5b** to keep
    blast radius small; consider field-rename pass after 1.5c lands.
- **JS literals:**
  - `dux_civil_works/doctype/civil_work_order/civil_work_order.js:4` — `frappe.ui.form.on("Civil Work Order", ...)`. The folder will be moved by rename_doc; the file content needs the literal updated to `"Work Order Contract"`.
- **JSON cross-refs:** civil_work_order_boq.json, civil_advance_register.json, work_order_ra_bill.json (all auto-rewritten by rename_doc)
- **Manual:** self-reference fix on amended_from; update 7 Python literals; update form.on literal in the .js

### Civil Work Order BOQ — explicitly NOT renamed in 1.5b
Active form script `civil_work_order_boq.js` and controller
`civil_work_order_boq.py` continue to refer to themselves as "Civil
Work Order BOQ" through the entirety of 1.5b. The doctype only goes
away in 1.5c when its rows are migrated into Work Order Contract.

During 1.5b the doctype WILL receive an automatic Table-options update
(its `boq_items` field will be re-pointed at `Work Order BOQ Item`).
That's expected.

## 5. Module rename procedure

After all doctype renames complete, rename the Module:

1. Rename the Module Def record:
   ```python
   frappe.rename_doc("Module Def", "Dux Civil Works", "Dux Work Orders")
   ```
2. For every renamed doctype, set `module = "Dux Work Orders"`:
   ```python
   for new_name in [
       "Work Order Settings", "Work Order Company Account",
       "Work Order Contract", "Work Order Summary Item",
       "Work Order BOQ Item", "Work Order Advance Register",
       "Work Order Advance Tranche", "Work Order Advance Recovery",
       "Work Order RA Bill Item", "Work Order RA Bill Deduction",
       # Already on the new module from the pilot:
       # "Work Order RA Bill"
       # Civil Work Order BOQ stays on old module — but old module
       # no longer exists, so reassign it too:
       "Civil Work Order BOQ",
   ]:
       d = frappe.get_doc("DocType", new_name)
       d.module = "Dux Work Orders"
       d.save()
   ```
3. Update `dux_civil_works/modules.txt` from `Dux Civil Works` to
   `Dux Work Orders`. Frappe reads this on `bench migrate` and asserts
   that every Module Def listed actually exists.
4. Update `hooks.py` `app_publisher`, `app_description`, etc. if they
   reference the old module label. App name (`dux_civil_works`) stays.
5. Run `bench --site erp.jewonline.in clear-cache` and
   `bench build --app dux_civil_works`.

## 6. Custom field audit (Purchase Invoice)

**Finding:** Step G query
```sql
SELECT * FROM `tabCustom Field`
WHERE dt IN ('Purchase Invoice', 'Purchase Invoice Item')
  AND module = 'Dux Civil Works'
```
returned **zero rows**.

**Interpretation:** Either (a) the PI custom fields are declared as
fixtures but not yet imported on this site, (b) they were imported but
the `module` column is blank or set to a different module, or (c) they
exist but live in some other declaration mechanism (hooks.py
`fixtures` with a different filter).

**Action required before Commit 1.5b begins:**
1. Re-run the query without the module filter:
   ```sql
   SELECT name, dt, fieldname, options, module FROM `tabCustom Field`
   WHERE dt IN ('Purchase Invoice', 'Purchase Invoice Item')
     AND (fieldname LIKE '%wo_ra%' OR fieldname LIKE '%civil%' OR options LIKE 'Civil %');
   ```
2. Check `dux_civil_works/fixtures/` and `dux_civil_works/hooks.py`
   for custom_field declarations.
3. If any Link options point at `Civil *` doctypes, add an explicit
   step to update them in Commit 1.5b (rename_doc does NOT walk
   Custom Field options on un-attributed records — verify pilot
   behaviour first).

The plan does not block on this; the verification is part of the
Commit 1.5b pre-flight.

## 7. Verification gates (end of Commit 1.5b)

Commit 1.5b is acceptable for landing if and only if ALL of the
following pass:

1. **Doctype name absence:**
   ```sql
   SELECT name FROM `tabDocType` WHERE name LIKE 'Civil %' AND name != 'Civil Work Order BOQ';
   ```
   Must return zero rows (only the soon-to-be-deleted-in-1.5c BOQ
   doctype may remain on the old name).

2. **Doctype name presence:**
   All 10 new names exist in `tabDocType` with `module = 'Dux Work
   Orders'`.

3. **String literal absence:**
   ```bash
   grep -rn '"Civil ' --include='*.py' apps/dux_civil_works
   grep -rn "'Civil " --include='*.py' apps/dux_civil_works
   ```
   Returns hits ONLY in `civil_work_order_boq/` (the doctype kept
   alive until 1.5c) and inside this plan document and CLAUDE.md
   historical mentions. Anything else is a missed literal.

4. **Regression smoke test passes:**
   Updated to use new doctype names; executed via console; all
   assertions green.

5. **Amend canary on Work Order Contract:**
   Create a draft Work Order Contract, submit it, cancel it, click
   Amend → resulting Document opens and saves cleanly. This is the
   self-reference fix validator.

6. **PI integration still works:**
   "Get Items From RA Bill" picker on a new Purchase Invoice still
   pulls items from a submitted Work Order RA Bill and creates
   correctly-grouped lines.

7. **Working tree at the end of 1.5b:**
   `git status` → clean. All file moves committed.

## 8. Commit 1.5c preview (single-document refactor + bugs)

After 1.5b lands, Commit 1.5c will:

1. **Delete Civil Work Order BOQ doctype.**
   - Migrate any existing BOQ rows from `tabCivil BOQ Item` (where
     `parenttype = 'Civil Work Order BOQ'`) up into Work Order Contract
     as a new child table. Currently empty in DB so the migration is
     trivial, but the script should still handle non-empty cases for
     forward safety.
   - Drop `tabCivil Work Order BOQ` and `tabCivil BOQ Item`
     (now-orphan) tables via `frappe.delete_doc("DocType",
     "Civil Work Order BOQ", force=True)`.

2. **Add `boq_items` Table field on Work Order Contract** (target =
   the renamed `Work Order BOQ Item` from 1.5b).

3. **Add `boq_row_uid` field on Work Order BOQ Item.**
   - Type: Data, length 36, hidden, unique = 0 (UIDs are unique within
     a parent context, not globally).
   - Default generation via controller `before_insert`: `import uuid;
     self.boq_row_uid = str(uuid.uuid4())`.
   - Existing rows: backfill via patch script (UUIDs assigned at
     migration time).

4. **Add `wo_boq_row_uid` field on Work Order RA Bill Item.**
   - Type: Data, hidden, length 36.
   - Populated from the source `Work Order BOQ Item.boq_row_uid` when
     the RA Bill picker fetches BOQ rows.
   - Cumulative-quantity lookup logic (in RA Bill controller) MUST
     prefer this UID over the row's child name when resolving "what
     was the cumulative qty on the previous bill for this logical
     BOQ row?".

5. **Make summary table on Work Order Contract read-only and
   auto-aggregated.**
   - On `validate`, controller rebuilds `summary_items` by grouping
     `boq_items` by `summary_head` (Item) and summing `amount`.
   - Field flags on `summary_items`: `read_only = 1`, `no_copy = 1`.
   - Pricing summary on the form becomes a view of the BOQ rows by
     construction — invariant WO total ≡ BOQ total.

6. **Remove `civil_work_order_boq` Link from Work Order RA Bill.**
   - Replace with code path that reads `boq_items` directly from the
     parent Work Order Contract via the existing `civil_work_order`
     Link.

7. **Bug fix: 0% deviation rejection.**
   - Audit ALL percent fields in the app for `if not pct` truthy
     checks. Replace with `if pct is None`. Specifically:
     - `civil_work_order_boq.py` (deviation default lookup) — moved
       into Work Order Contract controller post-refactor.
     - Any retention / mob-recovery / TDS / labour-cess percent
       handling in Work Order RA Bill and Work Order Contract.
   - Add regression assertion: a BOQ row with
     `deviation_limit_pct = 0` saves successfully and rejects any
     cumulative_qty > estimated_qty on RA Bill submit.

8. **Bug fix: BOQ amount visibility.**
   - In Work Order BOQ Item doctype JSON, set `amount` field
     `in_list_view = 1` and `hidden = 0`. (Currently `hidden = 1` per
     Phase 1 observation — verify exact flag during 1.5c.)

9. **Update regression smoke test to exercise single-document flow.**

10. **Update DESIGN.md Section 8** to note that 1.5 has landed (move
    from "current focus" to "completed").

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A string literal missed in Step D/E grep causes a runtime AttributeError after rename | Medium | Medium | Regression smoke test run at end of 1.5b; failing trace pinpoints the literal. Grep audit re-run as Step 3 of verification gates. |
| A Custom Field added by another bench app (out of 24 installed) has a Link option pointing at a Civil X doctype | Low | Medium | Step B query covers tabCustom Field too; result was empty. Re-verify pre-1.5b. |
| Frappe v16 `rename_doc` has an unhandled edge case beyond the pilot | Low | High | Full bench backup before 1.5b begins; if catastrophic, restore. The pilot rename validated the procedure end-to-end including amend canary. |
| PI custom fields aren't tracked under module 'Dux Civil Works' (Step G zero result) → rename_doc misses their options | Medium | Medium | Pre-1.5b verification step (Section 6) covers this. |
| The `civil_work_order` field NAME on inbound Link doctypes becomes semantically stale ("civil_work_order" pointing at "Work Order Contract") | High | Low | Accepted as-is for 1.5b. Field rename is a separate, low-priority pass. The semantic mismatch is internal; the user-facing form labels can be updated independently. |
| `Civil Work Order BOQ` left on the renamed module ("Dux Work Orders") while its OWN name still says "Civil" — visible weirdness in Module View until 1.5c | High | Cosmetic | Acceptable for the short window between 1.5b and 1.5c. Add a banner in the doctype description noting the imminent deletion. |
| Module rename leaves orphan `Dux Civil Works` Module Def or `modules.txt` line | Low | High (bench migrate fails) | Module rename step explicitly cleans up both. Verify with `frappe.get_all("Module Def", filters={"name": "Dux Civil Works"})` returning empty. |

## 10. Out of scope for 1.5

These are explicitly NOT touched in any of 1.5a/1.5b/1.5c:

- App folder rename (`dux_civil_works` stays — internal identifier
  doesn't affect user-facing labels)
- Field-name renames (e.g., `civil_work_order` Link field staying
  named that even when it points at `Work Order Contract`)
- Print formats (Phase 2/3)
- BOQ amendment workflow (Phase 2 — but `boq_row_uid` is laid down
  in 1.5c as the foundation)
- Measurement Book (Phase 2)
- Payment Voucher integration (Phase 2)
- Any user-facing UI label / Workspace card label changes (covered
  separately if needed)

---

**Plan complete.** Commit 1.5b can proceed against this spec.
