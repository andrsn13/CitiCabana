let availabilityRequestId = 0;
let reviewResolver = null;
let roomAvailabilityChecked = false;
let roomAvailabilityAvailable = false;

document.addEventListener("DOMContentLoaded", () => {
  const roomForm = document.getElementById("room-booking-form");
  const eventForm = document.getElementById("event-booking-form");
  const checkIn = document.getElementById("room-checkin");
  const checkOut = document.getElementById("room-checkout");
  const roomSelect = document.getElementById("room-type-select");
  const eventDate = document.getElementById("event-date");
  const barCheckIn = document.getElementById("bar-checkin");
  const barCheckOut = document.getElementById("bar-checkout");
  const today = propertyToday();

  ["room-success-msg", "event-success-msg"].forEach((id) => {
    const message = document.querySelector(`#${id} p`);
    if (message) message.dataset.defaultMessage = message.textContent.trim();
  });

  if (checkIn) checkIn.min = today;
  if (checkOut) checkOut.min = addDateDays(today, 1);
  if (eventDate) eventDate.min = today;
  if (barCheckIn) barCheckIn.min = today;
  if (barCheckOut) barCheckOut.min = addDateDays(today, 1);
  if (barCheckIn && barCheckOut) barCheckIn.addEventListener("change", () => {
    barCheckOut.min = addDateDays(barCheckIn.value || today, 1);
  });

  roomForm?.addEventListener("submit", handleRoomBooking);
  eventForm?.addEventListener("submit", handleEventBooking);
  [checkIn, checkOut].forEach((input) => {
    input?.addEventListener("change", () => {
      updateStayConstraints();
      checkRoomAvailability();
      calculateOrderSummary();
    });
  });
  checkIn?.addEventListener("input", updateStayConstraints);
  checkOut?.addEventListener("input", updateStayConstraints);
  roomSelect?.addEventListener("change", () => {
    updateRoomGuestLimit();
    checkRoomAvailability();
    calculateOrderSummary();
  });
  document
    .getElementById("room-pax")
    ?.addEventListener("input", validateRoomGuestCount);

  ["room-contact", "event-contact"].forEach((id) => {
    const input = document.getElementById(id);
    input?.addEventListener("beforeinput", (event) => {
      if (
        event.inputType === "insertText" &&
        event.data &&
        /[^\d+().\s-]/.test(event.data)
      ) {
        event.preventDefault();
      }
    });
    input?.addEventListener("input", () => {
      const start = input.selectionStart;
      const sanitized = input.value.replace(/[^\d+().\s-]/g, "");
      input.value = sanitized.startsWith("+")
        ? `+${sanitized.slice(1).replace(/\+/g, "")}`
        : sanitized.replace(/\+/g, "");
      if (start !== null) {
        const cursor = Math.min(input.value.length, start);
        input.setSelectionRange(cursor, cursor);
      }
      validateContactNumber(input);
    });
    input?.addEventListener("blur", () => validateContactNumber(input));
  });

  ["room-name", "event-name"].forEach((id) => {
    const input = document.getElementById(id);
    input?.addEventListener("input", () => {
      input.setCustomValidity(
        input.value.trim() ? "" : "Enter your name without only spaces.",
      );
    });
  });

  const eventType = document.getElementById("event-type");
  eventType?.addEventListener("change", updateOtherEventType);
  document
    .getElementById("event-type-other")
    ?.addEventListener("input", validateOtherEventType);

  document.getElementById("booking-review-back")?.addEventListener("click", () => {
    document.getElementById("booking-review-dialog").close();
  });
  document
    .getElementById("booking-review-submit")
    ?.addEventListener("click", () => {
      const button = document.getElementById("booking-review-submit");
      button.disabled = true;
      reviewResolver?.(true);
      reviewResolver = null;
      document.getElementById("booking-review-dialog").close();
      button.disabled = false;
    });
  document
    .getElementById("booking-review-dialog")
    ?.addEventListener("close", () => {
      reviewResolver?.(false);
      reviewResolver = null;
    });

  updateStayConstraints();
  updateOtherEventType();
});

function propertyToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDateDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatBookingDate(value) {
  if (!value) return "Not selected";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function updateStayConstraints() {
  const checkIn = document.getElementById("room-checkin");
  const checkOut = document.getElementById("room-checkout");
  const error = document.getElementById("room-date-error");
  if (!checkIn || !checkOut || !error) return;

  const today = propertyToday();
  checkIn.min = today;
  checkOut.min = checkIn.value
    ? addDateDays(checkIn.value, 1)
    : addDateDays(today, 1);

  let message = "";
  if (checkIn.value && checkIn.value < today) {
    message = "Check-in must be today or a future date.";
  } else if (checkOut.value && checkOut.value < today) {
    message = "Check-out must be today or a future date.";
  } else if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value) {
    message = "Check-out must be at least one night after check-in.";
  }
  checkIn.setCustomValidity(
    checkIn.value && checkIn.value < today ? message : "",
  );
  checkOut.setCustomValidity(
    checkOut.value &&
      ((checkIn.value && checkOut.value <= checkIn.value) ||
        checkOut.value < today)
      ? message
      : "",
  );
  error.textContent = message;
  error.style.display = message ? "block" : "none";
}

function validateContactNumber(input) {
  const value = normalizeContactNumber(input.value);
  const valid = /^\+?\d{7,15}$/.test(value);
  input.setCustomValidity(
    valid ? "" : "Enter 7 to 15 digits, optionally starting with +.",
  );
  input.setAttribute("aria-invalid", String(!valid));
  return valid;
}

function normalizeContactNumber(value) {
  const sanitized = value.replace(/[^\d+]/g, "");
  return sanitized.startsWith("+")
    ? `+${sanitized.slice(1).replace(/\+/g, "")}`
    : sanitized.replace(/\+/g, "");
}

function selectedRoomCapacity() {
  const option = document.getElementById("room-type-select")?.selectedOptions[0];
  const capacity = Number(option?.dataset.maxGuests);
  return Number.isInteger(capacity) && capacity > 0 ? capacity : null;
}

function updateRoomGuestLimit() {
  const guests = document.getElementById("room-pax");
  const hint = document.getElementById("room-pax-help");
  if (!guests || !hint) return;
  const capacity = selectedRoomCapacity();
  if (capacity) {
    guests.max = String(capacity);
    hint.textContent = `This room type accommodates up to ${capacity} guests.`;
  } else {
    guests.removeAttribute("max");
    hint.textContent = "";
  }
  validateRoomGuestCount();
}

function validateRoomGuestCount() {
  const guests = document.getElementById("room-pax");
  if (!guests) return false;
  const count = Number(guests.value);
  const capacity = selectedRoomCapacity();
  let message = "";
  if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647) {
    message = "Enter a whole number of at least one guest.";
  } else if (capacity && count > capacity) {
    message = `This room type accommodates up to ${capacity} guests. Choose a lower guest count or another room type.`;
  }
  guests.setCustomValidity(message);
  guests.setAttribute("aria-invalid", String(Boolean(message)));
  return !message;
}

function updateOtherEventType() {
  const selector = document.getElementById("event-type");
  const wrapper = document.getElementById("event-type-other-group");
  const input = document.getElementById("event-type-other");
  if (!selector || !wrapper || !input) return;
  const isOther = selector.value === "Other";
  wrapper.hidden = !isOther;
  input.required = isOther;
  if (!isOther) {
    input.value = "";
    input.setCustomValidity("");
  } else {
    validateOtherEventType();
  }
}

function validateOtherEventType() {
  const input = document.getElementById("event-type-other");
  if (!input || input.closest("[hidden]")) return true;
  const valid = Boolean(input.value.trim());
  input.setCustomValidity(valid ? "" : "Please describe the event.");
  return valid;
}

function setFormError(id, message) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.style.display = message ? "block" : "none";
}

async function checkRoomAvailability() {
  const checkId = ++availabilityRequestId;
  const roomId = document.getElementById("room-type-select").value;
  const checkIn = document.getElementById("room-checkin").value;
  const checkOut = document.getElementById("room-checkout").value;
  const message = document.getElementById("room-availability-message");
  const submitButton = document.querySelector(
    '#room-booking-form button[type="submit"]',
  );
  const today = propertyToday();

  message.classList.remove("unavailable");
  roomAvailabilityChecked = false;
  roomAvailabilityAvailable = false;
  if (!roomId || !checkIn || !checkOut) {
    message.textContent = "";
    submitButton.disabled = false;
    return;
  }
  if (checkIn < today || checkOut <= checkIn || checkOut < today) {
    updateStayConstraints();
    message.textContent = "Choose valid dates with at least one night.";
    message.classList.add("unavailable");
    submitButton.disabled = true;
    return;
  }

  message.textContent = "Checking availability...";
  submitButton.disabled = true;
  try {
    const query = new URLSearchParams({ roomId, checkIn, checkOut });
    const response = await fetch(`/api/room-availability?${query}`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Could not check room availability");
    }
    if (checkId !== availabilityRequestId) return;

    roomAvailabilityChecked = true;
    roomAvailabilityAvailable = result.available;
    if (!result.available) {
      message.textContent =
        "This room type is fully booked for those dates. Choose another room or dates.";
      message.classList.add("unavailable");
      submitButton.disabled = true;
      return;
    }

    message.textContent = `${result.availableRooms} ${
      result.availableRooms === 1 ? "room" : "rooms"
    } available for your selected dates.`;
    submitButton.disabled = false;
  } catch (error) {
    if (checkId !== availabilityRequestId) return;
    console.error("Error checking room availability:", error);
    message.textContent =
      "Availability could not be checked now. You can still send the request; availability will be checked again before it is accepted.";
    submitButton.disabled = false;
  }
}

async function submitBooking(bookingData) {
  const response = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookingData),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error(
        "Those dates are no longer available. Go back, choose different dates or a room type, and check availability again.",
      );
    }
    throw new Error(result.error || "Booking request failed");
  }
  return result;
}

function showBookingReview(type, booking) {
  const dialog = document.getElementById("booking-review-dialog");
  const title = document.getElementById("booking-review-title");
  const intro = document.getElementById("booking-review-intro");
  const details = document.getElementById("booking-review-details");
  const submit = document.getElementById("booking-review-submit");
  const isRoom = type === "room";
  const rows = isRoom
    ? [
        ["Room type", document.getElementById("room-type-select").selectedOptions[0]?.textContent || ""],
        ["Stay", `${formatBookingDate(booking.checkIn)} – ${formatBookingDate(booking.checkOut)}`],
        ["Guests", String(booking.pax)],
        ["Guest name", booking.guestName],
        ["Contact", booking.contact],
        ["Email", booking.guestEmail],
        ["Notes", booking.notes || "None"],
        ["Estimated total", document.getElementById("sum-total").textContent],
      ]
    : [
        ["Event", booking.eventType],
        ["Date", formatBookingDate(booking.eventDate)],
        ["Time", booking.timeBlock],
        ["Expected guests", String(booking.guestCount)],
        ["Guest name", booking.guestName],
        ["Contact", booking.contact],
        ["Email", booking.guestEmail],
        ["Notes", booking.notes || "None"],
      ];

  title.textContent = isRoom ? "Review your reservation request" : "Review your event inquiry";
  intro.textContent = isRoom
    ? "Check these stay details before sending your request."
    : "Check these event details before sending your inquiry.";
  details.replaceChildren();
  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  });
  submit.textContent = isRoom ? "Send reservation request" : "Send event inquiry";
  submit.disabled = false;
  setFormError("booking-review-error", "");
  dialog.showModal();
  document.getElementById("booking-review-back").focus();
  return new Promise((resolve) => {
    reviewResolver = resolve;
  });
}

async function handleRoomBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  updateStayConstraints();
  updateRoomGuestLimit();
  validateContactNumber(document.getElementById("room-contact"));
  const name = document.getElementById("room-name");
  name.setCustomValidity(name.value.trim() ? "" : "Enter your name.");
  setFormError("room-booking-error", "");
  if (!form.reportValidity()) return;

  if (!document.getElementById("room-type-select").value) {
    setFormError("room-booking-error", "Choose a room type.");
    return;
  }
  if (roomAvailabilityChecked && !roomAvailabilityAvailable) {
    setFormError(
      "room-booking-error",
      "The selected room type is unavailable for those dates. Change the dates or room type.",
    );
    return;
  }

  const booking = {
    type: "room",
    status: "Pending",
    guestName: name.value.trim(),
    guestEmail: document.getElementById("room-email").value.trim(),
    contact: normalizeContactNumber(
      document.getElementById("room-contact").value,
    ),
    roomTypeId: document.getElementById("room-type-select").value,
    checkIn: document.getElementById("room-checkin").value,
    checkOut: document.getElementById("room-checkout").value,
    pax: Number(document.getElementById("room-pax").value),
    notes: document.getElementById("room-notes").value.trim(),
  };

  if (!(await showBookingReview("room", booking))) return;
  await sendBookingRequest({
    form,
    buttonLabel: "Submit Reservation Request",
    errorId: "room-booking-error",
    booking,
    onSuccess(result) {
      form.classList.add("hidden");
      document.getElementById("room-success-msg").classList.remove("hidden");
      showRequestReference("room-success-msg", result);
    },
    onFailure: checkRoomAvailability,
  });
}

async function handleEventBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const date = document.getElementById("event-date");
  const name = document.getElementById("event-name");
  const contact = document.getElementById("event-contact");
  const guestCount = document.getElementById("event-pax");
  name.setCustomValidity(name.value.trim() ? "" : "Enter your name.");
  validateContactNumber(contact);
  guestCount.setCustomValidity(
    Number.isSafeInteger(Number(guestCount.value)) &&
      Number(guestCount.value) > 0 &&
      Number(guestCount.value) <= 2147483647
      ? ""
      : "Enter a whole number of at least one guest.",
  );
  validateOtherEventType();
  setFormError("event-booking-error", "");

  if (date.value && date.value < propertyToday()) {
    date.setCustomValidity("Event date must be today or a future date.");
  } else {
    date.setCustomValidity("");
  }
  if (!form.reportValidity()) return;

  const selectedEventType = document.getElementById("event-type").value;
  const otherType = document.getElementById("event-type-other").value.trim();
  const booking = {
    type: "event",
    status: "Pending",
    guestName: name.value.trim(),
    guestEmail: document.getElementById("event-email").value.trim(),
    contact: normalizeContactNumber(contact.value),
    eventType:
      selectedEventType === "Other" ? `Other: ${otherType}` : selectedEventType,
    eventDate: date.value,
    guestCount: Number(guestCount.value),
    timeBlock: document.getElementById("event-time").value,
    notes: document.getElementById("event-notes").value.trim(),
  };

  if (!(await showBookingReview("event", booking))) return;
  await sendBookingRequest({
    form,
    buttonLabel: "Inquire Now",
    errorId: "event-booking-error",
    booking,
    onSuccess(result) {
      form.classList.add("hidden");
      document.getElementById("event-success-msg").classList.remove("hidden");
      showRequestReference("event-success-msg", result);
    },
  });
}

function showRequestReference(elementId, result) {
  const message = document.querySelector(`#${elementId} p`);
  if (!message) return;
  const defaultMessage = message.dataset.defaultMessage || message.textContent.trim();
  message.textContent = result.id
    ? `${defaultMessage} Your request reference is #${result.id}.`
    : defaultMessage;
}

async function sendBookingRequest({
  form,
  buttonLabel,
  errorId,
  booking,
  onSuccess,
  onFailure,
}) {
  const button = form.querySelector('button[type="submit"]');
  const controls = Array.from(form.elements, (control) => ({
    control,
    wasDisabled: control.disabled,
  }));
  controls.forEach(({ control }) => {
    control.disabled = true;
  });
  button.textContent = "Sending request...";
  setFormError(errorId, "");
  try {
    const result = await submitBooking(booking);
    onSuccess(result);
  } catch (error) {
    console.error("Error submitting booking request:", error);
    setFormError(errorId, error.message);
    form.querySelector(":invalid")?.focus();
    onFailure?.();
  } finally {
    button.textContent = buttonLabel;
    button.disabled = form.id === "room-booking-form" &&
      roomAvailabilityChecked &&
      !roomAvailabilityAvailable;
    controls.forEach(({ control, wasDisabled }) => {
      if (control !== button) control.disabled = wasDisabled;
    });
  }
}

function resetRoomForm() {
  const form = document.getElementById("room-booking-form");
  form.reset();
  form.classList.remove("hidden");
  document.getElementById("room-success-msg").classList.add("hidden");
  showRequestReference("room-success-msg", {});
  setFormError("room-booking-error", "");
  document.getElementById("room-contact").setCustomValidity("");
  document.getElementById("room-name").setCustomValidity("");
  updateStayConstraints();
  updateRoomGuestLimit();
  if (typeof calculateOrderSummary === "function") calculateOrderSummary();
  checkRoomAvailability();
}

function resetEventForm() {
  const form = document.getElementById("event-booking-form");
  form.reset();
  form.classList.remove("hidden");
  document.getElementById("event-success-msg").classList.add("hidden");
  showRequestReference("event-success-msg", {});
  setFormError("event-booking-error", "");
  document.getElementById("event-contact").setCustomValidity("");
  document.getElementById("event-name").setCustomValidity("");
  document.getElementById("event-date").setCustomValidity("");
  document.getElementById("event-pax").setCustomValidity("");
  updateOtherEventType();
}
