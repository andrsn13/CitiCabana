export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function validStay(checkIn, checkOut) {
  return validDate(checkIn) && validDate(checkOut) && checkOut > checkIn;
}

export function validContactNumber(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length > 32 || !/^\+?[\d\s().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function minimumCheckoutDate(checkIn, today) {
  if (today > checkIn) return today;
  const nextDay = new Date(`${checkIn}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.toISOString().slice(0, 10);
}

export function isBlockingStatus(status) {
  return ["Pending", "Confirmed", "CheckedIn"].includes(status);
}

export function propertyToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
