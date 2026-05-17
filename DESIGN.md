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

The app is built to be reusable beyond RGI. Doctype names use a `Civil`
prefix (e.g. `Civil Work Order`, `Civil RA Bill`); these may be renamed
to organisation-neutral names (`Work Order Contract`, etc.) before
broader release — see Section 9 below.

## 2. Scope

### In scope (Phase 1, complete)
- Work Order creation with multi-summary-head pricing
- BOQ (Bill of Quantities) creation with detailed line items per
  summary head
- Mobilization advance tracking via Civil Advance Register
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
  into Civil Advance Register
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
Civil Work Order
   │
   ├─ Civil Work Order Summary Item (child — pricing roll-up)
   ├─ Civil Work Order Terms section (retention, mob advance, DLP, etc.)
   │
   └──> Civil Work Order BOQ (1:1 with WO)
              │
              └─ Civil BOQ Item (child — detailed lines per summary head)
                       │
                       └──> Work Order RA Bill (N:1 with BOQ)
                                  │
                                  ├─ Civil RA Bill Item (child — populated from BOQ)
                                  ├─ Civil RA Bill Deduction (child)
                                  │
                                  └──> Purchase Invoice (N:M with RA Bill)
                                             via "Get Items From RA Bill" picker

Civil Advance Register (1:1 with WO)
   │
   ├─ Civil Advance Tranche (child — manual entry in Phase 1,
   │                          Payment Voucher hook in Phase 2)
   └─ Civil Advance Recovery (child — auto-posted from RA Bills)
```

### 3.2 Doctype catalogue (Phase 1)

12 doctypes total. Names use `Civil` prefix per the original RGI scoping;
Work Order RA Bill was renamed during the pilot rename to validate the
v16 rename procedure.

| Doctype | Kind | Purpose |
|---|---|---|
| Civil Works Settings | Single | App-wide defaults: retention %, deviation limit, per-company GL accounts |
| Civil Works Company Account | Child | Per-company expense/retention/advance accounts |
| Civil Work Order | Submittable parent | Contract with a contractor; pricing summary; terms |
| Civil Work Order Summary Item | Child | Per-summary-head amount on a WO |
| Civil Work Order BOQ | Submittable parent | Detailed scope sheet; 1:1 with WO |
| Civil BOQ Item | Child | Detailed BOQ line (item_no, summary_head, description, UOM, qty, rate, deviation %) |
| Civil Advance Register | Standalone | Per-WO mobilization advance tracker |
| Civil Advance Tranche | Child | An advance paid in (Phase 1: manual; Phase 2: from Payment Voucher) |
| Civil Advance Recovery | Child | An advance recovered out (auto-posted from RA Bill submit) |
| Work Order RA Bill | Submittable parent | Running Account Bill; one bill per measurement event/period |
| Civil RA Bill Item | Child | Per-BOQ-line cumulative quantity and this-bill amount |
| Civil RA Bill Deduction | Child | Retention, recoveries, taxes, cess — auto-suggested and editable |

### 3.3 Key relationships

- `Civil Work Order` is the contract identity. Everything else hangs off it.
- `Civil Work Order BOQ` is 1:1 with the WO and was originally separated
  to allow independent BOQ versioning. In practice this caused user
  confusion (entering data twice) and a reconciliation problem
  (WO total vs BOQ total could diverge). **Phase 1.5 collapses BOQ into
  the WO** — see Section 8.
- `Work Order RA Bill` references a specific BOQ (and through it, the WO).
  Each RA Bill is one billing event; a WO accumulates many RA Bills over
  its life.
- `Purchase Invoice` is N:M with RA Bills: one PI can reference multiple
  RA Bills (typical when invoicing a month's bills together), and one RA
  Bill can be invoiced across multiple PIs (typical when partial invoices
  are issued).
- `Civil Advance Register` is 1:1 with the WO and is the single source of
  truth for "how much advance has been paid and recovered against this WO."

## 4. Key architectural decisions

This section captures the rationale behind shape choices. Each decision is
labeled with status (Locked / Phase 1.5 refactor pending / Phase 2 / etc.).

### 4.1 Single Work Order document with summary + BOQ in one form
**Status:** Phase 1.5 refactor pending (Phase 1 originally split this; the
split caused UX and reconciliation problems and is being collapsed.)

The user enters BOQ rows directly on the Civil Work Order form. The
summary table at the top of the form is read-only and auto-aggregated
from BOQ rows by summary head. This eliminates the double-entry problem
of the original two-document design and makes WO total ≡ BOQ total by
construction.

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

The `summary_head` field on Civil Work Order Summary Item, Civil BOQ Item,
and Civil RA Bill Item is a Link → Item with server-side filter
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

This applies to Civil Work Order, Civil Work Order BOQ (if printed
standalone), Work Order RA Bill, and to Purchase Invoices generated from
RA Bills (the suppress-qty-uom override on PI line printing).

The suppression marker is the conjunction of `is_stock_item = 0` AND
`stock_uom = "Nos"` on the source Item — this identifies a service-Item
summary line distinct from a measurable BOQ row.

### 4.7 BOQ changes via Frappe's native amend cycle, not a separate Amendment doctype
**Status:** Phase 2 (deferred); architecture locked.

When a BOQ needs to change after WO submit — rate revision, qty addition
beyond deviation, new item, deleted item — the user **cancels and amends
the WO** using Frappe's built-in `amended_from` flow. The original WO
stays in DB as audit; the amended version becomes the new active document.

Rationale (vs. a separate Civil Work Order Amendment doctype):
- Uses existing, proven Frappe infrastructure (validated in the rename
  pilot's amend canary)
- Produces a clean audit trail naturally — each amendment is its own
  immutable record
- Avoids the "current state is original + applied amendments" synthesis
  problem
- Matches government contract paperwork (a sanctioned amendment
  supersedes the original WO; the new WO is what gets executed against)

Cumulative-quantity continuity across amendments is preserved via a
**`boq_row_uid`** UUID field on each BOQ row. RA Bill Items reference this
UID, not the BOQ row's child name. When a WO is amended, BOQ rows are
copied with their `boq_row_uid` preserved — so an RA Bill's reference to
"row uid xyz" still resolves to the same logical row in the amended WO.
This is added in Phase 1.5 (alongside the WO+BOQ collapse) so future
amendment work has the necessary infrastructure.

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
  accounts are configured in Civil Works Settings via a child table.

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
- No BOQ amendment workflow — Phase 2 will add this via Frappe's
  amend cycle.
- No print formats — Phase 2/3.
- No workflow approvals — Phase 2/3.
- Material recovery is a single deduction line; no consumption-based
  reconciliation.
- Civil Advance Register doesn't yet auto-sync with Payment Voucher;
  tranches are manual until Phase 2.

### Open questions (not yet decided)
- Should the app expose a "Variation Order" report that diffs the
  original WO against the current amended WO? (Useful for RGI's
  amendment approval paperwork; complexity in tracking what "original"
  means across multiple amendments.)
- Should retention release be a manual document (Retention Release Voucher)
  or an automatic action on Final Bill / DLP expiry?
- For multi-supplier WOs (rare but possible — joint contracts), is the
  current single-supplier model acceptable, or do we need a Supplier
  child table?

## 8. Phase 1.5 refactor (current focus)

A planned set of changes to fix two real problems discovered in Phase 1:

### 8.1 Collapse Civil Work Order BOQ into Civil Work Order
The two-document split (WO with summary lines, separate BOQ document with
detailed lines) caused user confusion (entering same data twice) and a
reconciliation problem (WO total vs BOQ total could diverge).

After Phase 1.5:
- Civil Work Order absorbs the BOQ. The user enters BOQ rows directly
  on the WO form.
- The summary table on the WO becomes **read-only and auto-aggregated**
  from BOQ rows (group by summary_head, sum amount). WO total ≡ BOQ
  total by construction.
- Civil Work Order BOQ doctype is **deleted**.
- Work Order RA Bill's `civil_work_order_boq` link is removed; the bill
  reads BOQ rows directly from the parent WO.

### 8.2 Add boq_row_uid for amendment continuity
- Each BOQ row gets a hidden `boq_row_uid` UUID field, generated on
  insert, stable across WO amendments.
- Civil RA Bill Item references this UID (in addition to the row name)
  so cumulative quantity history survives WO amendments cleanly.
- This is added now (Phase 1.5) so Phase 2 amendment work has the
  infrastructure ready.

### 8.3 Bug fixes
- `deviation_limit_pct` accepts 0 (currently rejects due to truthy check).
- BOQ row `amount` is visible in the child table (currently
  invisible due to a field flag).
- Audit ALL percentage fields for similar truthy-check bugs.

### 8.4 Regression coverage
- The regression smoke test is updated to exercise the single-document
  model.
- Pre- and post-refactor runs confirm zero functional regression.

## 9. Future work (Phase 2 / Phase 3)

In priority order:

1. **Phase 1.5** — refactor above (next, as soon as design doc is committed)
2. **RGI dry-run** at one institution — pick a small project, exercise
   the Phase 1.5 build end-to-end, collect feedback before further work
3. **Consolidated rename pass** — rename Civil-prefix doctypes to
   organisation-neutral names if and when the app is to be released to
   non-RGI users. Procedure validated by the Civil RA Bill → Work Order
   RA Bill pilot. 11 doctypes remaining.
4. **Phase 2: Amendment workflow** — Frappe-native amend cycle for WOs,
   with cumulative quantity continuity via boq_row_uid
5. **Phase 2: Measurement Book** — MB doctype with per-WO toggle;
   MB-driven cumulative quantities on RA Bills (Model A — RA Bill is
   user-initiated, pulls from MB on demand)
6. **Phase 2: Extra Items** — work outside original BOQ
7. **Phase 2: Payment Voucher integration** — Civil Advance Register
   auto-sync with the dux_voucher app's Payment Voucher
8. **Phase 2/3: Final Bill, DLP, FIM, PBG** — end-of-project documents
9. **Phase 2/3: Print formats** — all documents, per the summary/detail
   philosophy
10. **Phase 2/3: Workflow approvals** — Maker-Checker on WO and RA Bill

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
