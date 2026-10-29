import test from "node:test";
import assert from "node:assert/strict";
import "../js/booking-view-rules.js";

const { belongsToTab } = globalThis.bookingViewRules;
const today = "2026-10-29";

test("Needs action includes every Pending request and stale confirmed or in-house stays", () => {
  const bookings = [
    { status: "Pending", checkIn: "2026-10-25", checkOut: "2026-10-27" },
    { status: "Pending", checkIn: "2026-11-02", checkOut: "2026-11-05" },
    ...[1, 2, 3].map(() => ({
      status: "CheckedIn",
      checkIn: "2026-10-24",
      checkOut: "2026-10-26",
    })),
    { status: "Confirmed", checkIn: "2026-10-28", checkOut: "2026-10-30" },
    { status: "Confirmed", checkIn: today, checkOut: "2026-10-31" },
  ];

  assert.equal(
    bookings.filter((booking) =>
      belongsToTab(booking, "needs-action", today),
    ).length,
    6,
  );
});

test("confirming a future Pending request moves it from Needs action to Upcoming", () => {
  const booking = {
    status: "Pending",
    checkIn: "2026-11-02",
    checkOut: "2026-11-04",
  };
  assert.equal(belongsToTab(booking, "needs-action", today), true);

  booking.status = "Confirmed";
  assert.equal(belongsToTab(booking, "needs-action", today), false);
  assert.equal(belongsToTab(booking, "upcoming", today), true);
});

test("arrival, check-in, checkout, and cancellation memberships are date-derived", () => {
  const booking = {
    status: "Confirmed",
    checkIn: today,
    checkOut: "2026-10-31",
  };
  assert.equal(belongsToTab(booking, "today", today), true);

  booking.status = "CheckedIn";
  assert.equal(belongsToTab(booking, "today", today), false);
  assert.equal(belongsToTab(booking, "in-house", today), true);

  booking.status = "CheckedOut";
  booking.checkOut = today;
  assert.equal(belongsToTab(booking, "past", today), true);

  booking.status = "Rejected";
  assert.equal(belongsToTab(booking, "cancelled", today), true);
});
