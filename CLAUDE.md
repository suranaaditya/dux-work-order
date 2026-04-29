# CLAUDE.md — dux_civil_works

This file is persistent memory for all future work on this app. Read it at the start of every session before touching the app.

## App identity
- App name: dux_civil_works
- Module: Dux Civil Works
- DocType prefix: `Civil` (e.g., Civil Work Order, Civil RA Bill, Civil BOQ Item)
- Publisher: Dutch Digitech
- Purpose: civil works contract management; reusable beyond RGI

## CRITICAL — how artifacts are created (this rule overrides any default Frappe pattern you know)
- ALL DocTypes, Pages, Reports, Print Formats, Dashboards, Workflows, Client Scripts, Server Scripts MUST be created by inserting Frappe documents through `bench --site erp.jewonline.in console`. Frappe natively writes the folder, `__init__.py`, `<name>.json`, `<name>.py`, and `<name>.js` files into the app directory when a DocType (or other artifact) is inserted with `developer_mode = 1` and `custom = 0`.
- DO NOT hand-write JSON files for new artifacts.
- DO NOT use `bench make-doctype`, `bench make-report`, `bench make-page` or any similar CLI generator.
- DO NOT click through the Desk Form Builder UI for this build — we are using the console-script approach so each step is reproducible and the script itself is the spec.
- AFTER Frappe generates the files, you MAY edit the generated `.py` (controller) and `.js` (client script) files freely for custom logic — validations, on_submit handlers, refresh handlers, button handlers.
- NEVER edit a generated `.json` file by hand to add/remove/rename fields. To change fields, write a follow-up console script that loads the doctype document, modifies it, and saves it. Frappe will rewrite the JSON cleanly.
- Developer mode MUST be ON (`developer_mode: 1` in `sites/erp.jewonline.in/site_config.json`). Without it, Frappe stores changes only in the database and does NOT write app files — that breaks the entire workflow.

### Standard execution pattern for every artifact step
1. Write a Python script (heredoc or .py file) that builds and inserts the artifact document(s).
2. Pipe or pass the script into `bench --site erp.jewonline.in console`.
3. Verify the files Frappe generated in the app folder.
4. Open the generated controller `.py` and add custom logic.
5. `bench --site erp.jewonline.in migrate`
6. `bench --site erp.jewonline.in clear-cache`
7. Reload bench processes per the 'Bench reload procedure' section below
   (gunicorn HUP for controller/JS changes; add RQ worker SIGTERM if background
   jobs or hooks are affected). Confirm the reload to the user.
8. Run a verification script through `bench --site erp.jewonline.in console`
   that exercises the artifact's behavior — load defaults, trigger validations,
   confirm field metadata. DO NOT verify by clicking around in Desk.
9. Git commit.

## Bench CLI commands ALLOWED
- `bench new-app dux_civil_works` (only once, for app creation)
- `bench --site erp.jewonline.in install-app dux_civil_works`
- `bench --site erp.jewonline.in migrate`
- `bench --site erp.jewonline.in clear-cache`
- `bench --site erp.jewonline.in console` (Python REPL for inspection/debugging only)
- `bench build`, `bench setup requirements`

## Bench CLI commands FORBIDDEN
- `bench make-doctype`, `bench make-report`, `bench make-page`, `bench make-fixtures`
- Any command that auto-generates artifact files outside Desk
- `bench restart` (requires sudo on this supervisord-managed bench; use the
  Bench reload procedure above instead)

## Workflow per artifact (use this pattern every time)

1. Write a Python script that builds and inserts the artifact document(s) (DocType, Report, Print Format, Workspace, etc.).
2. Save the script to /tmp/<descriptive_name>.py and execute via:
     bench --site erp.jewonline.in console < /tmp/<descriptive_name>.py
3. Verify the files Frappe generated in the app folder. The real path includes
   THREE levels of dux_civil_works nesting:
     apps/dux_civil_works/dux_civil_works/dux_civil_works/<artifact_type>/<artifact_name>/
   This is expected: app folder → app package → module folder, where module name
   happens to equal app name.

   Note — file generation differs by doctype kind:
   - Parent / standalone DocType (any non-istable doctype, e.g. `is_submittable: 1`
     or a Single): Frappe writes `__init__.py`, `<name>.json`, `<name>.py`,
     `<name>.js`, AND `test_<name>.py`.
   - Child table (`istable: 1`, e.g. Civil Work Order Summary Item): Frappe
     writes `__init__.py`, `<name>.json`, `<name>.py` only. NO `.js` (child
     tables have no standalone client form) and NO `test_<name>.py` stub. This
     is standard Frappe behaviour, not a missing artifact — verification scripts
     that check for `.js` on a child table will give a false negative.
4. Open the generated controller .py file and add custom logic.
5. Run a verification script through `bench --site erp.jewonline.in console` to
   exercise validations and behavior — DO NOT verify by clicking around in Desk.
6. bench --site erp.jewonline.in migrate
7. bench --site erp.jewonline.in clear-cache
8. Reload bench processes (see "Bench reload procedure" below).
9. Functional smoke check from console.
10. Git commit.

## Bench reload procedure

This bench is supervisord-managed. `bench restart` requires sudo and is not
available to the frappe user. Instead:

For controller (.py) or client script (.js) changes — gunicorn HUP only:
  1. Find the gunicorn master PID:
       ps -ef | grep "gunicorn: master" | grep -v grep
  2. Send SIGHUP to it:
       kill -HUP <master_pid>
  3. Verify worker PIDs changed (master PID stays the same):
       ps -ef | grep "gunicorn: worker" | grep -v grep
     If worker PIDs flipped, reload succeeded.

For changes that affect background jobs, scheduled tasks, or hooks fired by
queued workers — restart RQ workers + scheduler too:
  Send SIGTERM to the RQ worker and scheduler processes; supervisord respawns them.
  (Most artifact additions in this build do NOT need this; controller-only
  changes are gunicorn HUP only.)

Tell the user when you have completed the reload and which procedure was used.
The user no longer needs to run `bench restart` from their own console for
artifact-creation steps that only touch controllers and client scripts.

## UOM convention for civil works

Production sites have the standard civil-engineering UOM abbreviations
already configured: Cum, Sqm, Rmt, Mtr, Brass, Quintal, MT, Lump Sum, etc.
Use these abbreviations in all verification scripts, sample data, and tests.

This dev site (erp.jewonline.in) may not have all of them — at the time of
Step 4 build, `Cum`, `Sqm`, and `Mtr` were missing. If a verification script
fails with a UOM `LinkValidationError` on the dev site, do NOT seed UOMs
from the app. Instead:

1. Check what UOMs exist on the dev site:
     bench --site erp.jewonline.in console
     >>> import frappe
     >>> [u.name for u in frappe.get_all("UOM", limit=200)]
2. Substitute a UOM that exists on the dev site for the test run.
3. Note the gap in your verification report so the user can sync the dev
   site's UOM list with production if desired.

Do NOT add UOM seeding to this app under any circumstances — UOM management
is the user's responsibility on their own sites.

## IPython console-over-stdin pattern

When piping a Python script into `bench --site erp.jewonline.in console`,
IPython parses cell-by-cell. Nontrivial control flow (nested `if`/`for`/`else`,
multi-line `with` blocks, deeply indented logic) can hit EOF before IPython
recognizes the block has terminated, in which case the trailing block is
SILENTLY DISCARDED — no error, no output, just missing work.

This produces the most insidious failure mode in this environment: the script
appears to "run" cleanly but does nothing.

For any console script beyond a few flat top-level statements, use the
`exec(string)` pattern:

    import frappe

    SCRIPT = """
    # ... arbitrarily nested Python here ...
    doc = frappe.get_doc("DocType", "X")
    for f in fields_to_add:
        if f["fieldname"] not in existing:
            doc.append("fields", f)
    doc.save()
    frappe.db.commit()
    print("Done")
    """

    exec(SCRIPT, {"frappe": frappe})

IPython sees one short top-level call (`exec(...)`); the entire SCRIPT is
compiled by `exec` in one pass and runs as a normal Python module.

Pass any names the inner script needs (like `frappe`) explicitly in the
exec globals dict — `exec` does NOT inherit IPython's namespace by default.

Use this pattern by default for any console script with:
- Nested loops or conditionals
- Function or class definitions
- Try/except blocks with multi-line handlers
- Anything more than ~10 lines of flat statements

For trivial scripts (just a few `frappe.db.set_value(...)` or print
statements), direct stdin is fine.

## Frappe v16 Link field validation

Frappe v16 (this bench runs frappe 16.12.0) enforces at DocType-CREATION time
that any Link field's `options` must reference an EXISTING DocType. This is
stricter than older Frappe versions which deferred the check to form-validation
time.

Practical consequence for this build: when two doctypes link to each other
(e.g., A.boq_ref → B and B.bill_ref → A), they cannot be created in arbitrary
order. The dependency must be resolvable: the linked-to side exists first.

The pattern we use:

1. Create a STUB of the linked-to doctype with minimum viable schema (name +
   naming series + an empty Section Break, no real fields yet). The stub must
   satisfy `frappe.db.exists("DocType", "X")`.
2. Create the doctype that links to it (now passes v16 validation).
3. In a later step, EXTEND the stub with its real schema using the same
   field-append pattern Pre-Step 5a used for Civil Works Settings:
     doc = frappe.get_doc("DocType", "X")
     existing = {f.fieldname for f in doc.fields}
     for fdef in NEW_FIELDS:
         if fdef["fieldname"] not in existing:
             doc.append("fields", fdef)
     doc.save()

Do NOT delete and recreate a stub doctype to "upgrade" it — you will lose any
data, hooks, or custom fields attached to it. Always extend.

## Frappe lifecycle hook persistence — `on_submit` and `on_cancel`

CRITICAL: Plain attribute assignment inside `on_submit` and `on_cancel` does
NOT persist to the database.

These hooks fire AFTER Frappe writes the document to DB. Any `self.field = X`
assignment in them only mutates the in-memory object — the DB row is already
written and Frappe will not re-write it.

The canonical fix is `db_set`:

    def on_submit(self):
        self.do_side_effects_on_other_docs()
        self.db_set("status", "Submitted", update_modified=False)

    def on_cancel(self):
        self.do_reversal_on_other_docs()
        self.db_set("status", "Cancelled", update_modified=False)

Use `update_modified=False` so the DB write does not bump the `modified`
timestamp (which would invalidate any in-flight document references).

For computed values used by both `validate` (where attribute assignment IS
correct, since it precedes the DB write) and the lifecycle hooks, factor
out a pure helper:

    def _compute_status(self):
        if self.docstatus == 2:
            return "Cancelled"
        ...

    def set_status(self):
        # Used by validate
        self.status = self._compute_status()

    def on_submit(self):
        self.db_set("status", self._compute_status(), update_modified=False)

This was the pattern adopted in Civil RA Bill controller during Step 5b.

### TimestampMismatch after failed submit

When `doc.submit()` raises during `before_submit` validations, Frappe has
already touched the in-memory `_original_modified` marker. A subsequent
`doc.save()` on the same in-memory instance will then raise
`TimestampMismatch`.

The fix in test scripts and any code that catches a submit failure:

    try:
        doc.submit()
    except frappe.ValidationError:
        doc.reload()       # reset in-memory timestamp from DB
        # ... now safe to save() again

In production code paths this is rarely an issue because failed submits
typically end the request. The pitfall is most common in console scripts
and tests that probe both the failure path and recovery in the same
session.

## DocType rename procedure (Frappe v16)

When renaming a DocType in this app, use this complete procedure. Frappe v16's `rename_doc` is comprehensive at the metadata + filesystem layer but does NOT touch Python/JS source code string literals — those require a manual audit and fix.

### 1. Pre-flight
- Confirm `developer_mode = 1`
- Confirm git working tree is clean
- Confirm zero in-flight drafts of the doctype being renamed
- Snapshot pre-rename inbound Link references for comparison
- `bench --site erp.jewonline.in backup --with-files` (non-negotiable)

### 2. Rename invocation
On Frappe 16.12.0 the CLI command `bench rename-doc` does NOT exist. Use `frappe.rename_doc()` via `bench --site erp.jewonline.in console`. Use `force=False` (default) so the call raises `frappe.NameError` if the target name already exists.

```python
frappe.rename_doc("DocType", "Old Name", "New Name", force=False)
frappe.db.commit()
```

### 3. What v16 `rename_doc` DOES handle
- Renames `tabOLD` → `tabNEW` (database table)
- Renames row in `tabDocType`
- Updates child tables' `parenttype` from OLD to NEW
- Updates inbound Link `options` values across `tabDocField` and `tabCustom Field`
- Renames the on-disk folder `OLD/` → `NEW/`
- Renames all files inside (e.g., `old.py` → `new.py`, `old.json` → `new.json`, `old.js` → `new.js`, `test_old.py` → `test_new.py`)
- Renames the Python class definition (e.g., `class CivilRABill(Document):` → `class WorkOrderRABill(Document):`)
- Rewrites the JSON's internal `"name"` field

### 4. What v16 `rename_doc` does NOT handle (manual fixes required)

#### 4a. Self-referencing Link fields
The doctype's auto-added `amended_from` field on submittable doctypes (and any other Link field whose `options` references the doctype's own name) is NOT updated. Fix immediately:

```python
def fix_self_references_after_rename(new_name, old_name):
    """Frappe v16 rename_doc misses self-referencing Link options.
    Call this immediately after frappe.rename_doc."""
    doc = frappe.get_doc("DocType", new_name)
    fixed = []
    for f in doc.fields:
        if f.fieldtype == "Link" and f.options == old_name:
            f.options = new_name
            fixed.append(f.fieldname)
    if fixed:
        doc.save()
        frappe.db.commit()
        frappe.clear_cache(doctype=new_name)
    return fixed
```

This applies to ANY field whose `options` references the old doctype name from within the renamed doctype itself — `amended_from` is the most common, but any Link field that references its own parent doctype (e.g., a "Parent" link for hierarchies) would also be affected.

#### 4b. String literals in source code
`rename_doc` does NOT walk Python or JS source files looking for string literals. Any reference to the OLD name in code as a string — `frappe.db.count("OLD", ...)`, `frappe.get_doc("OLD", ...)`, raw SQL referencing `tabOLD`, error messages, etc. — must be manually found and fixed.

REQUIRED audit pattern after every rename, run from the app root:

```bash
grep -rn '"OLD"' --include='*.py' .
grep -rn "'OLD'" --include='*.py' .
grep -rn 'tabOLD\b' --include='*.py' .         # word boundary preserves child doctype refs like tabOLD Item
grep -rn '"OLD"' --include='*.js' .
grep -rn "'OLD'" --include='*.js' .
grep -rln '"OLD"' --include='*.json' . | grep -v <renamed_folder>/<renamed_doctype>.json
```

Apply each fix individually with anchored `str_replace` — never global find-replace, because a child doctype like "OLD Item" is NOT renamed and would be silently corrupted by a global replace.

After all source fixes:

    bench --site erp.jewonline.in clear-cache
    # gunicorn HUP per Bench reload procedure

Re-grep to verify all string literals are clean.

### 5. Post-rename verification
- Old name does not exist in `tabDocType`
- New name exists, with `field_count`, `is_submittable`, `autoname`, `module`, `search_fields` all matching pre-rename
- Zero remaining inbound Link refs to the old name (in `tabDocField` AND `tabCustom Field`)
- Database table renamed (`tabOLD` gone, `tabNEW` exists)
- Re-run the doctype's test suite under the new name
- For submittable doctypes, exercise an amend flow as the canary for the self-reference fix correctness

### 6. Renamed doctypes so far
- Civil RA Bill → Work Order RA Bill (pilot, 2026-04-29, validated end-to-end including amend flow and full string-literal audit)

Future renames: append with date and validation status.

## Git discipline
- App folder is its own Git repo
- Branch: main
- Commit after each completed step with message: `Step N: <summary>`
- Push to remote will be configured later

## Naming conventions
- File names: snake_case
- DocType names: Title Case with `Civil` prefix
- Field names: snake_case
- Module: Dux Civil Works

## DEFERRED: Payment Voucher integration for Civil Works Advances (REQUIRED before go-live)

RGI uses a custom doctype `Payment Voucher` (from the dux_voucher app) as
the primary outflow document. Civil Works Advances paid to contractors flow
through Payment Voucher, NOT through standard ERPNext Payment Entry.

The Civil Advance Register (Step 5a) currently relies on MANUAL entry of
tranche rows. Before this app is considered production-ready, we must wire
the following:

1. Add custom fields to Payment Voucher:
   - is_civil_works_advance (Check)
   - civil_advance_type (Select: Mobilization, Material) — visible if checked
   - civil_work_order (Link: Civil Work Order) — visible if checked
2. Add hooks in dux_civil_works/hooks.py for Payment Voucher:
   - on_submit: find or create Civil Advance Register for the WO,
     append a Tranche row linked to this Payment Voucher
   - on_cancel: remove the matching Tranche row
3. The `payment_entry` field on Civil Advance Tranche may need to be
   renamed/repurposed to reference Payment Voucher instead — design TBD
   when this work is picked up. Either:
     (a) Rename the field to `source_voucher` with a Dynamic Link
         (so it can reference either Payment Entry or Payment Voucher), OR
     (b) Replace the field outright with a Payment Voucher Link.
   Preference is (b) for simplicity, unless RGI also occasionally pays
   advances via standard Payment Entry.

Decision recorded during Step 5a planning:
- Option B (custom flag on the outflow document with auto-sync hook) chosen
  over Option A (manual Tranche entry) and Option C (account-driven inference)
- Tranche cancellation policy: auto-delete on outflow document cancel (not
  cancelled-flag retention)
- Multi-type per voucher: not supported — one voucher = one advance type
- Cross-supplier scope: field shown on every Payment Voucher, no supplier
  flag for conditional display

Owner: this work is deferred but MUST be completed before the app is
finalized for production use at RGI.

## Phase 2 design decision: Measurement Book (MB) → RA Bill flow

LOCKED during Phase 1 build. Phase 2 implementation must follow these rules.

### Architecture: Model A — RA Bill is user-initiated, pulls from MB on demand

When the Civil Measurement Book doctype lands in Phase 2:

- MB entries are the SOURCE OF TRUTH for measured quantity per BOQ item.
- MB is filled by the site engineer, one entry per measurement event with
  location/chainage/dimensions/calculated qty/date.
- RA Bill stays user-initiated. The user creates a draft RA Bill when ready
  to bill — closing an MB period does NOT auto-create an RA Bill.
- On RA Bill draft creation, the system computes cumulative_qty by SUMMING
  all MB entries for each BOQ item up to bill_date.
- The user's role shifts from typing cumulative_qty to CERTIFYING it. The
  user may certify LESS than what MB shows (a quality hold, for example)
  but never MORE.
- The chain is: measured (MB) >= certified (RA Bill cumulative_qty)
                >= billed (this_bill_qty after deductions/holds).

Reasons for choosing Model A over auto-creation:
- MB and RA Bill have different approvers (site engineer vs. finance)
- One MB period may generate multiple RA Bills, or one RA Bill may span
  multiple MB periods
- Matches Indian CPWD/PWD practice

### Per-WO toggle: `use_measurement_book` (Check, on Civil Work Order)

Not every WO will use MB. Smaller renovations (toilet block, badminton
court) don't justify the overhead; larger projects (new hostel, academic
block) benefit from it.

- Civil Work Order gets a new field `use_measurement_book` (Check, default
  off) added in Phase 2.
- If ON: RA Bills for this WO pull cumulative_qty from MB. The cumulative_qty
  field on RA Bill Item becomes read-only (or shown as "MB measured: X" with
  user-editable certified value bounded by MB sum).
- If OFF: RA Bills accept manual cumulative_qty entry (current Phase 1
  behavior). MB is not consulted.

Implementation impact on Phase 1 code:
- Civil RA Bill controller's `populate_items_from_boq` gains a branch:
    if wo.use_measurement_book:
        cumulative_qty = sum_mb_entries_for_boq_item(boq_item, up_to=bill_date)
    else:
        cumulative_qty = previous_cumulative_qty   # user enters manually
- Civil RA Bill before_submit gets a new validation:
    if wo.use_measurement_book:
        for each item: assert cumulative_qty <= MB sum for that BOQ item
- A "Refresh from MB" button on draft RA Bills, for WOs with toggle on.

Phase 1 RA Bills entered manually before MB module exists are unaffected.
The toggle defaults off, so existing data behaves as it always did.

## Print format design philosophy — summary vs detail layers

Documents in this app have a deliberate two-layer structure:

LAYER 1 (page 1) — Summary view, contract-level
- Summary heads (service Items from "Work Order Items" group)
- Lump-sum amount per head
- NO quantity column, NO UOM column displayed
- Internally each summary line has qty=1 and uom=Nos for accounting,
  but these are suppressed in print output (would read "1 Nos" which
  is meaningless to the reader)
- Reads like a contract page — what executives, contractors, and
  finance staff sign off on

LAYER 2 (page 2 onwards) — Detail view, engineering-level
- BOQ items grouped under their summary head as section headings
- Full proper engineering units (Cubic Meter, Square Meter, Meter,
  Quintal, Brass, etc. — RGI's full-name UOM convention)
- Item number, description, UOM, qty, rate, amount columns
- Reads like a measurement sheet — what site engineers and contractors
  use to verify work and bill against

This pattern applies consistently across:
- Civil Work Order printout
- Civil Work Order BOQ printout (if printed standalone)
- Work Order RA Bill printout (summary deductions on page 1, detailed
  measurements on page 2+)
- Purchase Invoice generated from RA Bill (single line per summary head
  with description aggregating BOQ details, qty/uom suppressed in print
  override)

Print formats are not yet built (Phase 2/3). This design is captured
here so when print format work begins, the pattern is consistent and
not invented per-document.

## Phasing context (informational, do not act on this now)
The build will proceed in numbered steps:
- Step 1 (this one): app scaffold + memory
- Step 2: Civil Works Settings (single doctype with defaults)
- Step 3: Civil Work Order + Summary Item child + Terms section
- Step 4: Civil Work Order BOQ + BOQ Item child
- Step 5: Civil RA Bill + RA Bill Item + RA Bill Deduction
- Step 6: Purchase Invoice integration (Get Items From RA Bill button)
- Later: Amendments, Measurement Book, Final Bill, DLP, FIM, reports

Each step will arrive as its own prompt. Wait for the next prompt before doing anything beyond the current step's scope.

## Known environment quirks
- `bench migrate` previously failed during `sync_fixtures` due to three sibling apps
  (hsc_master_inhouse, pipe_laying_inhouse, purchase_register) exporting a
  `Welcome Workspace` Workspace fixture with `type: null`, which violated the
  mandatory `type` field in this Frappe version.
- Fix applied: patched `type` to "Workspace" in each app's
  `fixtures/workspace.json`. Diff is uncommitted in those three apps' repos
  pending upstream cleanup.
- If migrate ever fails again with `MandatoryError: [Workspace, Welcome Workspace]: type`,
  re-check those three fixture files first — an upstream pull may have reverted
  the patch.
- Side note: those three apps probably shouldn't be exporting `Welcome Workspace`
  at all (it's a Frappe core artifact). A proper fix is to remove that entry
  from their fixture exports — flagged for later cleanup, not urgent.


## Static asset path convention (Frappe app layout)

Static JS, CSS, images for an app live at the 2-LEVEL path:
  apps/<app_name>/<app_name>/public/js/...
  apps/<app_name>/<app_name>/public/css/...

NOT at the 3-level path under the module folder. The 3-level structure is
exclusive to doctypes, reports, print_formats — i.e., things scoped to a
specific Module within the app. `public/` is app-scoped and lives one level
above modules.

Concrete path on this app:
  apps/dux_civil_works/dux_civil_works/public/js/purchase_invoice.js   (correct)
  NOT: apps/dux_civil_works/dux_civil_works/dux_civil_works/public/...

The hooks.py reference uses the relative path from the inner package:
  doctype_js = {"Purchase Invoice": "public/js/purchase_invoice.js"}

## Parking convention for in-progress / wrong-architecture files

When work-in-progress code on disk is determined to be architecturally
wrong but contains reusable parts, PARK rather than delete:
- Rename the file from `<name>.py` to `<name>.py.parked` so Python cannot
  import it
- Leave matching JS / hooks references alone if they are themselves unwired
  and inert (the JS file isn't loaded; hooks.py isn't pointing at it). They
  become coupled-but-dormant references that will be updated together when
  the work is redone.
- A grep audit during cleanup MAY surface JS string-literal references to
  parked Python methods. These are benign as long as:
    1. hooks.py does NOT bind the JS file (no doctype_js / doc_events for it)
    2. The Python file is .parked (so frappe.call cannot resolve it even if
       invoked)
- Do NOT rename .parked files back to .py without explicit user direction
  AND a corresponding rewrite of the architecturally-wrong portion.

## Step 6 (PI integration) — parked architecture note

A first attempt at Step 6 was interrupted mid-way because the architecture
was wrong: the items-fetch function assumed PI lines map 1:1 to RA Bill
items via a single dummy Item. The correct model is one PI line per distinct
summary_head Item (a service Item from an Item Group called "Work Order
Items"). The corrective sequence is Pre-Step 6a → 6b → 6c → revised Step 6.

Files in parked state on disk (do not activate without explicit user
direction and rewrite of the wrong portion):
  apps/dux_civil_works/dux_civil_works/api/purchase_invoice.py.parked

This file contains two correct functions (get_open_ra_bills,
get_referenced_ra_bills_summary) and one architecturally-wrong function
(get_items_from_ra_bills). When the revised Step 6 is built:
- Lift the two correct functions from the parked file
- Rewrite get_items_from_ra_bills to group RA Bill items by summary_head
  Item and produce one PI line per distinct Item with description aggregation
- Update the 3 frappe.call method-path strings in
  public/js/purchase_invoice.js to match the new API module shape

Other inert artifacts also kept on disk pending revised Step 6:
- apps/dux_civil_works/dux_civil_works/api/__init__.py (empty, intentional)
- apps/dux_civil_works/dux_civil_works/public/js/purchase_invoice.js
  (correct picker logic, currently unwired in hooks.py)
- 3 new methods on work_order_ra_bill.py (refresh_invoiced_amount and
  helpers) — will be called by the revised Step 6's hooks


## UOM convention for civil works (CORRECTED — supersedes any prior note)

RGI's production UOM master uses FULL NAMES for civil engineering units,
not Indian abbreviations:

  Cubic Meter   (NOT Cum)
  Square Meter  (NOT Sqm)
  Meter         (NOT Mtr / Rmt)
  Square Foot   (NOT Sqft / Sft)
  Kg            (RGI master spelling, lowercase 'g')
  Quintal, Tonne, Brass, Litre, Nos, Lump Sum, Day, Kilometer

All verification scripts, BOQ test data, sample WOs, and any RGI-facing
documentation must use these full names. Earlier notes in this file
that suggested using `Cum`/`Sqm`/etc. were based on industry-general
convention; RGI specifically standardized on full names.

The 12 UOMs the app requires are shipped as a fixture in
apps/dux_civil_works/dux_civil_works/fixtures/01_uom.json. They are
imported on every `bench migrate`. RGI production already has these
12 (and 200+ more); the dev site gets them via the fixture.

DO NOT add Indian abbreviations (Cum, Sqm, Rmt) to either the fixture
or the production UOM master. RGI's chosen convention is full names.

## App-shipped fixtures (master data the app requires)

The app ships these fixtures, imported on every `bench migrate`. The
filenames are numeric-prefixed because Frappe imports fixture JSONs
ALPHABETICALLY BY FILENAME, NOT in the order declared in the
`fixtures` directive in hooks.py. The `fixtures` directive controls
EXPORT order (when running `bench export-fixtures`), not import order.
This is a known Frappe v16 gotcha — always prefix fixture filenames
when ordering matters.

1. 01_uom.json — 12 UOM records
2. 02_item_group.json — 1 Item Group: "Work Order Items"
3. 03_item.json — 12 service Items, all in Work Order Items group,
   stock_uom = Nos, is_stock_item = 0, is_purchase_item = 1,
   is_sales_item = 0

Why these are app-shipped (vs user-curated):

- UOMs: only the 12 the app's logic and seeded Items reference. RGI's
  production master has 200+ UOMs, all left alone. The fixture only
  declares fields we care about (uom_name, must_be_whole_number); other
  fields like symbol and common_code are NOT declared, so RGI's existing
  symbol values for these UOMs survive subsequent migrates.

- Item Group: app logic filters summary_head pickers by this group name.
  If the group is missing or renamed, the app breaks. Always-present
  via fixture is the safest design.

- Items: serve as summary_head values on Civil Work Orders. Their key
  attributes (item_group, stock_uom, is_stock_item, is_purchase_item,
  is_sales_item) are app-correctness invariants — fixtures enforce them
  on every migrate. RGI can edit description, default_warehouse,
  default_supplier, etc. freely; those fields are NOT in the fixture
  and survive.

### india_compliance gotcha — `gst_hsn_code` AttributeError on Item fixture

The `india_compliance` app installed on this site adds a `validate` hook
on Item that calls `set_taxes_from_hsn_code(doc)`. That function reads
`doc.gst_hsn_code` directly. On Frappe v16's fixture import path, an
Item document constructed from a JSON fixture does NOT have attributes
populated for fields absent from the JSON, even if those fields exist
in the doctype's meta as Custom Fields. The result is an `AttributeError:
'Item' object has no attribute 'gst_hsn_code'` mid-import.

Workaround used in 03_item.json: every Item entry includes
`"gst_hsn_code": ""`. The `validate_hsn_code` part of the hook returns
early because our Items have `is_sales_item: 0`, and
`set_taxes_from_hsn_code` short-circuits because `doc.gst_hsn_code` is
empty. No real HSN code needed.

If a future site has additional india_compliance custom fields whose
absence raises AttributeError on Item insert, add them to 03_item.json
with empty defaults too. This will be revisited if the same issue
appears with another custom-field-adding app.

### Adding / retiring fixture-shipped Items

Adding a new service Item: add it to fixtures/03_item.json with the same
field set (including `"gst_hsn_code": ""`). It becomes available on the
next `bench migrate`. RGI can also create new service Items via the
standard ERPNext Item form, provided they place the new Item in
"Work Order Items" group — those user-created Items are not in the
fixture and persist across migrates (fixture import only touches
records matching its filter).

DO NOT delete a shipped service Item via the Item form — fixture
import will recreate it on next migrate. To retire a service Item,
mark `disabled: 1` in the fixture file itself.
