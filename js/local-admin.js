document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  if (path.endsWith("dashboard.html")) loadDashboard();
  if (path.endsWith("booking-detail.html")) initializeBookingDetail();
  if (path.endsWith("room-status.html")) loadRoomStatus();
  if (path.endsWith("room-bookings.html")) loadRoomBookings();
  if (path.endsWith("reports.html")) initializeReports();
});

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401) {
    window.location.replace("login.html");
    throw new Error("Your admin session has ended");
  }
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Request failed");
    error.details = result;
    throw error;
  }
  return result;
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return date.toLocaleDateString();
}

function getBadgeClass(status) {
  return (
    {
      Pending: "badge-pending",
      Confirmed: "badge-confirmed",
      Cancelled: "badge-cancelled",
      Rejected: "badge-rejected",
      NoShow: "badge-cancelled",
      CheckedOut: "badge-completed",
      CheckedIn: "badge-checkedin",
    }[status] || "badge-completed"
  );
}

async function loadDashboard() {
  try {
    const stats = await apiRequest("/api/admin/dashboard");
    document.getElementById("dash-pending").textContent = stats.pending;
    document.getElementById("dash-checkins").textContent = stats.checkins;
    document.getElementById("dash-checkouts").textContent = stats.checkouts;
    document.getElementById("dash-rooms-ready").textContent =
      stats.roomStatus.ready;
    document.getElementById("dash-rooms-occupied").textContent =
      stats.roomStatus.occupied;
    document.getElementById("dash-rooms-cleaning").textContent =
      stats.roomStatus.needs_cleaning;
    renderTodayBookings(
      "dash-arrivals",
      stats.arrivals,
      "No arrivals scheduled today.",
    );
    renderTodayBookings(
      "dash-departures",
      stats.departures,
      "No departures scheduled today.",
    );
  } catch (error) {
    console.error("Could not load dashboard:", error);
  }
}

function renderTodayBookings(containerId, bookings, emptyMessage) {
  const container = document.getElementById(containerId);
  container.replaceChildren();
  if (!bookings.length) {
    container.textContent = emptyMessage;
    return;
  }

  const list = document.createElement("ul");
  bookings.forEach((booking) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `booking-detail.html?id=${encodeURIComponent(booking.id)}`;
    link.textContent = `${booking.guestName} · ${booking.roomName}`;
    item.appendChild(link);
    list.appendChild(item);
  });
  container.appendChild(list);
}

function initializeBookings() {
  const statusFilter = document.getElementById("filter-status");
  const typeFilter = document.getElementById("filter-type");
  const params = new URLSearchParams(window.location.search);
  if (params.has("filter")) statusFilter.value = params.get("filter");

  async function loadBookings() {
    const query = new URLSearchParams({
      status: statusFilter.value,
      type: typeFilter.value,
    });
    try {
      const bookings = await apiRequest(`/api/admin/bookings?${query}`);
      renderBookings(bookings);
    } catch (error) {
      document.getElementById("bookings-tbody").innerHTML =
        `<tr><td colspan="6" class="text-center">${escapeHTML(error.message)}</td></tr>`;
    }
  }

  statusFilter.addEventListener("change", loadBookings);
  typeFilter.addEventListener("change", loadBookings);
  loadBookings();

  const walkinForm = document.getElementById("add-walkin-form");
  walkinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const type = document.getElementById("walkin-type").value;
    const booking = {
      type,
      guestName: document.getElementById("walkin-name").value,
      guestEmail: document.getElementById("walkin-email").value,
      contact: "Walk-in/Phone",
    };
    if (type === "room") {
      booking.roomTypeId = document.getElementById("walkin-room-type").value;
      booking.checkIn = document.getElementById("walkin-checkin").value;
      booking.checkOut = document.getElementById("walkin-checkout").value;
      booking.pax = 1;
    } else {
      booking.eventType = document.getElementById("walkin-event-type").value;
      booking.eventDate = document.getElementById("walkin-event-date").value;
      booking.guestCount = 1;
    }

    try {
      const created = await apiRequest("/api/admin/bookings", {
        method: "POST",
        body: JSON.stringify(booking),
      });
      if (created.emailDelivery) {
        alert(
          created.emailDelivery.sent
            ? "Booking saved and confirmation email sent."
            : `Booking saved, but confirmation email was not sent: ${created.emailDelivery.message}`,
        );
      }
      walkinForm.reset();
      toggleAddWalkin();
      await loadBookings();
    } catch (error) {
      alert(error.message);
    }
  });
}

function renderBookings(bookings) {
  const tbody = document.getElementById("bookings-tbody");
  if (!bookings.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center">No bookings found.</td></tr>';
    return;
  }
  tbody.innerHTML = bookings
    .map((booking) => {
      const type =
        booking.type === "room"
          ? `Room: ${booking.roomType}`
          : `Event: ${booking.eventType}`;
      const dates =
        booking.type === "room"
          ? `${booking.checkIn} to ${booking.checkOut}`
          : booking.eventDate;
      return `<tr>
      <td>${escapeHTML(formatDate(booking.createdAt))}</td>
      <td><strong>${escapeHTML(booking.guestName)}</strong><br><small>${escapeHTML(booking.guestEmail || booking.contact)}</small></td>
      <td>${escapeHTML(type)}</td>
      <td>${escapeHTML(dates)}</td>
      <td><span class="badge ${getBadgeClass(booking.status)}">${escapeHTML(booking.status)}</span></td>
      <td><a href="booking-detail.html?id=${encodeURIComponent(booking.id)}" class="btn btn-outline" style="padding:4px 8px; font-size:0.85rem;">View</a></td>
    </tr>`;
    })
    .join("");
}

function toggleAddWalkin() {
  const container = document.getElementById("add-walkin-container");
  const isOpening = container.style.display === "none";
  container.style.display = isOpening ? "block" : "none";
  if (isOpening) window.bookingsApp?.loadRoomTypes?.();
}

function toggleWalkinFields() {
  const type = document.getElementById("walkin-type").value;
  document.getElementById("walkin-room-fields").style.display =
    type === "room" ? "grid" : "none";
  document.getElementById("walkin-event-fields").style.display =
    type === "event" ? "grid" : "none";
}

let currentBookingId = null;
let currentBookingData = null;

async function initializeBookingDetail() {
  currentBookingId = new URLSearchParams(window.location.search).get("id");
  if (!currentBookingId) {
    document.querySelector(".admin-content").innerHTML =
      "<h2>Booking ID not found</h2>";
    return;
  }
  try {
    currentBookingData = await apiRequest(
      `/api/admin/bookings/${encodeURIComponent(currentBookingId)}`,
    );
    renderBookingDetail(currentBookingData);
  } catch (error) {
    document.getElementById("detail-info").textContent = error.message;
  }
}

function renderBookingDetail(data) {
  document.getElementById("detail-guest").innerHTML = `
    <p><strong>Name:</strong> ${escapeHTML(data.guestName)}</p>
    <p><strong>Email:</strong> ${escapeHTML(data.guestEmail || "Not provided")}</p>
    <p><strong>Contact:</strong> ${escapeHTML(data.contact)}</p>
    <p><strong>Notes:</strong> ${escapeHTML(data.notes || "None")}</p>
    <p><strong>Created:</strong> ${escapeHTML(formatDate(data.createdAt))}</p>`;
  document.getElementById("booking-email-input").value = data.guestEmail || "";

  const details =
    data.type === "room"
    ? `<p><strong>Type:</strong> Room Booking</p><p><strong>Room:</strong> ${escapeHTML(data.roomType)}</p><p><strong>Assigned unit:</strong> ${escapeHTML(data.physicalRoomId || "Assigned when confirmed")}</p><p><strong>Check-in:</strong> ${escapeHTML(data.checkIn)}</p><p><strong>Check-out:</strong> ${escapeHTML(data.checkOut)}</p><p><strong>Source:</strong> ${escapeHTML(data.source)}</p><p><strong>Pax:</strong> ${escapeHTML(data.pax || "N/A")}</p>`
      : `<p><strong>Type:</strong> Event Booking</p><p><strong>Event:</strong> ${escapeHTML(data.eventType)}</p><p><strong>Date:</strong> ${escapeHTML(data.eventDate)}</p><p><strong>Time:</strong> ${escapeHTML(data.timeBlock || "N/A")}</p><p><strong>Pax:</strong> ${escapeHTML(data.guestCount || "N/A")}</p>`;
  document.getElementById("detail-info").innerHTML =
    `${details}<p><strong>Status:</strong> <span class="badge ${getBadgeClass(data.status)}">${escapeHTML(data.status)}</span></p>`;

  const actions = document.getElementById("action-buttons");
  actions.replaceChildren();
  if (data.status === "Pending") {
    addActionButton(
      actions,
      "Confirm Booking",
      "btn btn-success",
      showConfirmPanel,
    );
    addActionButton(actions, "Reject", "btn btn-danger", () =>
      updateStatus("Rejected"),
    );
    addActionButton(actions, "Cancel", "btn btn-outline", () =>
      updateStatus("Cancelled"),
    );
  } else if (data.status === "Confirmed") {
    addActionButton(
      actions,
      "Resend Confirmation Email",
      "btn btn-outline",
      resendConfirmationEmail,
    );
    addActionButton(actions, "Mark Checked-In", "btn btn-primary", () =>
      updateStatus("CheckedIn"),
    );
    addActionButton(actions, "Cancel Booking", "btn btn-danger", () =>
      updateStatus("Cancelled"),
    );
    addActionButton(actions, "Mark No-show", "btn btn-outline", () =>
      updateStatus("NoShow"),
    );
  } else if (data.status === "CheckedIn") {
    addActionButton(actions, "Check out", "btn btn-primary", () =>
      updateStatus("CheckedOut"),
    );
  }
}

function addActionButton(parent, text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  parent.appendChild(button);
}

function showConfirmPanel() {
  document.getElementById("confirm-panel").style.display = "block";
}

async function executeConfirm() {
  try {
    await updateBooking({ status: "Confirmed" });
    document.getElementById("confirm-panel").style.display = "none";
  } catch (error) {
    alert(error.message);
  }
}

async function resendConfirmationEmail() {
  try {
    const result = await apiRequest(
      `/api/admin/bookings/${encodeURIComponent(currentBookingId)}/resend-confirmation`,
      { method: "POST" },
    );
    showConfirmationEmailResult(result.emailDelivery);
  } catch (error) {
    alert(error.message);
  }
}

function showConfirmationEmailResult(result) {
  if (!result) return;
  const notice = document.getElementById("confirmation-email-feedback");
  notice.hidden = false;
  notice.className = result.sent
    ? "confirmation-email-feedback success"
    : "confirmation-email-feedback error";
  notice.textContent = result.sent
    ? "Booking confirmation email sent."
    : `Booking is confirmed, but its email was not sent: ${result.message}`;
}

async function saveBookingEmail() {
  const input = document.getElementById("booking-email-input");
  const status = document.getElementById("booking-email-save-status");
  if (!input.reportValidity()) return;
  try {
    const result = await apiRequest(
      `/api/admin/bookings/${encodeURIComponent(currentBookingId)}/email`,
      {
        method: "PATCH",
        body: JSON.stringify({ guestEmail: input.value }),
      },
    );
    currentBookingData.guestEmail = result.guestEmail;
    renderBookingDetail(currentBookingData);
    status.textContent = "Email saved.";
    status.className = "confirmation-email-feedback success";
  } catch (error) {
    status.textContent = error.message;
    status.className = "confirmation-email-feedback error";
  }
}

async function updateStatus(status) {
  if (
    status === "Cancelled" &&
    !confirm("Are you sure you want to cancel this booking?")
  )
    return;
  try {
    await updateBooking({ status });
  } catch (error) {
    alert(error.message);
  }
}

async function updateBooking(changes) {
  currentBookingData = await apiRequest(
    `/api/admin/bookings/${encodeURIComponent(currentBookingId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(changes),
    },
  );
  renderBookingDetail(currentBookingData);
  showConfirmationEmailResult(currentBookingData.emailDelivery);
  return currentBookingData;
}

async function loadRoomStatus() {
  if (!window.roomStatusApp) {
    throw new Error("The room status chart did not load.");
  }
  await window.roomStatusApp.load();
}

async function loadRoomBookings() {
  const roomId = new URLSearchParams(window.location.search).get("roomId");
  const title = document.getElementById("room-bookings-title");
  const content = document.getElementById("room-bookings-content");
  if (!roomId) {
    content.textContent = "Choose a room from the Room Status Board.";
    return;
  }

  let timeoutId = null;
  try {
    const controller = new AbortController();
    timeoutId = window.setTimeout(() => controller.abort(), 15000);
    const room = await apiRequest(
      `/api/admin/room-status/${encodeURIComponent(roomId)}/bookings`,
      { signal: controller.signal },
    );

    title.textContent = `${room.roomLabel} - Booking History`;
    content.replaceChildren();
    if (!room.reservations.length) {
      content.textContent = "No bookings have been recorded for this unit.";
      return;
    }

    const table = document.createElement("table");
    table.className = "room-booking-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Guest", "Check-in", "Check-out", "Status", "Booking created"].forEach(
      (label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      },
    );
    thead.appendChild(headerRow);
    const tbody = document.createElement("tbody");
    room.reservations.forEach((reservation) => {
      const row = document.createElement("tr");
      const guest = document.createElement("td");
      guest.textContent = reservation.guestName;
      const checkIn = document.createElement("td");
      checkIn.textContent = formatDate(reservation.checkIn);
      const checkOut = document.createElement("td");
      checkOut.textContent = formatDate(reservation.checkOut);
      const status = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge ${getBadgeClass(reservation.status)}`;
      badge.textContent = reservation.status;
      status.appendChild(badge);
      const created = document.createElement("td");
      created.textContent = formatDate(reservation.createdAt);
      row.append(guest, checkIn, checkOut, status, created);
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    content.appendChild(table);
  } catch (error) {
    content.textContent =
      error.name === "AbortError"
        ? "Loading timed out while contacting the server. Confirm the server is running, then refresh this page."
        : error.message || "Could not load room bookings.";
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

async function initRoomStatusDocs() {
  await loadRoomStatus();
}

function initializeReports() {
  const startInput = document.getElementById("report-start");
  const endInput = document.getElementById("report-end");
  const today = new Date();
  const first = new Date(today);
  first.setDate(today.getDate() - today.getDay());
  const last = new Date(first);
  last.setDate(first.getDate() + 6);
  startInput.value = first.toISOString().split("T")[0];
  endInput.value = last.toISOString().split("T")[0];

  [startInput, endInput].forEach((input) => {
    input.addEventListener("change", () => {
      document.getElementById("report-export").hidden = true;
      document.getElementById("report-results").style.display = "none";
    });
  });

  document
    .getElementById("report-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = new URLSearchParams({
        start: startInput.value,
        end: endInput.value,
      });
      try {
        if (startInput.value > endInput.value) {
          throw new Error("Start date must be on or before end date.");
        }
        const report = await apiRequest(`/api/admin/reports?${query}`);
        document.getElementById("report-period").textContent =
          `${startInput.value} through ${endInput.value}`;
        document.getElementById("report-export").hidden = false;
        document.getElementById("report-results").style.display = "grid";
        document.getElementById("report-total-bookings").textContent =
          report.total_bookings;
        document.getElementById("report-room-bookings").textContent =
          report.room_bookings;
        document.getElementById("report-event-bookings").textContent =
          report.event_bookings;
        document.getElementById("report-pending-bookings").textContent =
          report.pending_bookings;
        document.getElementById("report-confirmed-bookings").textContent =
          report.confirmed_bookings;
        document.getElementById("report-checked-in-bookings").textContent =
          report.checked_in_bookings;
        document.getElementById("report-completed-bookings").textContent =
          report.completed_bookings;
        document.getElementById("report-cancelled-bookings").textContent =
          report.cancelled_bookings;
        renderReportBookings(report.bookings);
      } catch (error) {
        alert(error.message);
      }
    });

  document.getElementById("report-export").addEventListener("click", () => {
    window.print();
  });
}

function renderReportBookings(bookings) {
  const tbody = document.getElementById("report-bookings-tbody");
  if (!bookings.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center">No bookings found for this date range.</td></tr>';
    return;
  }

  tbody.innerHTML = bookings
    .map((booking) => {
      const details =
        booking.type === "room"
          ? `Room: ${booking.roomType}`
          : `Event: ${booking.eventType}`;
      const dates =
        booking.type === "room"
          ? `${booking.checkIn} to ${booking.checkOut}`
          : booking.eventDate;
      const guestCount =
        booking.type === "room" ? booking.pax : booking.guestCount;

      return `<tr>
        <td>${escapeHTML(formatDate(booking.createdAt))}</td>
        <td><strong>${escapeHTML(booking.guestName)}</strong><br><small>${escapeHTML(booking.guestEmail || booking.contact)}</small></td>
        <td>${escapeHTML(details)}</td>
        <td>${escapeHTML(dates)}</td>
        <td>${escapeHTML(guestCount ?? "N/A")}</td>
        <td><span class="badge ${getBadgeClass(booking.status)}">${escapeHTML(booking.status)}</span></td>
        <td>${escapeHTML(booking.notes || "—")}</td>
      </tr>`;
    })
    .join("");
}
