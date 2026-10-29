import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockingStatus,
  propertyToday,
  rangesOverlap,
  validDate,
  validStay,
} from "./booking-rules.js";

test("validates real calendar dates and requires at least one night", () => {
  assert.equal(validDate("2026-10-29"), true);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2025-02-29"), false);
  assert.equal(validDate("2026-10-29T00:00:00"), false);
  assert.equal(validStay("2026-10-29", "2026-10-30"), true);
  assert.equal(validStay("2026-10-29", "2026-10-29"), false);
});

test("uses half-open night ranges with legal back-to-back stays", () => {
  assert.equal(
    rangesOverlap("2026-10-25", "2026-10-27", "2026-10-27", "2026-10-29"),
    false,
  );
  assert.equal(
    rangesOverlap("2026-10-25", "2026-10-27", "2026-10-26", "2026-10-28"),
    true,
  );
  assert.equal(
    rangesOverlap("2026-10-29", "2026-10-31", "2026-10-30", "2026-11-01"),
    true,
  );
});

test("only pending, confirmed, and checked-in bookings hold inventory", () => {
  for (const status of ["Pending", "Confirmed", "CheckedIn"]) {
    assert.equal(isBlockingStatus(status), true);
  }
  for (const status of ["CheckedOut", "Cancelled", "Rejected", "NoShow"]) {
    assert.equal(isBlockingStatus(status), false);
  }
});

test("property date is formatted in Asia/Manila", () => {
  assert.match(propertyToday(), /^\d{4}-\d{2}-\d{2}$/);
});
