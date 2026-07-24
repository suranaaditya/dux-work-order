# SiteBill — React SPA for `dux_civil_works`

A React frontend for the Work Order → RA Bill → billing flow, served at
`/sitebill`. It reads the existing `dux_civil_works` doctypes (Work Order
Contract, Work Order RA Bill, …) via `frappe-react-sdk`. **No backend doctype
is changed by this frontend** — it is a read/compose layer on top of the app.

Built on branch `feat/sitebill-frontend`. Slice 1 covers Work Orders and RA
Bills (list + detail, with the live bill-computation panel).

## Stack
- Vite + React 18 + TypeScript
- `frappe-react-sdk` (auth + `/api/resource` CRUD + whitelisted methods)
- React Router (client-side routing under `/sitebill`)
- DUX design tokens in `src/styles/tokens.css`

## Tax model (matches the backend)
The RA Bill `net_payable` is the **certified pre-tax value less site
deductions** (retention, mobilization/material recovery, labour cess). **GST
and TDS are applied on the Purchase Invoice, not on the RA Bill** — the UI shows
the with-tax figure only as an informational line. This mirrors
`work_order_ra_bill.py` and `DESIGN.md` §4.9.

## Local / server dev (isolated — does not touch the installed app)
This repo has no Node locally; build and preview on a machine with Node 18+
(the demo server has Node 24). Clone this branch into a scratch dir **outside**
the bench (never build inside `apps/dux_civil_works`), then:

```bash
cd frontend
npm install
# Point the dev proxy at the live site (default) or a tunnel:
VITE_PROXY_TARGET=https://erp.jewonline.in npm run dev
```

Vite serves the SPA on `:8080` and proxies `/api`, `/assets`, `/files` to the
target. For a headless preview against the live site, authenticate with an API
token instead of a cookie:

```bash
VITE_FRAPPE_TOKEN="<api_key>:<api_secret>" npm run dev
```

`VITE_FRAPPE_TOKEN` is read at runtime and **never committed**. When unset, the
app uses same-origin cookie auth (the production path).

## Production build + serve (later — requires installing on a site)
```bash
cd frontend
npm run build      # -> ../dux_civil_works/public/frontend + www/sitebill.html
```
`hooks.py` already declares the route rule mapping `/sitebill/<path>` to the SPA
entry. After a build on a site where the app is installed, the SPA is available
at `https://<site>/sitebill`. Build artifacts are git-ignored.

> The shared `dux_civil_works` install on `erp.jewonline.in` serves other
> sites. Do not `npm run build` inside the installed app or run `bench build` /
> `bench migrate` for this frontend until deployment is explicitly agreed.
