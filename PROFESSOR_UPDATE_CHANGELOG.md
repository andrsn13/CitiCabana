# Professor Review Updates — Implementation Changelog

This document records the implementation completed in response to the professor's update specifications and the follow-up clarifications. It is a standalone presentation summary; it does not replace the project's general [`CHANGELOG.md`](./CHANGELOG.md).

## Status at a glance

| Update item | Status |
| --- | --- |
| Centered booking-bar labels and provided a dropdown of preset guest counts | Completed |
| Added hero and Villa image carousels | Completed |
| Added a room-status color legend for front-desk staff | Completed |
| Added ongoing room-type and inventory management | Completed |
| Added date-filtered report printing with browser Save as PDF | Completed |
| Added booking-confirmation email with 50% downpayment instructions | Implemented; requires SMTP configuration for delivery |
| Made the public room catalog data-driven and room cover images CMS-editable | Completed; additional-image management is currently Villa-only |

## Detailed changelog

### 1. Centered booking-bar labels and preset guest-count dropdown

- Centered the Check-in, Check-out, and Guests labels/fields in the floating booking bar.
- Replaced manual guest-count entry with a dropdown containing predefined counts from 1 to 10.
- Carried the selected guest count through to the room-booking form, avoiding arbitrary values outside the listed choices.

### 2. Hero and Villa image carousels

- Added a navigable image carousel to the landing-page hero, with previous/next controls and slide indicators.
- Added a separate carousel to the full-width Villa listing in the Rooms section.
- Added initial local placeholder Villa slides so the carousel can be demonstrated before the hotel supplies final photography.
- Villa slides can be managed in the admin CMS; uploaded images are stored with the room data.

### 3. Room-status color legend for front-desk staff

- Added a visible legend to the Room Status screen explaining the colors used for **Occupied**, **Needs Cleaning**, and **Ready**.
- This gives front-desk staff a key for interpreting the status board.

### 4. Ongoing room-type and inventory management

- Replaced reliance on a fixed set of room types and quantities with CMS-managed room records and inventory.
- Admins can add room types, edit their details and quantity, and archive or restore room types later as the hotel changes—not only during first-time setup.
- Public room listings and room-booking choices are populated from active room records rather than being limited to the original five types.
- Inventory changes synchronize the physical room-status units. Reductions are guarded when they would remove units that are not Ready or leave upcoming confirmed bookings beyond available inventory.
- Archiving hides a room type from public booking while retaining its record and historical booking references. Archiving is blocked when room status or upcoming bookings make it unsafe.

### 5. Date-filtered report printing with browser Save as PDF

- Added start- and end-date selection for reports.
- The report is generated for bookings created within the selected date range; changing either date requires generating the report again before export.
- Added an export action for the currently selected report. It opens the browser's print dialog, where the user can choose **Save as PDF**.
- Uses built-in browser printing, so a third-party PDF service or paid PDF library is not required.
- Updated report content to show room and event booking counts instead of an in-system downpayment total, since the application does not record payments.

### 6. Booking-confirmation email with 50% downpayment instructions

- Added customer email capture to room and event booking requests, with email editing available to admins for an existing booking.
- Sends a confirmation email when staff confirms a booking. Admin-created bookings also report whether confirmation delivery succeeded.
- The email includes the booking details, states that a **50% downpayment is required**, and asks the customer to reply or contact the front desk to arrange the amount and payment method directly.
- Payment is outside the application: the system does not collect, process, or record the downpayment.
- Added an admin retry path and explicit delivery feedback for failed sends.
- Email delivery uses SMTP settings supplied by the operator. SMTP credentials are not included in the repository; configure the SMTP values in the private local `.env` file before expecting real email delivery.

### 7. Data-driven public room catalog and CMS-editable cover images

- Updated the public Rooms section to render the room types returned by the application rather than relying on a fixed five-card structure.
- New room types use a shared room-card layout by default, so adding a type does not require building a new public page layout.
- Kept the Villa presentation full-width and carousel-enabled, and ensured it remains the last public listing even when new room types are added; other room types use the standard room presentation.
- Made each room type's cover image editable through the CMS. Additional-image management is currently available for the Villa only; its initial carousel includes local placeholder images.
- No admin-selectable layout designer was added. The current approach uses a reusable standard layout and the existing full-width Villa treatment.

## Verification and outstanding setup

- `npm run build` passed.
- `npm run lint` passed.
- `node --check` passed for the changed JavaScript files, and `git diff --check` reported no whitespace errors.
- The build displays existing, non-blocking Vite notices about classic script tags not being bundled as ES modules.
- Real SMTP delivery was not verified because SMTP credentials are not configured. Database-backed workflows and the visual PDF output should be demonstrated against a safe local/test setup before making claims about those live behaviors.
