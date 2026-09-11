# Masusi Farm Resort Management System

Professional responsive resort management starter system for desktop, tablet and phone.

## Included
- Dashboard with monthly filter
- Rooms + Cottages live queue on one page
- Dedicated second-screen live display
- Bookings, availability calendar, guests
- USB/Bluetooth HID barcode scanning flow
- Billing/charges, payments, invoices
- Expenses, damage reports, repairs, inventory
- Monthly filters and printable reports
- Custom modal Add / Edit / View / Archive confirmations
- Supabase Auth + RLS-ready SQL
- Roles: admin, manager, reception, cashier, staff, display
- Realtime updates for bookings, rooms and cottages
- Logo upload handler through Supabase Storage
- PWA files for install-like use on supported devices
- Mobile layout designed to avoid whole-page horizontal scrolling

## Setup
1. Create a new Supabase project.
2. Open SQL Editor and run `supabase_schema.sql`.
3. Create your Auth user in Authentication > Users.
4. Promote the first user to admin using the SQL command at the bottom of `supabase_schema.sql`.
5. In Supabase Project Settings / API, copy:
   - Project URL
   - anon / publishable key
6. Open `config.js` and replace:
   - `PASTE_YOUR_SUPABASE_URL_HERE`
   - `PASTE_YOUR_SUPABASE_ANON_KEY_HERE`
7. Test locally through a small web server or publish to GitHub Pages.

## GitHub security
It is normal for the browser to contain the Supabase project URL and anon/publishable key.
Protection comes from Supabase Auth + Row Level Security.
NEVER place the service_role key in this project.

## Bluetooth barcode scanner on tablet
Use a scanner that supports Bluetooth HID / keyboard mode.
Pair it with the tablet, open Barcode Scanner in the system, and scan.
Most HID scanners type the code into the focused field and optionally send Enter.

## Second screen
Click `Second Screen` in the top bar or Live Rooms & Cottages page.
The display opens `second-screen.html` and is intentionally privacy-safe:
- unit name/number
- status
- guest count only
No guest names, phone numbers, balance, Senior/PWD detail, or other sensitive data.

## Logo handler
A placeholder logo is included at `assets/logo-placeholder.svg`.
Admin/Manager can upload the actual Masusi Farm Resort logo in Settings after the Supabase Storage bucket is created by the SQL script.

## Important production note
This package is a complete working foundation, but before real resort launch you should still test:
- discount rules and legal/tax treatment
- final rates
- printing on the exact receipt/invoice printer
- barcode scanner model
- staff permissions
- backup/restore procedure
- all booking overlap edge cases

## Operations V2 upgrade (for an existing installation)
If you already ran `supabase_schema.sql`, DO NOT run it again. Run `supabase_upgrade_v2.sql` once.
It adds:
- one barcode/code per pax
- first-scan cottage assignment
- EXIT / RETURN access history
- booking barcode/code account lookup
- cottage running account
- unlimited partial/full payments using the same payments table
- automatic booking balance/payment status recalculation
- services library
- store/POS inventory deductions and stock movement history

### V2 operating flow
1. Create/edit a booking and enter Adults, Kids, Babies, Senior/PWD and Base Booking Amount.
2. The database automatically creates one unique `MFR-PAX-...` code per pax.
3. Scan a pax for the first time → select cottage → Assign & Check In.
4. Scan the same pax while INSIDE → Mark OUT, Add Purchase, or open Cottage Account.
5. Scan the same pax while OUTSIDE → Mark RETURNED. The system remembers the cottage.
6. Scan/enter the booking code → Add Payment, open account, or print booking/pax codes.
7. Store/POS sales deduct inventory and add the same amount to the booking/cottage running account.
8. Every payment appears in the booking account, Payments module and reports because there is only one payments table.


## V2.2 Booking Barcode / QR
Both Cottage + Swimming and Room bookings now automatically show a Booking Scan Code, QR Code and CODE128 barcode immediately after a new booking is saved. Existing bookings have a Barcode / QR action in their booking list.

## V2.3 — Day/Night Rates + Discount Engine
V2.3 adds a reusable Rates & Pricing page with separate Day Tour and Night Tour entrance/swimming prices. Cottage + Swimming bookings require the selected tour rate and calculate automatically. Senior/PWD discounts now support either Whole Bill (percentage applied once to the current running gross bill) or One Qualified Person Only. Multiple qualified guests never multiply the whole-bill percentage.


## V2.4 Pax Barcode Rules
Booking Scan Codes are generated automatically by the system.

Pax/Companion codes are NOT required to be generated automatically.
For each pax, staff can use:
- Manual code entry
- Scan a pre-printed physical barcode/QR code
- Optional Auto Generate
- Clear/replace code

This supports resorts that already print their own wristbands/cards/barcodes.


## V2.5 Room Time Policy
Room bookings now enforce and record the resort's time policy:
- 2:00 PM check-in
- 11:00 AM final-day check-out
- PHP150 per started hour for early check-in and late check-out

The scanner shows whether the guest is not yet allowed, early, on time, a late arrival, or outside the booking window. Early and late fees are posted automatically to the same booking running account after staff confirmation. The policy is editable in Settings.


## V2.6 Automatic Sorting & Audit Retention
All main tables use automatic natural sorting and visible 1-based numbering. Filtered results re-number automatically. Audit Logs are kept newest-first and the database automatically retains only the newest 500 records.


## V2.7 Save Booking Barcode as Image
Booking Barcode / QR now has a **Save as Image** button that exports a client-ready PNG card. The image includes the resort name/logo, booking number, booking scan code, QR code, barcode, guest/client name, unit assignment, and booking dates. This is designed so staff can send the PNG directly to the client through Messenger, SMS, or other chat apps.


## V2.8 Camera Scanner + Client/Internal Image Versions
The Barcode Scanner page now supports phone/tablet camera scanning using the rear camera where available. Booking Barcode/QR image export is split into a clean Client Version and a more detailed Internal Version. GitHub Pages HTTPS supports browser camera permissions; users must allow camera access.


## V2.9 Roles & Access
Adds reusable roles, page-level View/Add/Edit/Delete/Delete All permissions, secure user creation through a Supabase Edge Function, user enable/disable, permission-aware navigation/buttons, and database-side RLS permission checks. See `V2_9_UPDATE_STEPS.txt`.


## V3.0 Print Card + Special Event Rate
The Booking Barcode / QR print action now prints only a clean card containing the Booking Scan Code, guest/client name, and assigned Room or Cottage, plus the QR code and barcode. A built-in **Special Event Rate** option is also supported in Rates & Pricing alongside Day and Night rates. See `GITHUB_READY_SECURITY_CHECKLIST.txt` for GitHub/privacy guidance.


## V3.1 Security Hardening + QR/Barcode PNG Export
This update adds strict page/action RLS policies for the main resort tables, removes legacy broad staff policies, and adds dedicated **Save QR PNG** and **Save Barcode PNG** actions in the Booking Barcode / QR modal. The print action now uses a more professional booking card layout while still showing only the requested minimal details.


## V3.2 Pax QR and Live View Barcode Buttons
Pax/Companion Barcode Manager now has a **Show QR** action for every pax with an assigned code. Live View details for Rooms and Cottages now include **View Booking Barcode** and **View Pax Barcodes** shortcuts. Running Account modals also include the same barcode shortcuts.


## V3.3 Button Visibility & CSS Consistency
Reviewed the global button CSS and fixed specificity conflicts that caused semantic buttons such as **Add Payment** to appear white inside `.row-actions`. Primary, soft, outline, danger, modal-footer, table-action, icon, hover, focus, disabled, and mobile button states now have explicit readable contrast.


## V3.4 Mobile / Tablet / iPad Responsive Overhaul
The entire system CSS was reviewed for smaller screens. The main layout no longer requires page-level horizontal scrolling. On tablets the sidebar becomes a horizontal top navigation strip, while phones use a compact top nav and single-column content. Tables remain horizontally scrollable only inside their own table container when the number of columns makes it unavoidable.


## V3.5 Pax Demographics + Room Key ID Deposit
Pax records now support Name/Nickname, Gender, Area, and Other location. Reports can summarize monthly/yearly pax, gender distribution, and guests from outside Naic. Room bookings now include ID type provided and room key tracking without storing the ID number.


## V3.6 Professional Invoice and Report Printing
This update replaces the old print-the-screen behavior for Reports with a dedicated professional print document. It also adds a professional invoice preview/print flow for the Invoices module, including invoice header, guest/unit details, charge breakdown, payment history, and formal signature lines.


## V3.7 System-Wide Professional Reports
Every major system page can now generate a dedicated professional report instead of printing the screen. A global **Page Report** button is available from the top bar. Period-based modules can produce either a selected-month report or a complete whole-year report. The central Reports page now has a Month/Whole Year period selector.


## V3.8 Full Invoice Standardization + Month/Year Reports Everywhere
All invoice entry points now use one professional invoice format. The Invoices page has been rebuilt with Generate Invoice, View, Print, Save PNG, Refresh Totals, Void, search, status, and Month/Whole Year filters. Booking pages and Running Account now link to the same invoice system.

All Page Reports now ask for either **Selected Month** or **Whole Year**. Master/operational modules no longer bypass the period selector: their reports use real activity dates (created records, bookings/utilization, stock movements, audit changes, etc.) for the selected period.


## V3.9 Coupon / Voucher System
Adds a reusable Coupons & Vouchers library with generated coupon codes, percentage/fixed discounts, minimum spend, validity dates, maximum uses, optional maximum discount, activation, and configurable Senior/PWD stacking. Coupons are applied to bookings through a server-side Supabase RPC, included in running account totals and professional invoices, and audited through redemption history and professional Coupon Reports.


## V4.0 Responsive UI Hardening + Staff QR-First Login
This release is a UI/CSS hardening pass designed not to alter business functions. Desktop styling is polished while phone/tablet/iPhone/iPad layouts avoid page-level horizontal scrolling. On screens up to 1024px, navigation uses the existing hamburger drawer instead of a horizontally scrolling navigation bar. Wide data tables are automatically converted into labeled card rows on smaller screens. Staff-role accounts now land on Barcode Scanner after login when that role has Barcode view permission.


## V4.1 Pax-First Booking Flow
Booking creation no longer asks for Adults/Kids/Babies/Senior/PWD counts. The reservation captures the booker/client, dates, selected room/cottage, and rate. The booker is automatically created as Pax #1 with an unclassified category. Companions are added from Pax Manager without guessing their category. When an unclassified pax QR/barcode is scanned, the system first asks whether the pax is Adult, Kid, Baby, Senior, or PWD, then continues the normal access/check-in scan. Classified pax rows automatically become the source of truth for booking pax counts and pricing.


## V4.2 UX Simplification
V4.2 keeps the existing functions but reduces visual clutter. Pax Manager now has one unified **Edit Pax** action that edits Name, Category (Adult/Kid/Baby/Senior/PWD), Gender, and Area. Secondary barcode-management commands are grouped under **More**. Across the system, rows with many buttons keep their main actions visible while secondary actions move into a More menu. The same simplification is responsive on desktop, tablets/iPad, and phones/iPhone.


## V4.3 Action Menu Overflow Fix
Fixes the desktop issue where the **More** dropdown inside booking and other data tables was clipped by `.table-scroll`, causing an internal scrollbar before the menu could be seen. On desktop, More menus are now rendered as floating menus above the table scroll container. Existing action handlers are preserved. Tablet/mobile continue to use inline full-width More menus.


## V4.4 Pax Category Report
Pax Demographics & Area Report now includes Adult, Senior, PWD, Kid, Baby, and Not Classified counts in both the on-screen report and the professional printed Month/Whole Year report. Pax Details also includes each pax category.


## V4.5 Coupon in Booking and Payment
Coupon/Voucher is now directly available while creating/editing a booking and while adding a payment. Booking save validates and applies the entered coupon through the existing server-side coupon RPC. Add Payment shows the current coupon, coupon discount, Apply/Change Coupon, and Remove Coupon before the payment is recorded.


## V4.6 Invoice Constraint Fix + Availability Highlight
Fixes invoice creation/refresh against the existing Supabase `invoices_status_check`: the database only receives `open`, `paid`, or `void`, while the UI can still display the more useful `Unpaid` and `Partial` labels from live payment totals. Availability Calendar now highlights Occupied dates/units in red, Reserved in amber, Available in green, with Cleaning/Maintenance in gray.


## V4.8 Availability Calendar Redesign
Availability Calendar was rebuilt to keep unit names horizontal and readable. Desktop uses a fixed 190px unit column and internal calendar scrolling. Reserved and Occupied cells show the guest/client name and booking number. Occupied is red, Reserved amber, Available green. Tablet/iPad/phone use unit cards with horizontal unit titles and vertically stacked dates, preventing page-level horizontal scrolling.


## V4.9 Availability Top Scrollbar
Desktop Availability Calendar now has a synchronized horizontal scrollbar above the calendar. Users no longer need to scroll to the bottom of the unit list just to move through dates. The original bottom scrollbar remains and both scroll positions stay synchronized.


## V5.0 Final Responsive CSS Review
A final responsive CSS hardening pass was applied across the entire system without changing business logic. Desktop received spacing and readability improvements. Tablet/iPad uses a proper drawer sidebar, two-column filters/forms where practical, responsive card tables, and safe modals. Phone/iPhone uses single-column layouts, full-width touch actions, bottom-sheet style modals, no page-level horizontal scroll, and iOS safe-area support. The V4.8 Availability calendar layout is preserved.


## V5.1 Clean Production Build — Operations Consolidated
All root-level `operations-v*.js` patch files were consolidated into a single
`operations.js` file. The exact V5.0 script execution order was preserved, so
the latest overrides still win in the same order as before.

The production page now loads:
- `config.js`
- `app.js`
- `operations.js`

The individual `operations-v*.js` files are no longer required by the deployed
system and were removed from the V5.1 package. A
`OPERATIONS_CONSOLIDATION_MANIFEST.json` file records the original file order
and SHA-256 hashes for traceability.

This is a code-organization/deployment cleanup. No new SQL is required.


## V5.2 Reports Page — On-Screen Report Preview
The Reports page **Generate** button now renders the complete selected report
inside the page itself. Users no longer need to print first just to review the
report. The on-screen report includes KPI summaries, full tables, selected
period, generated timestamp, and Pax category breakdown where applicable.

`Professional Print` remains available and now uses the same report-building
logic as the on-screen preview.


## V5.3 Booking Action Priority
Booking action rows now prioritize **Payment** as a visible action outside the
`More` menu. **Coupon** is moved into `More`. Existing button handlers are
preserved because the actual DOM button elements are moved rather than recreated.


## V5.4 Add Pax — Provided QR/Barcode First
Adding a pax now prioritizes the resort-provided physical QR/barcode. The Add
Pax modal has a large code field, a **Scan Provided QR / Barcode** camera button,
and direct support for USB/Bluetooth scanners. **Auto Generate Code** remains
available as a secondary fallback. A pax cannot be added without a unique code.
The category remains unclassified until entry scan or Edit Pax.


## V5.5 Multi-Mode Barcode / QR Workflow
The Barcode Scanner now has four explicit modes: **Existing Pax**, **Booking**,
**Assign Pax QR**, and **Auto Detect**. A pre-printed QR can be scanned before it
exists in the database, then assigned to an active booking, an existing pax with
no code (or a newly created pax), and the appropriate cottage/room. Assignment
does not automatically check the pax in; scanning the code again as Existing
Pax continues the normal check-in/OUT/RETURN flow.


## V5.6 Pax Category During QR Assignment
The **Assign Pax QR** workflow now requires the pax category before saving:
Adult, Kid, Baby, Senior, or PWD. Existing pax with a known category are
preselected automatically. New or unclassified pax must be classified during
assignment. The existing `classify_booking_pax_v41` RPC remains the source of
truth so booking pax counts and billing/rate calculations stay synchronized.
