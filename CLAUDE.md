# CLAUDE.md — dux_civil_works

This file is persistent memory for all future work on this app. Read it at the start of every session before touching the app.

## App identity
- App name: dux_civil_works
- Module: Dux Civil Works
- DocType prefix: `Civil` (e.g., Civil Work Order, Civil RA Bill, Civil BOQ Item)
- Publisher: Dutch Digitech
- Purpose: civil works contract management; reusable beyond RGI

## CRITICAL — how artifacts are created (this rule overrides any default Frappe pattern you know)
- ALL DocTypes, Pages, Reports, Print Formats, Dashboards, Workflows, Client Scripts, Server Scripts MUST be created through the Frappe Desk UI (the web interface, accessed by logging into the site as Administrator).
- DO NOT create doctypes by hand-writing JSON files.
- DO NOT use `bench make-doctype`, `bench make-report`, `bench make-page` or similar CLI generators.
- Reason: the Desk Form Builder generates clean and correct `__init__.py`, `<doctype>.json`, `<doctype>.py`, `<doctype>.js` files in the app folder. Past experience on this team shows that any other method causes subtle issues — missing files, wrong module assignments, broken hooks, naming mismatches.
- After a doctype is created in Desk, you may edit the generated `.py` (controller) and `.js` (client script) files freely for custom logic — validations, on_submit handlers, refresh handlers, button handlers.
- NEVER edit a doctype's `.json` file by hand to add/remove/rename fields. Always go back to Desk Form Builder for field changes; it will regenerate the JSON cleanly.
- Developer mode MUST be ON (`developer_mode: 1` in `sites/erp.jewonline.in/site_config.json`) so Desk changes save as files in the app folder, not as database-only customizations.

## Bench CLI commands ALLOWED
- `bench new-app dux_civil_works` (only once, for app creation)
- `bench --site erp.jewonline.in install-app dux_civil_works`
- `bench --site erp.jewonline.in migrate`
- `bench --site erp.jewonline.in clear-cache`
- `bench --site erp.jewonline.in console` (Python REPL for inspection/debugging only)
- `bench restart`, `bench build`, `bench setup requirements`

## Bench CLI commands FORBIDDEN
- `bench make-doctype`, `bench make-report`, `bench make-page`, `bench make-fixtures`
- Any command that auto-generates artifact files outside Desk

## Workflow per artifact (use this pattern every time)
1. Log into Desk on erp.jewonline.in as Administrator
2. Create the artifact through Desk UI (DocType form, Report form, etc.)
3. Save → Frappe writes files into `apps/dux_civil_works/dux_civil_works/<type>/<name>/`
4. Pull those generated files locally
5. Edit `.py` controller / `.js` client script for custom logic
6. Run `bench --site erp.jewonline.in migrate` then `bench --site erp.jewonline.in clear-cache`
7. Test in Desk
8. Git commit

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
