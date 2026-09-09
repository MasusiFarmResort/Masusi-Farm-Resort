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
Both Cottage + Ligo and Room bookings now automatically show a Booking Scan Code, QR Code and CODE128 barcode immediately after a new booking is saved. Existing bookings have a Barcode / QR action in their booking list.

## V2.3 — Day/Night Rates + Discount Engine
V2.3 adds a reusable Rates & Pricing page with separate Day Tour and Night Tour entrance/swimming prices. Cottage + Ligo bookings require the selected tour rate and calculate automatically. Senior/PWD discounts now support either Whole Bill (percentage applied once to the current running gross bill) or One Qualified Person Only. Multiple qualified guests never multiply the whole-bill percentage.


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
