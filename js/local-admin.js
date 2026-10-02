document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  if (path.endsWith("dashboard.html")) loadDashboard();
  if (path.endsWith("bookings.html")) initializeBookings();
  if (path.endsWith("booking-detail.html")) initializeBookingDetail();
  if (path.endsWith("room-status.html")) loadRoomStatus();
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
  if (!response.ok) throw new Error(result.error || "Request failed");
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
  return new Date(value).toLocaleDateString();
}

function getBadgeClass(status) {
  return (
    {
      Pending: "badge-pending",
      Confirmed: "badge-confirmed",
      Cancelled: "badge-cancelled",
      Completed: "badge-completed",
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
      contact: "Walk-in/Phone",
    };
    if (type === "room") {
      booking.roomType = document.getElementById("walkin-room-type").value;
      booking.checkIn = document.getElementById("walkin-checkin").value;
      booking.checkOut = document.getElementById("walkin-checkout").value;
      booking.pax = 1;
    } else {
      booking.eventType = document.getElementById("walkin-event-type").value;
      booking.eventDate = document.getElementById("walkin-event-date").value;
      booking.guestCount = 1;
    }

    try {
      await apiRequest("/api/admin/bookings", {
        method: "POST",
        body: JSON.stringify(booking),
      });
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
      <td><strong>${escapeHTML(booking.guestName)}</strong><br><small>${escapeHTML(booking.contact)}</small></td>
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
  container.style.display =
    container.style.display === "none" ? "block" : "none";
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
    <p><strong>Contact:</strong> ${escapeHTML(data.contact)}</p>
    <p><strong>Notes:</strong> ${escapeHTML(data.notes || "None")}</p>
    <p><strong>Created:</strong> ${escapeHTML(formatDate(data.createdAt))}</p>`;

  const details =
    data.type === "room"
      ? `<p><strong>Type:</strong> Room Booking</p><p><strong>Room:</strong> ${escapeHTML(data.roomType)}</p><p><strong>Check-in:</strong> ${escapeHTML(data.checkIn)}</p><p><strong>Check-out:</strong> ${escapeHTML(data.checkOut)}</p><p><strong>Pax:</strong> ${escapeHTML(data.pax || "N/A")}</p>`
      : `<p><strong>Type:</strong> Event Booking</p><p><strong>Event:</strong> ${escapeHTML(data.eventType)}</p><p><strong>Date:</strong> ${escapeHTML(data.eventDate)}</p><p><strong>Time:</strong> ${escapeHTML(data.timeBlock || "N/A")}</p><p><strong>Pax:</strong> ${escapeHTML(data.guestCount || "N/A")}</p>`;
  const downpayment = data.downpaymentAmount
    ? `<p><strong>Downpayment:</strong> ₱${escapeHTML(data.downpaymentAmount)} via ${escapeHTML(data.downpaymentMethod)}</p>`
    : "";
  document.getElementById("detail-info").innerHTML =
    `${details}<p><strong>Status:</strong> <span class="badge ${getBadgeClass(data.status)}">${escapeHTML(data.status)}</span></p>${downpayment}`;

  const actions = document.getElementById("action-buttons");
  actions.replaceChildren();
  if (data.status === "Pending") {
    addActionButton(
      actions,
      "Confirm (Log DP)",
      "btn btn-success",
      showConfirmPanel,
    );
    addActionButton(actions, "Decline", "btn btn-danger", () =>
      updateStatus("Cancelled"),
    );
  } else if (data.status === "Confirmed") {
    addActionButton(actions, "Mark Checked-In", "btn btn-primary", () =>
      updateStatus("CheckedIn"),
    );
    addActionButton(actions, "Cancel Booking", "btn btn-danger", () =>
      updateStatus("Cancelled"),
    );
  } else if (data.status === "CheckedIn") {
    addActionButton(actions, "Mark Completed", "btn btn-primary", () =>
      updateStatus("Completed"),
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
  const amountValue = document.getElementById("dp-amount").value;
  try {
    await updateBooking({
      status: "Confirmed",
      downpaymentAmount: amountValue === "" ? null : Number(amountValue),
      downpaymentMethod: document.getElementById("dp-method").value,
    });
    document.getElementById("confirm-panel").style.display = "none";
  } catch (error) {
    alert(error.message);
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
}

async function loadRoomStatus() {
  const grid = document.getElementById("status-grid");
  try {
    const rooms = await apiRequest("/api/admin/room-status");
    if (!rooms.length) {
      grid.textContent = "No physical rooms are configured.";
      return;
    }
    grid.replaceChildren();
    rooms.forEach((room) => {
      const card = document.createElement("div");
      card.className = `status-card status-${room.status.replaceAll(" ", "")}`;
      const heading = document.createElement("h3");
      heading.textContent = room.roomLabel;
      const select = document.createElement("select");
      select.style.width = "100%";
      select.style.padding = "8px";
      ["Ready", "Occupied", "Needs Cleaning"].forEach((status) => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        option.selected = room.status === status;
        select.appendChild(option);
      });
      select.addEventListener("change", async () => {
        try {
          await apiRequest(
            `/api/admin/room-status/${encodeURIComponent(room.id)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: select.value }),
            },
          );
          await loadRoomStatus();
        } catch (error) {
          alert(error.message);
        }
      });
      const updated = document.createElement("div");
      updated.style.cssText = "font-size:0.8rem; margin-top:10px; color:#666;";
      updated.textContent = `Updated: ${formatDate(room.lastUpdated)}`;
      card.append(heading, select, updated);
      grid.appendChild(card);
    });
  } catch (error) {
    grid.textContent = error.message;
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

  document
    .getElementById("report-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = new URLSearchParams({
        start: startInput.value,
        end: endInput.value,
      });
      try {
        const report = await apiRequest(`/api/admin/reports?${query}`);
        document.getElementById("report-results").style.display = "grid";
        document.getElementById("report-total-bookings").textContent =
          report.total_bookings;
        document.getElementById("report-total-dp").textContent = Number(
          report.total_downpayments,
        ).toLocaleString();
      } catch (error) {
        alert(error.message);
      }
    });
}
