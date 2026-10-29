// Modal form handling

let availabilityRequestId = 0;

document.addEventListener("DOMContentLoaded", () => {
  const roomForm = document.getElementById("room-booking-form");
  const eventForm = document.getElementById("event-booking-form");
  const checkIn = document.getElementById("room-checkin");
  const checkOut = document.getElementById("room-checkout");
  const roomSelect = document.getElementById("room-type-select");

  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const todayValues = Object.fromEntries(
    todayParts.map((part) => [part.type, part.value]),
  );
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
  if (checkIn) checkIn.min = today;
  if (checkOut) checkOut.min = today;

  if (roomForm) {
    roomForm.addEventListener("submit", handleRoomBooking);
  }
  if (eventForm) {
    eventForm.addEventListener("submit", handleEventBooking);
  }
  [checkIn, checkOut, roomSelect].forEach((input) => {
    input?.addEventListener("change", checkRoomAvailability);
  });
});

async function checkRoomAvailability() {
  const checkId = ++availabilityRequestId;
  const roomId = document.getElementById("room-type-select").value;
  const checkIn = document.getElementById("room-checkin").value;
  const checkOut = document.getElementById("room-checkout").value;
  const message = document.getElementById("room-availability-message");
  const submitButton = document.querySelector(
    '#room-booking-form button[type="submit"]',
  );

  message.classList.remove("unavailable");
  if (!roomId || !checkIn || !checkOut || checkOut <= checkIn) {
    message.textContent = "";
    submitButton.disabled = false;
    return;
  }
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const todayValues = Object.fromEntries(
    todayParts.map((part) => [part.type, part.value]),
  );
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
  if (checkIn < today) {
    message.textContent = "Check-in must be today or a future date.";
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
      "Availability could not be checked. It will be verified when you submit.";
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
  if (!response.ok) throw new Error(result.error || "Booking request failed");
  return result;
}

async function handleRoomBooking(e) {
  e.preventDefault();

  const checkIn = document.getElementById("room-checkin").value;
  const checkOut = document.getElementById("room-checkout").value;
  const errorMsg = document.getElementById("room-date-error");

  if (new Date(checkOut) <= new Date(checkIn)) {
    errorMsg.style.display = "block";
    return;
  }
  errorMsg.style.display = "none";

  const bookingData = {
    type: "room",
    status: "Pending",
    guestName: document.getElementById("room-name").value,
    guestEmail: document.getElementById("room-email").value,
    contact: document.getElementById("room-contact").value,
    roomTypeId: document.getElementById("room-type-select").value,
    checkIn: checkIn,
    checkOut: checkOut,
    pax: parseInt(document.getElementById("room-pax").value, 10),
    notes: document.getElementById("room-notes").value || "",
  };

  try {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Submitting...";

    await submitBooking(bookingData);

    // Inject success state inside modal split view
    document.getElementById("room-booking-form").classList.add("hidden");
    document.getElementById("room-success-msg").classList.remove("hidden");
  } catch (err) {
    console.error("Error submitting booking: ", err);
    alert(
      err.message ||
        "There was an error submitting your request. Please try calling us instead.",
    );
  } finally {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = "Submit Reservation Request";
    await checkRoomAvailability();
  }
}

async function handleEventBooking(e) {
  e.preventDefault();

  const bookingData = {
    type: "event",
    status: "Pending",
    guestName: document.getElementById("event-name").value,
    guestEmail: document.getElementById("event-email").value,
    contact: document.getElementById("event-contact").value,
    eventType: document.getElementById("event-type").value,
    eventDate: document.getElementById("event-date").value,
    guestCount: parseInt(document.getElementById("event-pax").value, 10),
    timeBlock: document.getElementById("event-time").value,
    notes: document.getElementById("event-notes").value || "",
  };

  try {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Submitting...";

    await submitBooking(bookingData);

    document.getElementById("event-booking-form").classList.add("hidden");
    document.getElementById("event-success-msg").classList.remove("hidden");
  } catch (err) {
    console.error("Error submitting booking: ", err);
    alert(
      err.message ||
        "There was an error submitting your request. Please try calling us instead.",
    );
  } finally {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = false;
    btn.textContent = "Inquire Now";
  }
}

function resetRoomForm() {
  const form = document.getElementById("room-booking-form");
  form.reset();
  form.classList.remove("hidden");
  document.getElementById("room-success-msg").classList.add("hidden");
  // Reset sticky summary
  if (typeof calculateOrderSummary === "function") calculateOrderSummary();
  checkRoomAvailability();
}

function resetEventForm() {
  const form = document.getElementById("event-booking-form");
  form.reset();
  form.classList.remove("hidden");
  document.getElementById("event-success-msg").classList.add("hidden");
}
