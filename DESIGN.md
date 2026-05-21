# DESIGN.md — dux_civil_works

Architectural reference for the dux_civil_works Frappe app. Read this for
"what this app does and why it's shaped this way." For operational rules
on safely modifying the app (console pattern, reload procedure, Frappe
gotchas, rename procedure, etc.), see CLAUDE.md.

This document is the source of truth for design decisions. CLAUDE.md
records the rules that follow from those decisions. When the two appear
to conflict, this document is authoritative; CLAUDE.md gets updated to
match.

## 1. Purpose

`dux_civil_works` manages civil works contracts end-to-end: from awarding
a Work Order to a contractor, through field-measured progress billing
(Running Account Bills), through invoicing those bills as Purchase
Invoices in ERPNext's accounting layer.

Primary client: Raisoni Group of Institutions (RGI), a multi-company
educational group operating ~59 institutions across India. RGI builds
and maintains campus infrastructure continuously and contracts hundreds
of civil works engagements per year across its institutions.

The app is built to be reusable beyond RGI. As of Phase 1.5
(2026-05-18), all doctypes use the `Work Order` prefix (e.g.
`Work Order Contract`, `Work Order RA Bill`, `Work Order BOQ Item`),
chosen to be organisation-neutral. The original RGI-internal `Civil`
prefix was replaced in the Phase 1.5b consolidated rename pass; the
last holdout, `Civil Work Order BOQ`, was deleted in Phase 1.5c.2 when
its rows folded into `Work Order Contract`. See Section 8 (Phase 1.5
refactor — delivered).

## 2. Scope

### In scope (Phase 1, complete)
- Work Order creation with multi-summary-head pricing
- BOQ (Bill of Quantities) creation with detailed line items per
  summary head
- Mobilization advance tracking via Work Order Advance Register
- Running Account Bill (RA Bill) creation with auto-populated items
  from BOQ, cumulative-quantity tracking, auto-suggested deductions
  (retention, mobilization recovery, TDS, labour cess, etc.), and
  bill submission
- Purchase Invoice integration: "Get Items From RA Bill" picker that
  produces PI lines grouped by service Item, with cap enforcement
  against RA Bill net payable and an override path for accountants

### Deferred to Phase 2 / Phase 3
- BOQ amendment handling (rate changes, qty additions beyond
  deviation, new items, deleted items)
- Civil Measurement Book (MB) doctype with per-WO toggle, enabling
  MB-driven cumulative quantity computation on RA Bills
- Extra Items doctype (work outside the original BOQ)
- Final Bill, Defect Liability Period, Final Inspection Memorandum
- Performance Bank Guarantee tracking
- Payment Voucher integration (RGI's custom outflow doctype) wiring
  into Work Order Advance Register
- Print formats (Work Order, RA Bill, PI overrides)
- Workflow approvals
- Variation Order report (diff between original and amended WO)
- Consolidated rename pass (Civil-prefix doctypes to
  organisation-neutral names)

### Explicitly out of scope
- Material reconciliation (consumption-based) — handled via separate
  material recovery deduction on RA Bills, not a full reconciliation
  flow
- Site-attendance / muster-roll tracking
- Subcontractor management (treated as standard Suppliers)
- Inventory / stock movement (these are civil services, not materials)

## 3. Core domain model

### 3.1 The chain of documents

```
Work Order Contract
   │
   ├─ Work Order Summary Item (child — auto-derived from BOQ rows)
   ├─ Work Order BOQ Item (child — detailed lines per summary head;
   │                        each row carries a stable boq_row_uid)
   ├─ Work Order Contract Terms section (retention, mob advance, DLP, etc.)
   │
   └──> Work Order RA Bill (N:1 with Work Order Contract)
              │
              ├─ Work Order RA Bill Item (child — populated from wo.boq_items;
              │                            each carries boq_row_uid for cumulative
              │                            qty continuity across WO amendments)
              ├─ Work Order RA Bill Deduction (child)
              │
              └──> Purchase Invoice (N:M with RA Bill)
                         via "Get Items From RA Bill" picker

Work Order Advance Register (1:1 with Work Order Contract)
   │
   ├─ Work Order Advance Tranche (child — manual entry in Phase 1,
   │                          Payment Voucher hook in Phase 2)
   └─ Work Order Advance Recovery (child — auto-posted from RA Bills)
```

### 3.2 Doctype catalogue (post-Phase-1.5c.2)

11 doctypes total (post-1.5c.2; was 12 — `Civil Work Order BOQ` was
deleted when BOQ rows folded into Work Order Contract). All doctypes
use the `Work Order` prefix; the consolidated rename pass landed in
Phase 1.5b (2026-05-18). Work Order RA Bill was renamed during the
pilot rename (2026-04-29) that validated the v16 rename procedure.

| Doctype | Kind | Purpose |
|---|---|---|
| Work Order Settings | Single | App-wide defaults: retention %, deviation limit, per-company GL accounts |
| Work Order Company Account | Child | Per-company expense/retention/advance accounts |
| Work Order Contract | Submittable parent | Contract with a contractor; embedded BOQ; auto-aggregated summary; terms |
| Work Order Summary Item | Child | Per-summary-head amount on a WO (auto-derived from `boq_items`) |
| Work Order BOQ Item | Child | Detailed BOQ line embedded in Work Order Contract; carries `boq_row_uid` (stable across WO amendments) |
| Work Order Advance Register | Standalone | Per-WO mobilization advance tracker |
| Work Order Advance Tranche | Child | An advance paid in (Phase 1: manual; Phase 2: from Payment Voucher) |
| Work Order Advance Recovery | Child | An advance recovered out (auto-posted from RA Bill submit) |
| Work Order RA Bill | Submittable parent | Running Account Bill; one bill per measurement event/period; reads BOQ from parent WO via `wo.boq_items` |
| Work Order RA Bill Item | Child | Per-BOQ-line cumulative quantity and this-bill amount; references source BOQ row via `boq_row_uid` for amendment-safe lookup of previous cumulative qty |
| Work Order RA Bill Deduction | Child | Retention, recoveries, taxes, cess — auto-suggested and editable |

### 3.3 Key relationships

- `Work Order Contract` is the contract identity. Everything else hangs off it.
- BOQ rows live ON Work Order Contract directly (child table `boq_items`).
  The separate Civil Work Order BOQ doctype existed in Phase 1 but was
  deleted in Phase 1.5c.2 — see Section 8. The `summary_items` table on
  the WO is auto-derived from `boq_items` grouped by `summary_head`; WO
  total equals BOQ total by construction.
- `Work Order RA Bill` references the Work Order Contract directly via
  `civil_work_order` (Link field). Each RA Bill is one billing event;
  a WO accumulates many RA Bills over its life. RA Bill items reference
  the source BOQ row via `boq_row_uid` (stable across WO amendments).
- `Purchase Invoice` is N:M with RA Bills: one PI can reference multiple
  RA Bills (typical when invoicing a month's bills together), and one RA
  Bill can be invoiced across multiple PIs (typical when partial invoices
  are issued).
- `Work Order Advance Register` is 1:1 with the WO and is the single source of
  truth for "how much advance has been paid and recovered against this WO."

## 4. Key architectural decisions

This section captures the rationale behind shape choices. Each decision is
labeled with status (Locked / Phase 1.5 refactor pending / Phase 2 / etc.).

### 4.1 Single Work Order document with summary + BOQ in one form
**Status:** Locked (Phase 1.5 delivered — commits 2e6f5cf (additive), and
the BOQ doctype was deleted in Phase 1.5c.2; both flows no longer
coexist).

The user enters BOQ rows directly on the Work Order Contract form. The
form layout places BOQ Items FIRST (where the user actually works), with
the Work Order Summary appearing below as a read-only, auto-aggregated
roll-up. The summary cannot be edited directly — to change a summary
amount, edit the BOQ rows above it. This eliminates the double-entry
problem of the original two-document design and makes WO total ≡ BOQ
total by construction.

The print format renders the summary on page 1 and the detailed BOQ from
page 2 — matching the form layout — see Section 4.6.

### 4.2 Summary heads are real Items, filtered to a dedicated Item Group
**Status:** Locked.

Each summary line on a WO references a service Item (e.g. "Civil
Construction", "Plumbing Works") from an Item Group called "Work Order
Items". The app ships 12 starter service Items as fixtures.

Rationale:
- Enables PI line grouping (one PI line per service Item, with multiple
  BOQ rows aggregated in the line's description) — see Section 4.5
- Provides a controlled vocabulary for summary heads (vs free-text strings)
- Allows tight validation (server-side link filter + controller checks)
- Lets RGI add new service Items via standard ERPNext Item form, in the
  same group, without needing app changes

The `summary_head` field on Work Order Summary Item, Work Order BOQ Item,
and Work Order RA Bill Item is a Link → Item with server-side filter
`item_group = "Work Order Items"`. Disabled items are also rejected.

### 4.3 Cumulative-quantity model for progress billing
**Status:** Locked (Phase 1); refined in Phase 2.

RA Bills track work done by **cumulative quantity** per BOQ line, not by
delta. Each RA Bill records `cumulative_qty` (work done from project start
to bill_date) for each BOQ item; the bill's chargeable quantity is
`cumulative_qty − previous_cumulative_qty` from the prior submitted bill.

Rationale:
- Matches Indian CPWD/PWD practice
- Lets contractors and clients verify "total measured to date" at any
  point — a continuous record vs a sequence of deltas to reconcile
- Survives RA Bill cancellation/amendment cleanly (cancellation removes
  one row from the chain; the next bill simply re-reads the now-current
  cumulative)
- Will integrate naturally with the Phase 2 Measurement Book (MB
  cumulative sum drives RA Bill cumulative_qty)

### 4.4 Deviation enforcement at submit, not save
**Status:** Locked.

Each BOQ row has a deviation limit (default 5%, per-row configurable).
RA Bill submit checks that no BOQ item's `cumulative_qty` exceeds
`estimated_qty × (1 + deviation_limit_pct/100)`. Save is permitted (so
users can draft freely); submit blocks until either the qty fits or the
WO is amended.

Beyond deviation, the user must amend the WO. This is the contract-control
point — quantities can't silently exceed sanctioned scope.

A known bug: deviation_limit_pct currently rejects 0 because of a truthy
check rather than an explicit-None check. **Fix scheduled in Phase 1.5.**
A 0% limit is a valid user choice — meaning "no deviation; always amend
for any qty change."

### 4.5 PI lines are grouped by service Item, not 1:1 with BOQ rows
**Status:** Locked.

When the user clicks "Get Items From RA Bill" on a Purchase Invoice, the
server returns ONE PI line per distinct summary_head Item per source RA
Bill — not one PI line per BOQ row. A single RA Bill spanning N summary
heads becomes N PI lines.

Each PI line:
- `item_code` = the service Item (e.g. "Civil Construction")
- `qty = 1`, `uom = Nos`, `rate = allocated_net` (the line's share of the
  bill's net_payable, allocated proportionally to its share of gross)
- `description` aggregates the underlying BOQ rows (first 5 with full
  detail, then "...and N more rows totaling ₹X")
- `wo_ra_bill_item` = comma-joined names of all source RA Bill Item rows
  (for traceability)

Rationale:
- A PI with 100+ BOQ-row-level lines would be unmanageable for the
  accounts team
- The contract-level view (service Item + amount) is what GL accounting
  cares about; BOQ-row detail belongs in the description for audit
- The summary/detail layering matches the print format philosophy
  (Section 4.6)

The qty=1 and uom=Nos are accounting bookkeeping; they are **suppressed
in print output** since "1 Nos" would be meaningless to read.

### 4.6 Print format philosophy: summary on page 1, detail on page 2+
**Status:** Locked design; not yet implemented (Phase 2/3).

Every contract document in this app prints with two layers:

**Layer 1 (page 1) — Summary view, contract-level**
- Summary heads + lump-sum amount per head
- No quantity column, no UOM column
- Reads like a contract signature page

**Layer 2 (page 2+) — Detail view, engineering-level**
- BOQ items grouped under their summary head
- Full proper engineering units (Cubic Meter, Square Meter, Meter, etc.)
- Item number, description, UOM, qty, rate, amount columns
- Reads like a measurement sheet

This applies to Work Order Contract (whose print format will render
the summary on page 1 and the embedded BOQ from page 2), Work Order
RA Bill, and to Purchase Invoices generated from RA Bills (the
suppress-qty-uom override on PI line printing).

The suppression marker is the conjunction of `is_stock_item = 0` AND
`stock_uom = "Nos"` on the source Item — this identifies a service-Item
summary line distinct from a measurable BOQ row.

### 4.7 BOQ changes via Variation Order doctype (deferred to Phase 2)
**Status:** Phase 2 (deferred); architecture locked. Supersedes the
earlier decision to use Frappe's native amend cycle, which was
based on flawed reasoning.

When a BOQ needs to change after WO submit — rate revision, qty
addition beyond deviation, new item, deleted item — the user creates
a **Work Order Variation** document that references the parent WO
Contract. The variation lists deltas: added BOQ rows, modified rows
(with old/new qty or rate), deleted rows (with reference to the
original `boq_row_uid`).

The original WO Contract stays unchanged in the database. Each
approved Variation accumulates alongside it. The "current BOQ state"
of a WO is the original BOQ plus all approved variations. RA Bills
compute their items by walking this union; the `boq_row_uid` field
on each row remains stable across variations.

Rationale (after re-evaluation of the originally-locked amend-cycle
decision):

- **Matches industry practice exactly.** Government contracts (CPWD,
  PWD) and private construction universally use change orders / variation
  orders as ADDITIVE deltas to the original contract, never as a
  replacement of the original. The original WO is sacred.
- **Avoids cascade cancellation.** Frappe's amend cycle requires
  cancelling the WO, which cascades through linked RA Bills and
  Purchase Invoices — all downstream documents must be cancelled
  first, then re-created against the new WO. This is operationally
  painful for mid-contract scope changes (the common case at RGI).
  The Variation Order model leaves all downstream documents
  unaffected; RA Bills against the original WO continue to function.
- **Captures intent better.** "VO-1 adds 30 cum of concrete; VO-2
  deletes paving; VO-3 increases plumbing scope" reads like a real
  construction record. Frappe's amend produces "WO-2026-0009-1,
  WO-2026-0009-2" which doesn't convey what changed.
- **Supports incremental approvals.** Each variation gets its own
  approval workflow. RGI's engineering hierarchy can sign off on
  each VO independently. This is impossible with the
  amend-the-whole-WO approach.
- **Audit trail is cleaner.** The original WO and each approved VO
  are all live, queryable, and printable records. With Frappe's
  amend cycle, prior versions are cancelled — present in DB but
  flagged docstatus=2, which is correct but harder to reason about.

#### Architectural sketch (Phase 2 implementation)

A new doctype `Work Order Variation`:
- Submittable parent
- Links to parent Work Order Contract
- Child table of "variation lines" — each line is either:
  - ADD: a new BOQ row to introduce (with item_no, summary_head,
    description, uom, qty, rate, deviation_limit_pct)
  - MODIFY: changes to an existing BOQ row, referenced by
    `boq_row_uid`, with new qty / new rate / new deviation_limit
  - DELETE: marks an existing BOQ row (by `boq_row_uid`) as removed
    going forward; historical RA Bills against that row remain valid
- Each variation has its own `variation_number` (1, 2, 3...) per parent WO
- On approval/submit: a controller hook updates the WO Contract's
  derived `current_boq_state` (a computed view, not a stored field)
  by replaying variations in order
- RA Bill's `populate_items_from_boq` is updated to read from
  `current_boq_state` (which = original BOQ + ADD lines − DELETE
  lines, with MODIFY lines applied to qty/rate)

#### What `boq_row_uid` does for this architecture

The `boq_row_uid` field added to Work Order BOQ Item in Phase 1.5c.1 is
the linchpin. Variations reference BOQ rows by UID, not by row name or
item_no, so a variation's "modify row" or "delete row" instruction
remains unambiguous even if the user later renumbers item_no for
display purposes. RA Bill Items also reference rows by UID, so
cumulative quantity history threads cleanly through variations.

#### What this means for Phase 1 / the dry-run period

Until the Work Order Variation doctype is built (Phase 2), WO
amendments are not supported through proper channels. The
operational rule for the RGI dry-run:

- A WO Contract MUST NOT be amended (cancelled + amended via
  Frappe's native cycle) once any RA Bill has been generated
  against it. The cascade cancellation would invalidate the RA
  Bills and Purchase Invoices, requiring manual rebuild.
- Pre-RA-Bill corrections (typos in contractor name, address, etc.)
  CAN use Frappe's amend cycle safely.
- Mid-contract scope changes during the dry-run period are
  out-of-scope. Note them; the Phase 2 VO doctype handles them
  properly.

This is a temporary Phase 1 constraint and is also recorded in
Section 7 (Known limitations).

### 4.8 Retention release split
**Status:** Locked.

Retention is deducted at 5% per RA Bill (per-WO override possible). On
Final Bill, configurable percentage of the accumulated retention is
released; the remainder is released after the Defect Liability Period
(DLP) expires. Default split is 50/50.

The split percentages are validated to sum to exactly 100% (Phase 1
controller validation).

### 4.9 Auto-suggested deductions on RA Bill
**Status:** Locked.

When an RA Bill is created or refreshed, the controller auto-populates
the deductions table with:
- Retention (per-WO %)
- Mobilization Recovery (per-WO %, capped at outstanding advance balance)
- Material Recovery (per-WO %)
- Labour Cess (if enabled in WO terms)
- TDS (via standard ERPNext Tax Withholding category, applied at the
  WO/Supplier level)

All amounts are editable by the user. The deductions table is the single
control point for "what's deducted from this bill"; the WO terms section
seeds the suggestions but doesn't lock them.

### 4.10 PI cap enforcement with override path
**Status:** Locked.

On every Purchase Invoice save where `is_wo_ra_bill_invoice = 1`, the
`pi_validate` hook enforces: total invoiced (this PI + all other submitted
PIs referencing the same RA Bill) ≤ the RA Bill's `net_payable`.

If the cap is exceeded:
- A user with role `Accounts Manager` or `System Manager` AND a non-empty
  `wo_ra_bill_override_reason` field can save anyway; an audit msgprint
  records the override
- Any other user, or missing override reason, is blocked at save

This handles the real case where finance bills slightly more than
certified pending a formal WO amendment — common in long contracts where
amendment paperwork lags execution.

## 5. Fixture-shipped master data

The app ships three categories of master data as Frappe fixtures, imported
on every `bench migrate`:

1. **12 UOMs** in `fixtures/01_uom.json`: Nos, Lump Sum, Cubic Meter,
   Square Meter, Meter, Kilometer, Quintal, Tonne, Brass, Kg, Litre, Day.
   These are the minimum UOMs the app's seeded service Items and typical
   BOQ rows require. RGI production has 200+ UOMs; our fixture only
   declares the 12 we need, leaving the rest of RGI's UOM master
   untouched.

2. **1 Item Group** in `fixtures/02_item_group.json`: "Work Order Items".
   The app's `summary_head` Link pickers filter by this group name. If
   the group is missing, the app breaks. Always-present via fixture.

3. **12 service Items** in `fixtures/03_item.json`: Civil Construction,
   Plumbing Works, Electrical Works, Finishing Works, External Works,
   Annual Maintenance Contract, Manpower Services, Transportation
   Services, IT Services, Equipment Hire, Repair And Maintenance, Other
   Services. All have `stock_uom = Nos`, `is_stock_item = 0`,
   `is_purchase_item = 1`, `is_sales_item = 0`.

The fixtures use numeric filename prefixes (01_, 02_, 03_) because Frappe
v16 imports fixtures in **alphabetical filename order**, ignoring the
hooks.py declaration order — a known v16 gotcha. The prefix enforces the
dependency order: UOMs must exist before Items can reference them via
stock_uom, and the Item Group must exist before Items reference it via
item_group.

For deeper notes on fixture conventions, gotchas, and the
`gst_hsn_code` workaround for india_compliance compatibility, see
CLAUDE.md "App-shipped fixtures" and related sections.

## 6. Integration boundaries

### 6.1 With ERPNext core
- **Purchase Invoice**: standard doctype, extended with 4 header fields
  + 2 line fields (all custom fields). Hooks: validate, on_submit,
  on_cancel.
- **Item**: read-only consumer. The app seeds Items in a dedicated Item
  Group; never modifies user-created Items.
- **UOM**: read-only consumer. The app seeds 12 UOMs; never modifies
  user-created UOMs.
- **Company**: read-only consumer. Per-company expense/retention/advance
  accounts are configured in Work Order Settings via a child table.

### 6.2 With RGI-specific apps
- **dux_voucher (Payment Voucher)**: not yet integrated. RGI uses
  Payment Voucher (not standard Payment Entry) as the primary outflow
  document. Phase 2 will wire Payment Voucher to auto-create Civil
  Advance Tranches on submit and remove them on cancel. See CLAUDE.md
  "DEFERRED: Payment Voucher integration" for the locked design.
- **india_compliance**: compatibility-only. Our Item fixtures include
  `gst_hsn_code: ""` to bypass india_compliance's validate hook
  AttributeError. No other interaction.
- Other apps installed on the bench may add hooks to standard doctypes —
  see CLAUDE.md "Multi-app bench installed" for the diagnostic approach
  when a standard-doctype validation surprises us.

### 6.3 With external systems
- None in Phase 1. Phase 2/3 may add Performance Bank Guarantee tracking
  (likely an internal doctype, not an external integration).

## 7. Known limitations and open questions

### Limitations (acknowledged, scoped for later)
- No Measurement Book — cumulative quantities are manually entered on RA
  Bills. Acceptable for smaller projects; needed for larger ones.
- No BOQ amendment workflow — Phase 2 will add this via a dedicated
  Work Order Variation doctype (additive deltas to the original WO,
  not contract replacement). See Section 4.7 for the locked
  architecture.
- WO Contract cancellation/amendment cascades through linked RA
  Bills and Purchase Invoices. During the Phase 1 / dry-run period,
  do not amend a WO once any RA Bill exists against it — wait for
  Phase 2's Work Order Variation doctype, which adds scope changes
  without modifying the original WO. See Section 4.7 for the locked
  Phase 2 architecture.
- No print formats — Phase 2/3.
- No workflow approvals — Phase 2/3.
- Material recovery is a single deduction line; no consumption-based
  reconciliation.
- Work Order Advance Register doesn't yet auto-sync with Payment Voucher;
  tranches are manual until Phase 2.

### Open questions (not yet decided)
- ~~Should the app expose a "Variation Order" report that diffs the
  original WO against the current amended WO?~~ — Resolved: Phase 2
  introduces a Work Order Variation doctype (Section 4.7). The
  variations themselves ARE the change record; no separate diff
  report is needed. The original WO remains unchanged across
  variations, eliminating the "what does 'original' mean" complexity.
- Should retention release be a manual document (Retention Release Voucher)
  or an automatic action on Final Bill / DLP expiry?
- For multi-supplier WOs (rare but possible — joint contracts), is the
  current single-supplier model acceptable, or do we need a Supplier
  child table?

## 8. Phase 1.5 refactor (delivered)

**Status: COMPLETE as of 2026-05-18**, across three commits:
- **1.5a** (commit 90b6dc1) — refactor plan document landed in
  `docs/phase_1_5_refactor_plan.md`.
- **1.5b** (commit 3e9bfb0) — consolidated rename pass: 10 doctype renames
  + module rename + PI custom field reattribution.
- **1.5c.1** (commit 2e6f5cf) — additive: added `boq_items` to Work Order
  Contract + `boq_row_uid` on Work Order BOQ Item; both old and new flows
  coexisted briefly.
- **1.5c.2** (this commit) — subtractive + bug-fixes: deleted Civil Work
  Order BOQ doctype; Work Order RA Bill now reads BOQ from Work Order
  Contract directly; 0% deviation rejection bug fixed; smoke test
  rewritten for single-document model.

### 8.1 Collapse Civil Work Order BOQ into Work Order Contract — DONE
The two-document split caused user confusion (entering same data twice)
and reconciliation drift (WO total vs BOQ total could diverge).

After Phase 1.5:
- Work Order Contract absorbs the BOQ via the `boq_items` child table.
- The summary table on the WO is **read-only and auto-aggregated** from
  BOQ rows (group by summary_head, sum amount). WO total ≡ BOQ total
  by construction.
- Civil Work Order BOQ doctype has been deleted (Phase 1.5c.2).
- Work Order RA Bill's `civil_work_order_boq` Link field has been removed;
  the bill reads BOQ rows directly from the parent Work Order Contract.

### 8.2 Add boq_row_uid for amendment continuity — DONE
- Each BOQ row carries a hidden `boq_row_uid` UUID field, generated on
  insert (Phase 1.5c.1) and ensured present at validate time by the
  parent Work Order Contract controller (since child `before_insert`
  doesn't reliably fire during parent insert).
- Work Order RA Bill Item references this UID (Phase 1.5c.2). The
  controller's `_get_previous_cumulative_qty` queries by UID so that
  cumulative quantity history threads cleanly through the Phase 2
  Work Order Variation model (Section 4.7) — variations reference
  existing BOQ rows by UID, never by row name or item_no.

### 8.3 Bug fixes — DONE
- `deviation_limit_pct` now honors explicit 0 as "strict, no deviation
  allowed". The buggy `in (None, 0)` check from the deleted Civil Work
  Order BOQ controller is gone; the new `_set_default_boq_deviation_limits`
  on Work Order Contract uses `is None` explicitly.
- BOQ row `amount` visible in the child table (in_list_view=1 confirmed).
- Percent-field audit: only legitimate `(X or 0) > 0` patterns remain
  (checking "is this percentage greater than zero" — 0 correctly disables
  the deduction).

### 8.4 Regression coverage — DONE
- `scripts/regression_smoke_test.py` rewritten for the single-document
  model. Exercises embedded BOQ, summary auto-aggregation, boq_row_uid
  propagation through RA Bill, 0% deviation enforcement (bug-fix canary),
  5% default deviation enforcement, amend canary, and register reverse-
  on-cancel. ALL PHASES PASSED post-1.5c.2.

## 9. Future work (Phase 2 / Phase 3)

### Completed work

- **Phase 1.5** — single-document refactor + consolidated rename pass.
  DONE in commits 90b6dc1 (plan), 3e9bfb0 (rename), 2e6f5cf (additive
  embedding), and Phase 1.5c.2 (deletion + bug fixes).

### Priority order from here

1. **RGI dry-run** at one institution — pick a small project, exercise
   the post-1.5 build end-to-end, collect feedback before further work.
2. **Phase 2: Work Order Variation doctype** — additive scope changes
   to a submitted WO without modifying or cancelling it (added /
   modified / deleted BOQ rows recorded as deltas; original WO stays
   sacred; RA Bills compute current state by walking WO + approved
   variations). See Section 4.7 for the locked architecture. Critical
   for mid-contract scope changes common in RGI's workflow, and the
   reason WOs currently can't be amended once any RA Bill exists.
3. **Phase 2: Measurement Book** — MB doctype with per-WO toggle;
   MB-driven cumulative quantities on RA Bills (Model A — RA Bill is
   user-initiated, pulls from MB on demand).
4. **Phase 2: Extra Items** — work outside original BOQ. Largely
   subsumed by the Variation Order doctype (item 2); a "new BOQ row"
   variation IS an extra item. Keep as a tracking row in case any
   sub-feature falls outside the VO model.
5. **Phase 2: Payment Voucher integration** — Work Order Advance Register
   auto-sync with the dux_voucher app's Payment Voucher.
6. **Phase 2/3: Final Bill, DLP, FIM, PBG** — end-of-project documents.
7. **Phase 2/3: Print formats** — all documents, per the summary/detail
   philosophy.
8. **Phase 2/3: Workflow approvals** — Maker-Checker on WO and RA Bill.

## 10. Document map

| Document | Purpose |
|---|---|
| **DESIGN.md** (this file) | What the app does and why |
| **CLAUDE.md** | How to safely modify the app (procedural rules, Frappe gotchas, conventions) |
| **README.md** | Pointer to the above for new contributors |
| **regression_smoke_test.py** | Executable verification of Phase 1 invariants |

When making structural changes, update DESIGN.md first (capture the
architectural decision and rationale), then CLAUDE.md if needed
(record any operational rule that flows from the decision), then
implement the change.
