# Fleet Manager release control

## Source of truth

- The product release version is the `Current version` value below. Git commits and tags track source history; this file tracks the app's release history and policy.
- Keep `frontend/package.json`'s `version` in sync with this file (without the leading `v`).
- A release entry must be added here for every app change set. Do not merge or publish an app change with stale version metadata or no changelog entry.
- Documentation changes that alter project guidance, architecture, product behavior, or contributor workflow are release changes too. Use a patch increment unless they introduce/describe an app feature.

## Version policy (Semantic Versioning)

The version format is `MAJOR.MINOR.PATCH`:

- **PATCH** (`1.1.1` → `1.1.2`): backwards-compatible bug fixes, maintenance, and documentation/governance changes that affect how the app is built or maintained.
- **MINOR** (`1.1.2` → `1.2.0`): every new backwards-compatible user-facing feature or integration. A genuinely new feature must never be merged without a version increment and release notes.
- **MAJOR** (`1.13.0` → `2.0.0`): incompatible API, data, security, workflow, or deployment changes that require consumers or operators to adapt.

For every change set: select the increment before implementation; update this file and `frontend/package.json`; add a dated changelog entry describing user-visible changes and relevant migration/compatibility notes; validate the implementation; then commit the complete change together. Do not reuse a released version. If one change set spans categories, use the highest applicable increment. Purely local experiments that are not retained in the repository do not constitute a release.

New features and architecture changes also require updates to [APP_SUMMARY.md](APP_SUMMARY.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [AI_CHECKLIST.md](AI_CHECKLIST.md) wherever their content is affected.

## Current version

**v1.29.0** — 10 October 2026

## Changelog

### v1.29.0 — 10 October 2026

- **Renewal queue:** Added a dedicated client filter for licences expiring within 30 days or already expired, including suspended licences. Each row offers a direct action to open that customer's renewal/subscription editor.
- **Readable customer history:** Subscription and per-user access events now show added/removed sections in clear labels and report how many admins actually had grants reduced.
- **Verification:** 41 focused backend tests and 33 focused frontend tests pass; the production build compiles and `git diff --check` passes.

### v1.28.0 — 10 October 2026

- **Faster access management:** Customer access opens on an active business login when available. Per-user summaries count only permissions allowed by both current licence features and the subscription. Subscription and admin-grant saves update the customer workspace from their API response instead of waiting for a full all-customer stats reload.
- **Clearer platform activity:** Plan-template history entries now appear under Platform rather than Deleted business.
- **Reliable plan removal:** Fixed plan deletion to retain the loaded plan name for its audit event, avoiding a server error after a successful delete.
- **Verification:** 40 focused backend tests and 65 focused frontend tests pass; the production build compiles and `git diff --check` passes.

### v1.27.1 — 10 October 2026

- **Custom subscription entitlements:** Switching a customer to Custom now starts with every section disabled. Added a clear-all action for existing Custom subscriptions and a warning when no sections are included.
- **Access clarity:** The user-access editor now labels each module count as enabled versus included in the subscription, and refreshes customer access data before closing a saved subscription.
- **Verification:** 29 focused subscription/access UI tests pass, the production frontend build compiles, and `git diff --check` passes.

### v1.27.0 — 10 October 2026

- **Full customer support mode:** Platform owners can start a two-hour, revocable support session from a selected customer workspace and use that customer's existing app to view and edit Booking and Industrial data, including clients whose licence is suspended or whose subscription does not include a section. This support override does not change the customer's saved plan or admin grants.
- **Safer support boundary:** The support token is bound to the authenticated platform owner and one tenant, kept only in the current browser tab, checked against an active server-side session on every request, and cannot access platform-administration routes. Exit revokes the session and restores the platform login.
- **Auditing and discoverability:** Every customer workspace now exposes Booking setup and a clear Open client app action. Support session start/end and successful support-mode writes are added to customer change history; actions continue to use tenant-scoped business operations.
- **Platform dashboard speed:** Independent per-client summary queries now run concurrently with a fixed concurrency cap; the existing tenant/stat fields and normal tenant authorization remain unchanged.
- **Compatibility:** Customer logins, subscription grants, tenant data, and business workflows are unchanged outside platform support mode. Receipt-logo previews now resolve through the configured backend asset URL.
- **Verification:** 114 focused backend tests and 56 focused frontend tests pass; the production frontend build and `git diff --check` pass. The combined frontend run exposed and fixed a support-banner placement bug on Booking routes.

### v1.26.0 — 10 October 2026

- **Platform-managed Booking setup:** When no active customer owner has effective Booking Settings access, the platform owner can configure the customer's business-wide receipt visibility, site details/status, receipt format and branding, receipt-name suggestions, and reusable receipt categories.
- **Site-manager support:** Platform owners can assign and manage tenant-scoped site-manager logins, site-specific permissions, and password resets. Newly generated temporary passwords appear once in the support workspace; no fee tracking or billing was introduced.
- **Access and isolation:** The Booking setup workspace is hidden when an active customer owner can manage Booking Settings. Every support API requires a platform superadmin, rechecks the grant/subscription gate, sets the requested tenant context, and delegates to established site operations and audit behavior.
- **Verification:** Platform UI tests, site operations and platform access tests, frontend production build, Python syntax checks, and `git diff --check` passed.

### v1.25.1 — 10 October 2026

- **Subscription editor visibility:** Rendered modals in a document-level portal so the animated application content cannot clip the overlay or dialog. Constrained dialog height to the visible viewport and made its content area reliably scroll while keeping title and actions visible.
- **Clearer subscription editor:** Widened the customer subscription editor and grouped plan/renewal details separately from included sections; clarified the save action and payment/reference-price explanation.
- **Accessibility:** Added dialog semantics, an accessible dialog name, and a labeled close button.
- **Verification:** Focused platform and shared modal UI tests, production build, and `git diff --check` passed.

### v1.25.0 — 10 October 2026

- **Attention-first platform home:** Platform client management now opens on Needs attention, with one-click customer rows and recommended actions for suspended/expiring customers, missing plans, or missing active admins. All customers remains one tap away.
- **Clearer licence state:** Customer workspaces show an Active → Expiring soon → Expired lifecycle, with suspended access called out separately. Mobile rows prioritize customer identity, status, reason and next action.
- **Access profile previews:** Booking operator and Finance only profiles now explain the sections they grant before applying; subscription-excluded access remains disabled and reported before save.
- **Compatibility:** No billing behavior, backend contracts, tenant workflows, or saved grant formats changed.
- **Verification:** Focused platform UI tests, production build, and `git diff --check` passed.

### v1.24.0 — 10 October 2026

- **Needs attention:** Added a customer view that brings together suspended or expiring/expired licences, customers without a saved plan, and customers without an active admin. Each row opens the same customer workspace.
- **Safer licence management:** Added a quick renewal action that opens the existing subscription editor so the owner chooses the new expiry date. Suspending a customer now requires confirmation; activation remains immediate.
- **Reusable access profiles:** Added Booking operator and Finance only starting profiles. Requests are clamped to the customer's subscription/licence and any requested sections excluded by that plan are explicitly listed; grants still require the existing Save action.
- **Local setup guidance:** Clarified that the frontend and API run in separate terminals, documented Windows PowerShell and macOS/Linux backend commands, and identified the example environment files and frontend API URL.
- **Compatibility:** Billing remains manual; no payment, invoice, or automated renewal lifecycle was introduced. No business-app workflows or data contracts changed.
- **Verification:** Focused platform UI tests, production build, and `git diff --check` passed.

### v1.23.0 — 10 October 2026

- **Simpler platform client directory:** Replaced the dense client cards and secondary activity chart with a searchable, status-filtered customer list. Each row opens that customer's management workspace; plan, admin count, expiry, and licence state are scannable at a glance.
- **Cleaner access editing:** Added an “All included access” starting preset that respects the client's current plan and features. Permission groups collapse into concise summaries until needed, while individual grants and explicit saving remain unchanged.
- **Responsive presentation:** Added a focused platform-console visual treatment with mobile-aware search, status chips, client rows, and access groups. No APIs, tenant business workflows, subscription rules, or stored data formats changed.
- **Verification:** Focused platform UI tests, production build, and `git diff --check` passed.

### v1.22.0 — 10 October 2026

- **Platform workspace redesign:** Separated client management, Plans & pricing, and platform settings into clear destinations. Opening a customer now provides Overview, Subscription, Users & access, and Change history tabs; one selected admin is edited at a time.
- **Simplified customer workflow:** Customer overview brings expiry, plan, active admins, activity, subscription entitlements, suspend/reactivate, password reset, and access actions together. Subscription and user access are displayed as included-vs-enabled steps.
- **Auditable administration:** Added append-only platform events for customer licence creation, subscription changes, status changes, plan template changes, admin grant changes, and owner password resets. Customer workspaces show that customer’s history; platform settings show recent global activity and operating rules.
- **Compatibility:** No tenant operational screens, business workflows, payment behavior, or expiry lifecycle changed. Existing plan snapshots and access enforcement remain in force.
- **Verification:** Focused platform UI and navigation tests, backend platform-access tests, Python syntax validation, production build and `git diff --check` passed.

### v1.21.0 — 10 October 2026

- **Subscription plan catalogue:** Added editable Booking Essentials, Booking Complete, Industrial Modules, and Full Operations starter plans. Platform owners can set included sections and optional INR monthly/annual reference prices; the console does not collect payments.
- **Customer licence snapshots:** New and existing customer licences can be assigned a plan and then customised independently. The saved entitlements, reference prices, and expiry belong to that customer; later plan-template edits do not change existing licences.
- **Enforced subscription caps:** Each admin’s personal access grants are now bounded by the customer’s subscription in frontend navigation/route guards and backend authorization. Booking site managers are denied Booking APIs when Booking is not in their customer’s plan. Reducing a customer’s subscription clamps existing admin grants.
- **Compatibility and lifecycle:** Existing licences without a subscription snapshot keep their previous behavior until assigned a plan. Active/Suspended status and manually managed expiry remain unchanged; no payment integration or operational feature changes were added.
- **Verification:** Platform/access UI tests and backend platform-access tests passed; syntax validation, production build, and `git diff --check` passed.

### v1.20.0 — 10 October 2026

- **Platform client directory:** Replaced the duplicate licence table workflow with a searchable and status-filtered client directory. Each client card shows licence state/expiry, plan, admin count, activity, and direct management actions.
- **Per-client access workspace:** Selecting a client loads only its admin logins and licence details. Admin permissions remain grouped into Booking operations, Booking owner sections, and individually selectable Industrial modules; licence-capped modules are visibly disabled.
- **Access suggestions:** Added Full Booking, Industrial Trips only, and Clear all presets, plus an explicit unsaved/saved state and a confirmation before switching away from an edited access draft. Presets remain editable and do not bypass licence limits.
- **Verification:** Focused platform-directory, admin-access preset and persistence UI tests, production build and `git diff --check` passed.

### v1.19.0 — 09 October 2026

- **Platform admin access:** Platform owners can select each business owner login and assign Booking operations as one grant, Booking Finance/Audit/Settings separately, and each Industrial module individually. The platform shows total and active admin counts.
- **Enforcement and defaults:** Grants are checked by frontend navigation and route guards and by backend owner API authorization. Industrial grants cannot exceed tenant licence features; new business admins start with no grants, while pre-existing accounts without a saved grant record retain legacy access until configured. Unknown owner API routes fail closed.
- **Data boundaries:** Search, dashboard summaries and trip details now omit module data that the admin has not been granted, in addition to direct route/API denial. Industrial trip amounts require Finance access.
- **Compatibility:** No existing tenant data is migrated; the grant map is stored additively on platform user records. Admins with no enabled sections receive a clear access-required screen instead of a redirect loop.
- **Verification:** Backend platform-access and authorization tests passed (32). Focused frontend coverage passed (4 suites, 47 tests) across grant helpers, routes, navigation and Booking regressions. The production build and `git diff --check` passed. No live MongoDB integration test was run.

### v1.18.3 — 09 October 2026

- **Compact phone controls:** Receipt Save, Print and Cancel actions now fit on one mobile toolbar row with concise labels and icons, while retaining full accessible labels. Controls stay at least 44px tall and preserve save-before-print behavior.
- **Verification:** Focused receipt tests passed (2 suites, 39 tests). Browser measurements at 320, 360, 390 and 430px confirmed all three actions fit on one row, retain descriptive accessible names, and have no label or page overflow; desktop restores full labels. The production build and `git diff --check` passed. The app backend is unavailable, so authenticated receipt saving/printing could not be exercised in-browser.

### v1.18.2 — 09 October 2026

- **Phone receipt workflow:** Save and a compactly labeled Print action fit side by side as phone-sized touch targets; Cancel spans the full action bar. Print retains its explanatory accessible name and save-before-print behavior.
- **Print sizing:** Removed a narrow-screen flex-basis override that incorrectly stretched receipts along their vertical layout axis, preserving the configured standard landscape and thermal-roll print sizes on phones.
- **Verification:** Focused receipt tests passed (2 suites, 39 tests). Browser CSS checks at 320px and 390px confirmed the two primary buttons fit side by side, Cancel spans the bar, and all buttons are at least 48px tall; desktop restores the full Print label. The production build and `git diff --check` passed. The real receipt page could not be opened because the local backend was unavailable.

### v1.18.1 — 29 September 2026

- **Amount entry:** Booking charge fields display whole rupee amounts by default, accept optional decimal input, and treat a cleared per-good charge as zero instead of rejecting the ledger save. Charges are labeled in INR and rendered with Indian digit grouping.
- **Goods-row layout:** Bhada and Hamali inputs sit alongside their goods row on desktop; the ledger gives the goods-and-charge area more room and shortens routine save status while keeping full failure details expandable.
- **Phone and timestamps:** Booking receipt phone entry accepts only 10 digits. The shared page header shows a live India Standard Time clock; each receipt saves its creation timestamp and prints that original IST time.
- **Verification:** Focused site Booking tests passed (73), covering blank/decimal charges, invalid phone lengths, and persisted receipt time. Focused Booking UI and Layout tests passed (13); the production build compiled successfully and `git diff --check` passed. No live MongoDB end-to-end run was performed.

### v1.18.0 — 29 September 2026

- **Per-goods charges and receipt print:** Each goods row stores and edits Bhada and Hamali independently. The branded Hindi LR print now shows Bhada, Hamali and their total for each goods row as well as the receipt totals.
- **Owner settlement and recovery:** The owner ledger checkbox records the remaining Bhada as a real Cash payment and reverses only payments created by that control when unchecked. Finance groups outstanding balances by receiver and can settle a receiver's remaining Bhada. Owners can restore a mistakenly voided receipt with a reason; compensating postings preserve the original void and payment history.
- **Excel export:** Monetary values are numeric spreadsheet cells with currency formatting, rather than text, so exported ledgers sort and calculate correctly.
- **Verification:** See the v1.18.1 verification entry above for combined current-worktree test results.

### v1.17.1 — 29 September 2026

- **Receipt save recovery:** Booking now surfaces structured validation and conflict messages instead of hiding them behind “Request failed.” When a receiver resembles an existing same-day receiver, the receipt form explains the match and lets the manager choose the same receiver or a different one before retrying.
- **Owner oversight navigation:** Business owners can open Booking Finance and Booking Audit directly; site managers continue to see only Dashboard, Receipts and Ledger.
- **Verification:** The available backend suite passed (87 passed, 1 skipped) excluding `test_multitenant_features.py`, which hard-codes unavailable `/app/frontend/.env`. The frontend suite passed (9 suites, 40 tests), the production build compiled successfully, and `git diff --check` passed. No live MongoDB end-to-end run was performed.

### v1.17.0 — 29 September 2026

- **Owner corrections:** Business owners can correct posted/closed receipts and void financially posted receipts with a required audit reason. Receiver corrections transfer any remaining Bhada balance between receiver accounts; voiding reverses posted payments and charge postings instead of deleting history. Managers retain the existing safeguards.
- **Booking Finance:** Added an owner-only finance page that sums active ledger Bhada + Hamali into a grand total, separates posted collections/outstanding Bhada, and lists unreconciled/unpriced receipts. Owners can record a promised payment date and follow-up note for the audit trail.
- **Booking Audit:** Added an owner-only view of pending/unpaid receipts, promised payment dates, and site audit events. Finance and audit are available from the booking navigation; the legacy `/booking-finance` URL now opens the new finance page.
- **Compatibility:** Added optional follow-up fields to site LRs and a site-scoped owner-only finance endpoint. Existing records remain valid; no migration or destructive data change is required. Hamali remains informational and is not treated as collected Bhada.
- **Verification:** The v1.17.0 and v1.17.1 working-tree changes were validated together; see the v1.17.1 verification entry above.

### v1.16.0 — 29 September 2026

- **Owner audit trail:** New site booking records and manager/tenant logins store creator login ID, name/role snapshot and timestamp. Site audit events also store actor ID and role; audit history is owner-only and manager-facing responses omit creator metadata. Existing records are unchanged and need no migration.
- **Ledger layout:** The desktop table now fits the window without horizontal scrolling. Hindi name/type fields appear under the English text, sender/receiver addresses are omitted from the ledger and export, and the columns remain editable.
- **Charge editing and attribution:** Site managers with receipt-edit access can enter and edit Bhada/Hamali in receipts and the ledger. The ledger's final column shows a circled A for the business owner or M for a site manager who last changed charges; the owner-only audit trail retains the editor's login and timestamp.
- **Verification:** Focused site-operations tests passed (57 tests); the available backend suite passed (83 passed, 1 skipped) excluding `test_multitenant_features.py`, which hard-codes unavailable `/app/frontend/.env`. The frontend suite passed (9 suites, 39 tests) and the production build compiled successfully. No live MongoDB end-to-end run was performed.

### v1.15.0 — 29 September 2026

- **Receipt entry and Hindi:** Sender name is optional, sender-phone entry is removed, and each goods row now supports a description. Offline Hindi conversion is applied on save unless the manager has supplied a correction.
- **Branded LR printing:** Receipt print uses the business name, logo, saved contact/address and receipt data in a Hindi-capable A4 layout. Print mode is isolated from the application and clears after the browser print dialog closes.
- **Ledger output:** Ledger printing uses a clean landscape table with repeated headers. Download Excel returns a formatted `.xlsx` workbook with a receipt-level Ledger sheet and one row per good in Goods Details. Both include trip numbers and optional sender/receiver addresses; ledger cards are comfortable to edit on mobile, while the desktop table remains spreadsheet-like.
- **Ledger safeguards:** Closed-trip and voided receipts are read-only in the ledger. Concurrent edits use server row versions; a conflict can be explicitly reloaded instead of repeatedly retrying a stale update.
- **Compatibility:** Optional sender/city and goods descriptions are additive on site LRs; old sender-phone data and legacy container rows remain readable. No historical-data migration or deletion is required. `openpyxl` is added for server-side workbook generation.
- **Verification:** Frontend production build succeeded; frontend tests passed (9 suites, 38 tests); backend tests passed (79 passed, 1 skipped) when excluding `test_multitenant_features.py`, whose collection hard-codes unavailable `/app/frontend/.env`; focused site-operations tests passed (53 tests). No live MongoDB end-to-end run was performed.

### v1.14.0 — 29 September 2026

- **Simple site-booking workflow:** Replaced the old booking dashboard, trip-detail, finance and report screens with Dashboard, Receipts and Ledger. Managers can create optional-vehicle/driver trips, save multiple goods rows per Hindi-printable receipt, and edit receipts directly in the ledger.
- **Backward-compatible API/data:** Kept `site_trips` and `site_lrs`, legacy goods/container fields, number sequences, tenant/site authorization, and audit/finance logic. New receipt addresses/Hindi text and goods rows are additive; no record migration or destructive data change is required. Site startup creates a partial unique index for receipt request idempotency; rollback is to drop `site_lr_idempotency_unique` and restore the previous application release.
- **Ledger safeguards:** Added site-scoped ledger list/CSV endpoints, charge permission checks, stale-edit detection, and audited voiding restricted to receipts without charge/payment history. Reconciled/financial history remains protected.
- **Verification:** Added booking form/navigation and model-validation tests; optimized frontend build succeeded and 77 available backend tests passed (one skipped). One separate backend test module cannot collect in this Windows checkout because it reads `/app/frontend/.env`.

### v1.13.0 — 27 September 2026

- **Cross-device live data updates:** Successful authenticated writes increment a tenant-scoped revision in the platform database. Active clients check that revision every two seconds, broadcast changes between same-business tabs, and refresh their mounted dashboard, finance, report, trip and LR data without a page reload.
- **Tenant-safe polling:** The revision endpoint exposes only the signed-in user's business revision, disables response caching, and returns a revision header on successful writes. Existing canonical MongoDB records and finance calculations remain the source of truth; no business data is copied into the platform database.
- **Verification:** Added backend coverage for tenant revision scoping/publication and frontend coverage for active polling and cross-tab notification.

### v1.12.0 — 27 September 2026

- **Trip-linked Booking Reports ledger:** Selecting a booking in Booking Reports now loads its trip details and the trip's LR ledger directly in the report. The ledger loads LRs in bounded pages and allows owner edits to sender/receiver contact and identity fields, goods, containers/quantities, bhada and hamali.
- **Canonical persistence and finance:** Each save updates the canonical site LR through the existing tenant/site-scoped audited endpoint, and server-returned balances replace the displayed ledger/report values. Rent corrections made alongside an allowed receiver change now post against the resolved receiver party. Posted payments remain immutable; collections, outstanding and payment status remain server-calculated.
- **Verification:** Added UI coverage for opening a trip-scoped ledger and saving editable LR details/finance, plus a backend regression test confirming first bhada posted with a receiver change is credited to the resolved party.

### v1.11.0 — 27 September 2026

- **Editable Booking Reports ledger:** Added in-place per-LR editing for receiver, goods, container lines/quantities, bhada and hamali in the Booking Reports table. The screen saves through the existing scoped, audited site-LR update API.
- **Finance stays transaction-derived:** Updated canonical LR values are returned to the report so bhada, collected, outstanding and payment status display the backend calculation. Collected/payment status remain read-only; receiver identity and bhada changes must be saved separately to preserve correct party ledger posting.
- **Verification:** Added report UI coverage for canonical row updates and displaying recalculated finance fields.

### v1.10.0 — 27 September 2026

- **In-app trip ledger editing:** Added expandable editable LR rows on site-booking trip details. Owners and site managers granted `lrs:update` can update sender/receiver, goods, container types and quantities in the trip without downloading or re-uploading a CSV.
- **Permission and data safeguards:** LR edits use the existing tenant/site-scoped update API, preserve backend validation and audit history, and are reflected by booking finance/reports. Charge edits remain limited to owners or managers with both `lrs:update` and `finance:update`; closed trips must be reopened and reconciled/paid identity restrictions remain in force. Payment events are unchanged.
- **Verification:** Added frontend coverage for manager LR editing and for hiding the editor without `lrs:update`; existing owner charge editing remains covered.

### v1.9.3 — 27 September 2026

- **Daily booking ledger download:** Added a site/day CSV export containing all trips and LRs for the selected operating date, including goods, quantities, bhada, hamali, collected/outstanding amounts, payment status and payment details.
- **Manager permission:** Added the explicit `ledger:export` site permission and a plain-language checkbox in Booking access management. Newly assigned managers receive it by default; existing managers need the owner to grant it. Owners can always download the ledger. The API verifies tenant/site access and the export permission and enforces bounded daily record counts.
- **Verification:** Added daily multi-trip export content/scope checks, permission-denial coverage, and a manager UI download test.

### v1.9.2 — 27 September 2026

- **Manager booking resources:** Site managers with trip-create or trip-read permission can load shared vehicle and driver master records for booking assignment. The resource endpoint remains tenant- and assigned-site-scoped; managers without either permission are denied.
- **Independent resource loading:** The Booking Dashboard now loads vehicle/driver options separately from site trip lists and dashboard data, so a manager who can create bookings is not blocked from seeing assignment options when another read permission is unavailable. Any unavailable data is reported explicitly.
- **Verification:** Added backend authorization/resource-shape tests and a frontend regression test for manager booking creation with shared vehicle and driver choices.

### v1.9.1 — 27 September 2026

- **Booking Finance and Reports routing:** Moved owner-only Booking Finance and Booking Reports routes into the business-owner route set. Owners can open both pages directly; site managers continue to be redirected to their site workspace.
- **New-business empty states:** Confirmed zero-value Finance metrics and a zero-row Reports state are rendered when a business has no sites or booking activity.
- **Manager access clarity:** Grouped site permission checkboxes by dashboard, trips, LRs, and finance/payments with plain-language action labels and a clear site-specific explanation.
- **Manager passwords:** Removed the 12-character minimum and bcrypt 72-byte cutoff for new/reset manager passwords. New manager hashes use SHA-256 pre-hashing with bcrypt; existing bcrypt hashes remain verifiable. Passwords are still never stored or returned in plaintext; the newly set value is displayed once in the page for copying.
- **Verification:** Added direct-route role tests, fresh-business zero-state tests, grouped-permission UI coverage, and long/new plus legacy password-hash tests.

### v1.9.0 — 27 September 2026

- **Booking setup & access page:** Moved site creation/editing, manager assignment and permissions, legacy assignment tools, and booking categories out of the operational Booking Dashboard to a dedicated owner-only `/booking-setup` page. Added an owner dashboard shortcut; site managers cannot navigate to the page.
- **Office Team manager selection:** Site creation now lets the owner select an active Office Team member with a manager role, or add a new manager profile. When the selected profile has no login, the flow creates a separate site-manager login and reveals its temporary password once. Existing linked logins can be assigned to additional sites.
- **Identity linkage:** Site-manager platform accounts can retain a `team_member_id` link to a tenant Office Team profile. No credentials are stored on or copied into Team profiles; existing tenant/team records remain intact.
- **Dashboard focus and field labels:** Removed setup/access/category controls from the operational dashboard. Site-add manager selection uses the Team roster; site metadata remains clearly labeled.
- **Verification:** Added tests for owner-only navigation, manager-only Team selection, login creation/linkage, and temporary credential visibility.

### v1.8.1 — 27 September 2026

- **Owner-only Booking access management:** Separated site-manager assignment, permissions, manager register, password reset and deactivation into its own Booking Dashboard section. Site managers do not see this owner-only section.
- **Booking categories:** Moved goods/container category controls into their own separate section.
- **Selected-site form clarity:** The previously blank third field is the optional City. Added visible labels and helpful placeholders for the site name, location, city and time zone.
- **Compatibility:** Presentation-only change; no API, storage, or data migration changes.
- **Verification:** Added frontend checks for role separation, distinct section headings and the selected-site City field label.

### v1.8.0 — 27 September 2026

- **Manager account register:** Booking Dashboard owner settings now keep manager IDs, status and assigned sites visible in a dedicated register.
- **One-time temporary credentials:** A password is shown in the current page only after assignment or reset so the owner can copy/share it securely. Existing passwords cannot be retrieved; issue a reset to create a new temporary credential. Passwords remain bcrypt-hashed in platform storage and are never included in manager-list responses.
- **Existing-manager reassignment:** If the owner supplies a temporary password while assigning an existing manager, it is now hashed and applied; the password reset is recorded in the site audit log without recording the credential.
- **Compatibility:** No database schema, collection or migration change.
- **Verification:** Added manager-register and existing-manager password-hash regression coverage, plus a frontend test for ID/site listing and one-time reset display.

### v1.7.0 — 27 September 2026

- **Booking Finance and Reports:** Added owner-only booking-specific Finance and LR Reports screens. Booking Finance uses the existing site dashboard aggregation and reports query canonical site LR records with tenant/site scope, date filters, search and pagination, with CSV export for the rows currently loaded. These screens do not use or include industrial records.
- **Less cluttered Booking Dashboard:** Kept its main KPIs focused on booking activity and moved detailed collections, outstanding, expense and receiver/goods breakdowns to Booking Finance.
- **LR charge sheet:** Added a spreadsheet-style per-LR bhada/hamali editor on the owner’s site-trip page. Saves use the existing audited, validated LR update API and canonical `site_lrs` record; reconciled LRs remain locked, closed trips must be reopened, and bhada cannot be reduced below posted payments.
- **Compatibility and storage:** No new collection, database, dependency or migration. Existing `site_lrs`/`site_trips` remain the booking source of truth; the LR report is read-only and paginated.
- **Verification:** Added offline tests for tenant/site report-query scope, owner navigation boundaries, booking report/finance rendering and charge-sheet update requests. The write-enabled API workflow remains opt-in and requires a disposable test tenant.

### v1.6.0 — 27 September 2026

- **Separate booking and industrial workflows:** Booking Dashboard/site trips remain the daily small-goods flow; owner-only Industrial Trips, LRs, Finance and Reports no longer embed or quick-link into site booking records. Global industrial search and Quick Add actions are hidden on booking routes. Shared vehicle/driver/master data remains available.
- **Role boundary:** Industrial business APIs now allow only business owners. Site identity/site authorization remains available to site managers, while platform superadmins continue to use independently guarded platform APIs.
- **Financial isolation:** Industrial ledger balances/statements, cash positions, trip costs, expense lists/cancellation, vehicle expense context, cashbook and chart reads exclude site-tagged shared records. Site expenses cannot be cancelled through the industrial endpoint.
- **Compatibility:** Site and industrial trips/LRs remain in their existing tenant-local collections. Site expenses and postings continue using existing shared collections with `site_id`; no collection, tenant database, migration, or record reset was introduced.
- **Verification:** Focused offline backend authorization, financial-scope and site-operations tests passed (51); frontend suite passed (15 tests across 6 suites); production build completed. Live/write-enabled end-to-end tests were not run because the available local API was not confirmed to belong to this project or a disposable tenant.

### v1.5.0 — 27 September 2026

- **Premium presentation foundation:** Added shared brand-derived CSS/Tailwind tokens, refined surfaces and elevation, numeric typography, keyboard focus styling, and reduced-motion handling without changing the light forest-green/amber palette.
- **Navigation:** Refined the responsive owner sidebar and mobile navigation, made Trips and LRs directly addressable as separate tabs, and kept route selection accurate when other query parameters are present.
- **Booking Dashboard:** Added a more visual KPI/site/activity presentation, quick actions, selected-site drill-down, and responsive charts using site-dashboard data, including daily trip/LR counts and selected-period site totals. Currency charts retain their INR units.
- **Remaining business modules:** Applied the shared visual language to Trips/LR, Finance, Reports, Vehicles, Parties, Team, Settings, and their supporting details/forms while preserving existing API and accounting workflows.
- **Scope and compatibility:** Added a read-only `activity_by_date` aggregate to the site dashboard response; this requires no data migration, new collection, or dependency. Office and site trips/LRs remain distinct canonical record families; no data unification is implied.
- **Verification:** Frontend suite passed (13 tests), focused offline backend site-operations suite passed (39 tests), and production build completed. The write-enabled API workflow was not run. Browser review reached the login page, but the local API was unavailable, so authenticated owner-dashboard visual review could not be completed.

### v1.4.0 — 27 September 2026

- **Owner Trips & LR visibility:** Added an on-demand Site bookings panel for site-created trips and their LRs, with site/trip selection, pagination, CSV export, and links to the canonical site detail/print workflows. Existing office trip/LR screens and site-specific permissions remain unchanged; records are not copied and financial events are not duplicated.
- **Bookings Window Board clarity:** Kept the key site/trip/outstanding indicators visible while grouping detailed business analytics, alerts, filters, site setup, manager permissions, and booking categories into collapsed sections. Trip creation and the selected-site booking/LR context remain in the main workflow.
- **Owner landing/navigation:** Made Booking Dashboard the owner home and sidebar entry, redirected the former `/dashboard` page, and added date presets and quick actions. Total trip KPIs are now explicitly computed for the selected date/site/trip filters.
- **Compatibility and data safety:** No API schema, database, ledger, or storage migration is introduced. The panel reads the existing site-scoped endpoints only when opened and preserves tenant/site authorization.
- **Verification:** Frontend suite passed (13 tests), focused offline backend suite passed (48 tests), and the production build completed. No live MongoDB latency benchmark or migration was run.

### v1.3.1 — 27 September 2026

- **Startup compatibility:** Aligned the trip-expense idempotency index declaration with the existing named index in deployed business databases, so application startup reuses it instead of failing with `IndexKeySpecsConflict`. No records or indexes are dropped.
- **Window loading:** Lazy-loaded route page bundles, removed duplicate Bookings Window Board fetch cycles, and delayed Trips-page master/settings requests until the Trips tab is opened.
- **Trip list scaling:** Bounded related LR/expense/fuel aggregation work to the current page of trip IDs instead of grouping all matching tenant history for every list request.
- **Data safety:** No database reset, destructive migration, or storage-format rewrite is required. Existing tenant data remains in place.
- **Verification:** Backend regression tests and frontend tests/build; live database latency and production request timings remain deployment-specific and were not measured here.

### v1.3.0 — 27 September 2026

- **Operation feedback:** Added top-right confirmations for successful updates and actionable failure notices. Unexpected server failures include a reference ID and are retained in the platform error log for super-admin follow-up; sensitive request content is excluded.
- **Bookings Window Board:** Reframed the multi-site owner dashboard around bookings, with current site/trip/LR context and receiver-/goods-oriented outstanding summaries.
- **Trip and LR workflow:** Added optional sender/receiver phone numbers, faster LR print-after-create behavior with repeatable browser print, and clearer mobile-friendly owner/manager trip and LR screens.
- **Trip expense accountability:** Added trip-linked expenses using existing ledger/cashbook accounting and an auditable record of responsibility.
- **Structured ledger reports:** Kept the immutable-ID import template contract intact while making report CSVs easier to read and adding detailed goods/container rows with clear scope and amount units.

### v1.2.2 — 27 September 2026

- **Dashboard/site listing fix:** Preserved top-level MongoDB IDs in the site API serializer, resolving the `KeyError: '_id'` 500 shown by `/api/sites` and `/api/sites/system-dashboard` and restoring populated site selectors.
- **Trip assignments:** Added permission-checked tenant vehicle/driver choices, retained IDs plus trip snapshots, and added manual fallback. Managers and owners can edit assignments while the trip is open.
- **End-to-end coverage:** Added an opt-in workflow test for site/manager setup, trip and LR create/edit, payments, ledger export/import/reconciliation, and dashboard aggregation. It is disabled by default to prevent writing to an unintended live API.
- **Pylance diagnostics:** Fixed optional-value and untyped response issues in `site_ops.py` and removed unused imports/locals.

### v1.2.1 — 27 September 2026

- **Startup fix:** Made the unique payment reversal index match the sparse index already created in existing tenant databases, avoiding `IndexKeySpecsConflict` during backend startup.
- **Payment integrity:** Rejected balance-invalid payment events are now marked rejected and excluded from collected totals; owners can retry interrupted ledger/cashbook postings, and payment reversals can resume idempotently.
- **Payment UX:** Payment submissions reuse an idempotency key across retries, reset after success, display posting state, and explain the reversal-and-reentry correction workflow.
- **Authorization and dashboard consistency:** Finance editors can retrieve the current values they are permitted to change; site and system dashboards exclude rejected payment events from collection totals.
- **Verification:** Added offline regression tests for the deployed index specification and rejection of invalid payment balances.

### v1.2.0 — 27 September 2026

- **Multi-site operations:** Added business sites with stable IDs, unique codes, operating timezones and owner-managed lifecycle.
- **Roles and access:** Added site-manager accounts, explicit site/action grants, manager replacement/deactivation, and backend-enforced tenant/site authorization.
- **System Dashboard:** Added business-wide and site-specific operational/financial summaries, filters, alerts, activity, and drill-down.
- **Trips and LRs:** Added site-scoped daily trips and LRs with atomic numbering, multi-container booking, receiver duplicate confirmation, close/reopen controls, custom categories and printable customer LRs.
- **Ledger reconciliation:** Added per-trip versioned CSV exports and owner-only staged import preview/edit/confirmation, immutable-ID matching, idempotency and recovery state.
- **Payments:** Added auditable partial payment and reversal events; separated recorded rent, reconciled rent, actual collections, outstanding balances and hamali.
- **Migration and operations:** Added explicit legacy site-assignment preview/apply, tenant-local indexes, and timezone data dependency.
- **Documentation and tests:** Documented roles, routes, storage/security boundaries, migration, accounting caveats and architecture diagrams; added offline site-operation unit tests.
- **Compatibility/limitations:** Existing tenant-per-database and legacy APIs remain in place. Businesses must create a default site and explicitly apply legacy assignment. CSV uses separate files rather than workbook sheets; ledger originals still use local storage. Hamali remains informational.

### v1.1.2 — 27 September 2026

- **Documentation:** Added an end-to-end product summary, architecture and design diagrams, and a mandatory AI/maintainer change checklist.
- **Release process:** Established SemVer rules, required version synchronization, and a changelog entry for every retained app change set.
- **Metadata:** Aligned the frontend package version with the product release.

### v1.1.1 — 19 September 2026

- LR uses the business logo saved on upload, with initials when no logo exists.
- Prevented empty master requests such as `/api/masters/null`.
- Limited platform-owner navigation to Licences and Console; added the server error log view.
- Updated login branding and button styling; improved advance/repayment and export/PDF presentation.

### v1.1.0 — 19 September 2026

- Logo and owner-photo uploads save locally without a cloud key; business branding appears in the UI and LR.
- Added ProFleet branding and removed default-password prefill/display from login.
- Added temporary or permanent trip vehicles/drivers and trip-hire payment/due handling.
- Changed new tenant database names to readable business/owner-derived names.
- Improved small-screen LR actions and button styling.

### v1.0.0 — 18 September 2026

- First documented local-run release, including environment setup, roles, and tenant data separation.
- Added platform-owner seeding/configuration and platform licence-control navigation.
- Documented the FastAPI + MongoDB backend, React 18 frontend, transport-office workflows, and multi-tenant platform.
