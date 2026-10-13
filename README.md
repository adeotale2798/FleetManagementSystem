# Fleet Manager v1.42.0

Transport office software for one or many logistics businesses.

- **Business owner** operates three simple booking screens—Dashboard, Receipts, and Ledger—alongside separate industrial Trips & LRs, Fleet, Parties, Team, Industrial Finance, and Industrial Reports.
- **Business owner** can administer multiple sites, assign site managers, configure per-site receipt conversion and print visibility, set each site's lorry-receipt company identity, logo, branch contacts and terms, review site operations, reconcile per-trip ledgers, record LR payments, and complete/lock a trip ledger.
- **Site manager** operates only assigned site bookings and granted actions; closing or reopening trips is owner-only, and industrial business routes are owner-only.
- Receipt data is entered and edited in English in one combined goods/description field per row (three rows are shown by default); receiver city defaults to Hinganghat. Receipt conversion, print visibility, branding, and address visibility are configurable per site under Booking receipt settings. Each receipt retains the fee recorded when it was created, and that fee is included in Booking Finance and payment balances. Older receipts without a stored fee retain the ₹2 legacy fallback.
- Only the business owner can mark an LR as paid or complete a trip ledger. Completion records any outstanding Bhada as a payment and locks receipt, ledger, and payment changes for that trip.
- **Platform owner** issues licences, suspends businesses, resets owner passwords, and turns modules on/off per business; platform access does not grant business-owner access.

Current application version: **v1.42.0**. See [VERSION.md](VERSION.md) for the release policy and changelog.

## Project guide

- [APP_SUMMARY.md](APP_SUMMARY.md) — product purpose, roles, features, and current boundaries.
- [ARCHITECTURE.md](ARCHITECTURE.md) — application architecture, data flows, design map, and diagrams.
- [AI_CHECKLIST.md](AI_CHECKLIST.md) — required steps for AI contributors and maintainers.
- [VERSION.md](VERSION.md) — authoritative app version, release rules, and changelog.

---

## 1. What you need on your machine

| Tool | Version (tested) | Why |
|------|------------------|-----|
| Python | 3.10+ | Backend (FastAPI) |
| Node.js | 18+ (npm included) | Frontend (React) |
| MongoDB | 6+ | Database |

Install MongoDB Community and start it so `mongodb://127.0.0.1:27017` answers.

---

## 2. Get the code

```bash
git clone <this-repo-url>
cd <repo-folder>
```

---

## 3. Environment files (required)

Copy the examples. Do not commit real `.env` files.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### `backend/.env`

| Key | Default in example | Meaning |
|-----|--------------------|---------|
| `MONGO_URL` | `mongodb://127.0.0.1:27017` | MongoDB connection |
| `DB_NAME` | `fleet_db` | Primary business DB name |
| `JWT_SECRET` | change this | Signs login tokens |
| `OWNER_USERNAME` | `owner` | Business owner login |
| `OWNER_PASSWORD` | `owner123` | Business owner password |
| `PLATFORM_USERNAME` | `superadmin` | Platform owner login |
| `PLATFORM_PASSWORD` | `super123` | Platform owner password |

Logo and document uploads save under `backend/data/uploads/` by default. Set `FMS_UPLOADS_DIR` to an absolute path on a persistent shared volume for production deployments; back up that volume together with the database so saved logos remain available after restarts and across application instances.

### `frontend/.env`

| Key | Default | Meaning |
|-----|---------|---------|
| `REACT_APP_BACKEND_URL` | `http://localhost:8000` | Backend origin (no trailing `/api`) |

Optional later: `REACT_APP_GOOGLE_MAPS_API_KEY`.

After changing frontend env, restart `npm start`.

---

## 4. Run locally (three terminals)

### Terminal A — MongoDB

If MongoDB is not already a service:

```bash
# macOS (Homebrew)
brew services start mongodb-community

# Ubuntu
sudo systemctl start mongod
```

### Terminal B — backend

Run the backend separately from the frontend and keep this terminal open while using the app. The backend reads `backend/.env`, copied from `backend/.env.example` in Section 3.

**Windows PowerShell**

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

On start the backend **creates / refreshes**:

- Platform user `superadmin` (role `superadmin`)
- Business `naidu` = New Naidu Transport
- Business users `owner` and `priyanshu` (role `owner`)

API docs: http://localhost:8000/docs  
API prefix: `http://localhost:8000/api/...`

### Terminal C — frontend

This starts only the browser app; it does not start the backend. Keep Terminal B running. The frontend reads `frontend/.env`, copied from `frontend/.env.example` in Section 3; its default `REACT_APP_BACKEND_URL` points to `http://localhost:8000`.

```bash
cd frontend
# Install dependencies once, then use `npm start` on later runs.
npm install
npm start
```

Open **http://localhost:3000**

If port 3000 is taken, CRA will offer another port. The backend URL in `frontend/.env` does not change.

---

## 5. Logins (v1 defaults)

Sign-in page: http://localhost:3000/login

| Who | Username | Password | After login |
|-----|----------|----------|-------------|
| **Platform owner** | `superadmin` | `super123` | **`/platform`** — licences for all businesses |
| **Business owner** | `owner` | `owner123` | **`/booking/dashboard`** — Booking Dashboard |
| Same business (alt) | `priyanshu` | `owner123` | Same office as `owner` |
| **Site manager** | Created by the business owner | Set during assignment/reset | Assigned-site workspace at **`/booking/dashboard`** |

These values come from `backend/.env`. If you change them, restart the backend; seed will update name/role and **reset the password** if it no longer matches the env file.

---

## 6. Platform owner — how it works

Code: `backend/auth.py` (seed + `require_super`), `backend/server.py` (`/api/platform/...`), `frontend/src/pages/Platform.jsx`.

1. Log in as `superadmin`.
2. You land on **Platform Control**.
3. You can:
   - Issue a **new business licence** (new login + its own MongoDB)
   - **Suspend / activate** a licence (suspended owners cannot sign in)
   - **Reset** that business owner’s password
   - **Customise** modules (Trips, Vehicles, Finance, GPS, charts, …) for that business only
   - Select a client and use **Booking setup** to manage its sites, receipt setup and site managers, alongside the access already granted to the client
   - Select **Open client app** to enter a confirmed, full-access support session, use the customer's normal Booking and Industrial screens, and exit back to Platform Control

Platform APIs (Bearer JWT, role must be `superadmin`):

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/platform/summary` | Totals + every tenant + stats |
| GET | `/api/platform/tenants` | Licence list |
| POST | `/api/platform/tenants` | Create licence + owner user |
| PUT | `/api/platform/tenants/{id}` | Status, plan, features, expiry |
| POST | `/api/platform/tenants/{id}/reset-password` | New owner password (min 6 chars) |
| POST | `/api/platform/tenants/{id}/support-session` | Start the selected customer's two-hour support session |
| POST | `/api/platform/support-session/end` | Record and revoke the current support session |

### Full client support mode

The support session is scoped to the selected customer, lasts up to two hours, and is separately revocable. It temporarily allows the platform owner to view and edit the client's app even when its subscription is suspended or excludes a module; it does **not** change the client's saved plan or admin grants. The support token is kept in the current browser tab only, the normal platform login remains available for exit, and platform-administration APIs are blocked while support mode is active. Session start/end and each successful support-mode write appear in that customer's Change history. A support banner remains visible in the client app; choose **Exit client** to revoke the session and return to Platform Control.

Customer support tokens are tenant-bound, revocable, and cannot call platform-administration APIs. Ordinary business-owner tokens do not receive the platform support privilege. Platform summary reads tenant databases concurrently with a fixed cap, preserving the response fields while avoiding serial per-customer loading.

---

## 7. Business owner — business modules

| Path | What |
|------|------|
| `/booking/dashboard` | Choose a date, create an open trip, and select a trip for its receipts |
| `/booking/receipts` | Create/edit/print branded Hindi receipts; sender is optional and goods rows include descriptions |
| `/booking/ledger` | Select one trip for a date and view its plain spreadsheet-style ledger. Sender/receiver and comma-separated goods/quantities are Hindi and read-only; only Bhada and Hamali are editable. Creator names are shown. Print or export that trip's ledger to `.xlsx`. |
| `/sites` | Legacy browser path redirects to `/booking/dashboard` |
| `/booking-finance`, `/booking-reports` | Legacy browser paths redirect to `/booking/ledger` |
| `/booking-setup` | Owner-only site, manager-access and booking-category administration |
| `/dashboard` | Redirects to the Booking Dashboard |
| `/trips?tab=trips` | Owner-only Industrial Trips (indoor / outdoor), status, cancel = reverse |
| `/trips?tab=lrs`, `/lrs/new`, `/lrs/:id` | Owner-only Industrial LRs; create / print |
| `/vehicles` | Fleet, documents, fuel, pumps |
| `/parties` | Customers, outstanding, ledger, payments |
| `/team` | Drivers and office staff, advances, salary |
| `/finance` | Industrial cash/bank, collections, payables, Deewanji, diesel, 3PL |
| `/reports` | Industrial reports + CSV / Excel / PDF / print |
| `/settings` | Company, routes, numbering, opening cash/bank |

Industrial money is derived from unscoped (`site_id` absent) `ledger`, `cashbook` and `expenses` records. Site booking entries use separate trip/LR/payment collections and tag shared expense/ledger/cashbook rows with `site_id`; they are visible through the booking workspace, not industrial Finance or Reports. The redesigned booking pages use the existing canonical site records and keep booking charges separate from industrial balances.

---

## 8. Data layout (MongoDB)

`DB_NAME` default `fleet_db`.

Booking and industrial workflows are distinct record families within each tenant database; they are not separate MongoDB databases. Industrial operations use `trips`/`lrs`; site bookings use `site_trips`/`site_lrs` and site payment/reconciliation records. Vehicles, drivers and selected party/master records are shared. No data migration or collection replacement is introduced by this separation.

| Database | Contents |
|----------|----------|
| `fleet_db_platform` | `users`, `tenants` (licences) |
| `fleet_db` | Primary tenant `naidu` (New Naidu Transport) collections |
| `fleet_db_BusinessName_OwnerName` | Every additional licensed business |

Users collection id = username. Roles include `superadmin` (no tenant), `owner` (has `tenant_id`), and owner-created `site_manager` accounts (tenant and explicitly assigned site/action grants).

---

## 9. Multi-site business workflow (v1.2.0)

### Owner: create sites and assign access

1. Sign in as the business owner. The default booking page is **Dashboard** at `/booking/dashboard`; authorized managers land in the same three-screen workspace.
2. Create a site with a unique short code and an IANA timezone such as `Asia/Kolkata`. Codes are unique within the business.
3. Assign a site manager with a unique username and a strong initial password. The password is bcrypt-hashed; managers access only explicitly assigned sites and permitted actions.
4. Use manager access controls to grant/revoke per-site actions, reset credentials, replace a manager, or deactivate access. Deactivation preserves audit history and does not rewrite historical trip/LR creators.
5. Open Dashboard, choose the trip date, and create a trip. Vehicle and driver details are optional.
6. Select the trip and open Receipts. Each receipt is linked to that trip; its first three goods rows are ready immediately, with additional rows available if needed. Enter each good, its optional description, and quantity in English; configured Hindi conversion supplies Hindi goods/description output. The receiver's 10-digit phone number is saved and printed. Owners configure Hindi conversion, print language, address visibility, company details, logo, branch contacts, terms, and the receipt fee under **Booking receipt settings**.
7. Use **Save & print** or print a saved receipt again. The compact A4 LR prints Hindi goods, descriptions, and quantities inline and shows Bhada, Hamali, the recorded receipt fee, and the total. When editing, **Cancel editing** discards the form changes without saving.
8. Use **Ledger** to select one trip for the chosen date. Sender, receiver, goods/quantity, date, and receipt number are read-only; only Bhada and Hamali are editable. The sheet, print view, and `.xlsx` export are scoped to that selected trip and display goods/quantities in Hindi.

### Site manager: trips, LRs and collections

Site managers use the normal login and see only Dashboard, Receipts and Ledger for assigned sites. They can create a trip without a vehicle or driver and add multiple receipts under the selected trip. Only the business owner can close or reopen trips. The selected vehicle/driver remain attached to the trip and are not re-entered on each receipt. The operating date uses the site's timezone. Trip/LR numbering is server-generated and atomic; truck number is descriptive, not an identifier. Owners can reopen a closed trip with a recorded reason.

Sender/receiver addresses and phone numbers are optional. Printing uses the browser print dialog and can also save to PDF. Financial fields/actions follow the manager's existing site permissions; charge editing still requires `finance:update` as well as receipt-update permission.

Create/update actions show a top-right success or failure notice. Unexpected server failures use a reference ID; platform owners can use it to find the sanitized diagnostic in the platform error log. Validation feedback remains visible to the person correcting the form.

### Trip ledger export and reconciliation

Owners can download separate versioned CSV files for goods-wise and receiver-wise ledgers, a summary, and an import template for a selected trip. CSV has no worksheet concept, so these are separate files. The template includes immutable LR/trip/site IDs; receiver names and row order are never matching keys.

Closing a trip locks receipt creation and ordinary edits. Reopening is owner-only and requires an audit reason. Voiding is audited and preserves the receipt; it is limited to receipts with no charges or payment history so accounting history is not silently discarded. Historical booking rows remain in `site_trips` and `site_lrs`; the redesign requires no data migration. On first startup, site storage adds a partial unique index for receipt idempotency. Rollback: deploy the previous application release and, if desired, drop the MongoDB index named `site_lr_idempotency_unique` from tenant databases; no records need to be transformed.

1. Select the site and trip, then upload the completed CSV template.
2. Review the entire staged preview: matched records, changes, missing/unknown IDs, duplicates, invalid values and scope conflicts.
3. Correct or skip rows and explicitly acknowledge missing LRs where appropriate.
4. Confirm only after resolving the preview. Cancellation leaves trip/LR/financial data unchanged.
5. Review the reconciliation result and audit entry. Re-uploading an identical file is idempotent and returns the existing import result.

Imports are owner-only and tied to one business, site and trip. They update rent/hamali and payment details by LR ID. Payment events are auditable; partial payments are supported and reversals create separate events. Outstanding amounts derive from reconciled rent and actual payments. Hamali is a separate recorded charge, not collected rent or a cost.

### Existing businesses: explicit legacy assignment

Legacy records are not silently assigned to a site. First create the intended default site. As owner, review the **Legacy migration** preview and unassigned counts, then explicitly apply the assignment. The migration is repeatable and fills only missing site IDs; it does not reassign already-scoped records. Back up the tenant database before production migration.

### Multi-site API groups

All paths below are under `/api` and use the normal bearer token. Owner-only actions are enforced server-side.

| API group | Route examples | Purpose |
|---|---|---|
| Sites/managers | `/sites`, `/sites/{site_id}`, `/sites/{site_id}/manager`, `/sites/managers/...` | Site lifecycle, assignment, grants and credential operations |
| Bookings board | `/sites/system-dashboard`, `/sites/{site_id}/dashboard` | Business-wide and authorized site summaries and outstanding breakdowns |
| Booking LR report | `/sites/system-reports/lrs` | Owner-only date/site/search filtered and paginated report from canonical `site_lrs` |
| Trips | `/sites/{site_id}/trips...`, `/sites/{site_id}/trip-resources`, `/sites/{site_id}/trips/{trip_id}/expenses` | Scoped trip lifecycle, fleet/driver dropdown choices, and ledger-posted trip expenses |
| LRs/categories | `/sites/{site_id}/trips/{trip_id}/lrs...`, `/sites/{site_id}/categories` | Booking, paging, audited edits including charge sheet updates, categories and details |
| Payments/audit | LR `/payments` routes including `/retry`, `/sites/{site_id}/audit` | Payment/reversal events, interrupted posting retry and audit history |
| Ledger | `/sites/{site_id}/trips/{trip_id}/ledger/{section}`, `ledger-imports/...` | CSV export, staged preview/edit/commit and private original download |
| Legacy migration | `/sites/migration/legacy` | Owner preview and explicit assignment of unscoped legacy records |

See [ARCHITECTURE.md](ARCHITECTURE.md) for diagrams, data boundaries, indexes and retry behavior. API docs are at `http://localhost:8000/docs`.

---

## 10. Project map

```
backend/
  server.py      HTTP API
  auth.py        JWT, bcrypt, seed owner + platform owner
  db.py          Mongo + per-request tenant DB
  ledger.py      Balances and cashbook
  site_ops.py    Multi-site auth, operations, booking board, expenses, finance and CSV reconciliation
  storage.py     Optional file uploads
  requirements.txt
frontend/
  src/App.js     Role-aware routes
  src/pages/     Office, platform and multi-site screens
  src/lib/api.js Axios → REACT_APP_BACKEND_URL/api
memory/          Product notes and test logins
VERSION.md       Changelog
```

---

## 11. Quick API check (optional)

With backend running:

```bash
# Platform owner
curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"super123"}'

# Business owner
curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"owner123"}'
```

Use the returned `token` as `Authorization: Bearer <token>`.

---

## 12. Common problems

| Problem | Fix |
|---------|-----|
| Backend crash on `MONGO_URL` / `JWT_SECRET` | Create `backend/.env` from the example |
| `Wrong username or password` for superadmin | Confirm `PLATFORM_*` in `backend/.env`, restart uvicorn |
| Frontend calls the wrong host | `REACT_APP_BACKEND_URL` must be origin only, then restart `npm start` |
| Blank page / CORS | Backend must be on port 8000 (or match the frontend env) |
| Backend startup reports `IndexKeySpecsConflict` for `site_trip_expense_idempotency_unique` | Deploy the compatible index declaration in v1.3.1 and restart. It reuses the existing index; do not drop collections or reset tenant databases. |
| Uploads fail | Expected without `EMERGENT_LLM_KEY`; rest of the app still works |
| Owner blocked after suspend | Platform owner: Activate licence on `/platform` |

Page bundles are loaded on demand and the trip list now limits its related financial aggregation to the trips in the current page. If a deployment still feels slow, capture request timings and MongoDB query plans on a representative tenant before considering a migration; do not clear production business data as a performance fix.

---

## 13. Tests (optional)

Run the focused offline multi-site unit tests with the configured backend pytest environment:

```bash
cd backend
pytest -q tests/test_site_ops_units.py
pytest -q tests/test_authorization.py tests/test_financial_separation_units.py
```

An opt-in end-to-end acceptance test is available at `backend/tests/test_site_ops_workflow.py`. It creates a site, manager, trip, two LRs, edits trip/LR values, records payments and trip expenses, exports/imports/reconciles the ledger, and checks the owner booking board. It creates persistent records and deactivates the test site/manager afterward; run it only against a disposable test tenant/API. Set `FMS_SITE_OPS_E2E_ALLOW_WRITES=1`, `FMS_SITE_OPS_E2E_BASE_URL`, `FMS_SITE_OPS_E2E_OWNER_USERNAME`, and `FMS_SITE_OPS_E2E_OWNER_PASSWORD` in the test process. It skips by default.

Build the frontend with `cd frontend && npm run build`. Existing API integration tests require a running, explicitly configured API and may create tenants or mutate trip data; inspect their fixtures and target before invoking. Never point them at production.

---

## 14. Backup and isolated restore drill

Fleet Manager's business data spans the primary tenant database, every licensed tenant database, and the `<DB_NAME>_platform` database. Logos and other uploaded files are stored separately under `FMS_UPLOADS_DIR` (default: `backend/data/uploads`). A usable recovery set must contain **both** the MongoDB databases and the complete upload directory from the same maintenance window. Do not back up only the currently selected tenant.

1. Schedule a maintenance window and stop or pause application writes while taking the backup and copying uploads. This keeps database references and files aligned. For deployments that cannot pause writes, use a coordinated, documented storage/database snapshot procedure instead.
2. Set `MONGO_URL` in the backup process from the deployment's protected secret source; do not put credentials in command history or commit them. From PowerShell, create a dated backup directory and dump all databases visible to this credential (do not pass `--db`):

   ```powershell
   $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
   $backupRoot = "D:\FleetBackups\$stamp"
   New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
   mongodump --uri="$env:MONGO_URL" --archive="$backupRoot\mongodb.archive.gz" --gzip
   if ($LASTEXITCODE -ne 0) { throw "mongodump failed; backup is incomplete." }
   $uploads = if ($env:FMS_UPLOADS_DIR) { $env:FMS_UPLOADS_DIR } else { "D:\FleetManagementSystem\backend\data\uploads" }
   Copy-Item -LiteralPath $uploads -Destination "$backupRoot\uploads" -Recurse
   ```

   If the configured upload directory is not the example path, verify `$env:FMS_UPLOADS_DIR` points at the actual persistent upload volume before copying. Confirm the Mongo archive and upload tree exist and are non-empty where expected. Encrypt the completed backup, restrict access, transfer it off-host, and apply the organization's retention policy.
3. Perform restore drills only against a **separate, isolated, empty staging MongoDB instance** with staging credentials and a dedicated temporary uploads directory. Set `STAGING_MONGO_URL` and `STAGING_UPLOADS_DIR` from protected sources, then restore without `--drop`:

   ```powershell
   mongorestore --uri="$env:STAGING_MONGO_URL" --archive="D:\FleetBackups\YYYYMMDD-HHMMSS\mongodb.archive.gz" --gzip
   if ($LASTEXITCODE -ne 0) { throw "mongorestore failed; staging restore is incomplete." }
   New-Item -ItemType Directory -Path $env:STAGING_UPLOADS_DIR -Force | Out-Null
   Get-ChildItem -LiteralPath "D:\FleetBackups\YYYYMMDD-HHMMSS\uploads" -Force |
     ForEach-Object {
       Copy-Item -LiteralPath $_.FullName -Destination $env:STAGING_UPLOADS_DIR -Recurse -Force
     }
   ```

   Keep the restored database names and staging `DB_NAME` configuration aligned with the archived environment. Verify the expected platform and tenant databases, application login, representative trip/receipt records, and uploaded logos/documents while the app is pointed only at staging. Record the drill date, backup identifier, checks, duration, and outcome.
4. Never aim a restore command at production, use `--drop` on a production target, or overwrite a non-empty database as part of a drill. A production recovery requires an explicitly approved incident procedure, a verified target, and a known-good backup. This runbook documents the procedure; it does not mean a backup or restore has been performed.

---

**v1.7.0** — added separate owner Booking Finance and paginated Booking Reports, reduced Booking Dashboard financial clutter, and added an audited per-LR bhada/hamali charge sheet using the canonical site LR update API. No new collection or migration. See [VERSION.md](VERSION.md).

**v1.6.0** — clearly separated daily site bookings from owner-only industrial Trips/LRs and Finance/Reports, hid industrial search/Quick Add on booking routes, and scoped site-tagged financial rows out of industrial balances, expenses and cashbook views. No migration or new booking collection. See [VERSION.md](VERSION.md).

**v1.5.0** — shared brand-derived presentation tokens, responsive navigation refinements, page-level refinements across business modules, and Booking Dashboard charts with backend-sourced daily/site data. An additive read-only dashboard response field supports the daily counts; office and site trip/LR storage remain distinct. See [VERSION.md](VERSION.md).

**v1.4.0** — owner Trips & LR visibility for site trips/LRs, a clearer Bookings Window Board, and on-demand site data loading without copying or duplicating financial records. See [VERSION.md](VERSION.md).

**v1.3.1** — startup compatibility for the deployed trip-expense index, bounded trip-list aggregation, and lazy-loaded route pages. See [VERSION.md](VERSION.md).

**v1.3.0** — operation notifications/error logging, Bookings Window Board, trip expenses, structured ledger exports, mobile trip/LR forms, and quicker LR printing. See [VERSION.md](VERSION.md).
