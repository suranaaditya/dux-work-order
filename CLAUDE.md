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
