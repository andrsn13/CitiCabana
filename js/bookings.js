(() => {
  const body = document.getElementById("bookings-tbody");
  if (!body) return;

  const pageSize = 25;
  const state = {
    bookings: [],
    tab: "needs-action",
    page: 1,
    search: "",
    type: "all",
    status: "All",
    start: "",
    end: "",
    loading: false,
  };
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

  function parseDate(value) {
    return new Date(`${value}T00:00:00Z`);
  }

  function dateLabel(value, includeYear = false) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      ...(includeYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(parseDate(value));
  }

  function placedDate(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      timeZone: "Asia/Manila",
    }).format(new Date(value));
  }

  function dayDifference(first, second) {
    return Math.round((parseDate(second) - parseDate(first)) / 86400000);
  }

  function escape(value) {
    return escapeHTML(value ?? "");
  }

  function matchesFilters(booking, applyStatusFilter = false) {
    const query = state.search.trim().toLocaleLowerCase();
    if (
      query &&
      ![
        booking.guestName,
        booking.guestEmail,
        booking.contact,
        String(booking.id),
      ].some((value) => String(value || "").toLocaleLowerCase().includes(query))
    ) {
      return false;
    }

    if (state.type !== "all") {
      const bookingType =
        booking.type === "event"
          ? "event"
          : /villa/i.test(booking.roomType || "")
            ? "villa"
            : "room";
      if (bookingType !== state.type) return false;
    }

    if (state.start || state.end) {
      const start = state.start || state.end;
      const end = state.end || state.start;
      const overlaps =
        booking.type === "event"
          ? booking.eventDate >= start && booking.eventDate <= end
          : booking.checkIn <= end && booking.checkOut > start;
      if (!overlaps) return false;
    }

    if (applyStatusFilter && state.status !== "All" && booking.status !== state.status) {
      return false;
    }
    return true;
  }

  function getFilteredBookings(tab = state.tab) {
    const today = propertyToday();
    const applyStatusFilter = tab === "all";
    return state.bookings.filter(
      (booking) =>
        window.bookingViewRules.belongsToTab(booking, tab, today) &&
        matchesFilters(booking, applyStatusFilter),
    );
  }

  function problemDate(booking) {
    if (booking.status === "Pending") {
      return booking.type === "room" && booking.checkOut < propertyToday()
        ? booking.checkOut
        : booking.createdAt || booking.eventDate || booking.checkIn;
    }
    return booking.status === "CheckedIn"
      ? booking.checkOut || booking.eventDate
      : booking.checkIn || booking.eventDate;
  }

  function compareBookings(first, second) {
    const today = propertyToday();
    switch (state.tab) {
      case "needs-action":
        return (
          problemDate(first).localeCompare(problemDate(second)) ||
          Number(first.id) - Number(second.id)
        );
      case "today": {
        const section = (booking) =>
          booking.status === "CheckedIn" && booking.checkOut === today ? 1 : 0;
        return (
          section(first) - section(second) ||
          (first.timeBlock || "").localeCompare(second.timeBlock || "") ||
          String(first.guestName).localeCompare(String(second.guestName))
        );
      }
      case "in-house":
        return (first.checkOut || first.eventDate).localeCompare(
          second.checkOut || second.eventDate,
        );
      case "upcoming":
        return (first.checkIn || first.eventDate).localeCompare(
          second.checkIn || second.eventDate,
        );
      case "past":
        return (second.checkOut || second.eventDate).localeCompare(
          first.checkOut || first.eventDate,
        );
      case "cancelled":
        return (
          String(second.updatedAt || second.createdAt).localeCompare(
            String(first.updatedAt || first.createdAt),
          ) || Number(second.id) - Number(first.id)
        );
      case "all":
        {
          const firstDate =
            first.type === "event" ? first.eventDate : first.checkIn;
          const secondDate =
            second.type === "event" ? second.eventDate : second.checkIn;
        return (
          secondDate.localeCompare(firstDate) ||
          Number(second.id) - Number(first.id)
        );
        }
      default:
        return 0;
    }
  }

  function reasonFor(booking) {
    const today = propertyToday();
    if (booking.status === "CheckedIn" && booking.checkOut < today) {
      const days = dayDifference(booking.checkOut, today);
      return `${days} ${days === 1 ? "day" : "days"} past check-out`;
    }
    if (booking.status === "Pending" && booking.checkOut < today) {
      return "Dates have passed";
    }
    if (booking.status === "Confirmed" && !booking.roomId) {
      return "Confirmed booking has no unit assigned";
    }
    return "";
  }

  function stayMarkup(booking) {
    if (booking.type === "event") {
      return `${dateLabel(booking.eventDate)} · Event`;
    }
    return `${dateLabel(booking.checkIn)} → ${dateLabel(booking.checkOut)} · ${dayDifference(booking.checkIn, booking.checkOut)} nights`;
  }

  function unitMarkup(booking) {
    if (booking.type === "event") {
      return `<span class="booking-event-type">Type: Event</span><br>${escape(booking.eventType)}`;
    }
    return `${escape(booking.roomType || "Room")} · ${
      booking.roomId
        ? escape(booking.unitLabel || booking.roomId)
        : '<span class="booking-unassigned">Unassigned</span>'
    }`;
  }

  function statusLabel(status) {
    return (
      {
        CheckedIn: "Checked in",
        CheckedOut: "Checked out",
        NoShow: "No-show",
      }[status] || status
    );
  }

  function primaryAction(booking) {
    if (booking.status === "Pending") {
      if (booking.type === "room" && booking.checkOut < propertyToday()) {
        return '<button type="button" class="btn btn-danger booking-row-action" data-action="Rejected">Reject</button>';
      }
      return '<button type="button" class="btn btn-primary booking-row-action" data-action="Confirmed">Confirm</button>';
    }
    if (
      booking.status === "Confirmed" &&
      booking.checkIn <= propertyToday()
    ) {
      return '<button type="button" class="btn btn-primary booking-row-action" data-action="CheckedIn">Check in</button>';
    }
    if (booking.status === "CheckedIn") {
      return '<button type="button" class="btn btn-primary booking-row-action" data-action="CheckedOut">Check out</button>';
    }
    return '<button type="button" class="btn btn-outline booking-row-action" data-action="View">View</button>';
  }

  function menuActions(booking) {
    const actions = ["View"];
    if (["Confirmed", "CheckedIn"].includes(booking.status) && booking.type === "room") {
      actions.push("Edit");
    }
    if (booking.status === "Pending") {
      actions.push("Reject", "Cancel");
    } else if (booking.status === "Confirmed") {
      actions.push("Cancel", "Mark no-show");
    }
    return `<details class="booking-menu">
      <summary aria-label="More booking actions">⋯</summary>
      <div class="booking-menu-items">${actions
        .map(
          (action) =>
            `<button type="button" data-menu-action="${escape(action)}">${escape(action)}</button>`,
        )
        .join("")}</div>
    </details>`;
  }

  function rowMarkup(booking) {
    const reason = reasonFor(booking);
    const primary = primaryAction(booking);
    const actions =
      booking.status === "Pending" &&
      state.tab === "needs-action" &&
      !(booking.type === "room" && booking.checkOut < propertyToday())
        ? `${primary}<button type="button" class="btn btn-danger booking-row-action" data-action="Rejected">Reject</button>`
        : primary;
    return `<tr class="booking-row${reason ? " booking-row-flagged" : ""}" data-booking-id="${escape(booking.id)}" tabindex="0">
      <td><strong>${escape(booking.guestName)}</strong><br><small>${escape(booking.guestEmail || booking.contact || "—")}</small></td>
      <td>${escape(stayMarkup(booking))}${reason ? `<small class="booking-row-reason">${escape(reason)}</small>` : ""}</td>
      <td>${unitMarkup(booking)}</td>
      <td><span class="badge ${getBadgeClass(booking.status)}">${escape(statusLabel(booking.status))}</span></td>
      <td><small class="booking-placed">${escape(placedDate(booking.createdAt))}</small></td>
      <td><div class="booking-row-actions">${actions}${menuActions(booking)}</div></td>
    </tr>`;
  }

  function updateCounts() {
    const tabs = {
      "needs-action": "count-needs-action",
      today: "count-today",
      "in-house": "count-in-house",
      upcoming: "count-upcoming",
      past: "count-past",
      cancelled: "count-cancelled",
      all: "count-all",
    };
    for (const [tab, id] of Object.entries(tabs)) {
      document.getElementById(id).textContent = getFilteredBookings(tab).length;
    }
  }

  function render() {
    updateCounts();
    const statusFilter = document.getElementById("filter-status");
    const statusLabel = document.getElementById("filter-status-label");
    statusFilter.hidden = state.tab !== "all";
    statusLabel.hidden = state.tab !== "all";

    const bookings = getFilteredBookings().sort(compareBookings);
    const pageCount = Math.max(1, Math.ceil(bookings.length / pageSize));
    state.page = Math.min(state.page, pageCount);
    const first = (state.page - 1) * pageSize;
    const pageBookings = bookings.slice(first, first + pageSize);
    body.replaceChildren();

    if (!pageBookings.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 6;
      cell.className = "text-center";
      cell.textContent = state.loading ? "Loading bookings..." : "No bookings match this view.";
    } else {
      let previousSection = "";
      pageBookings.forEach((booking) => {
        if (state.tab === "today") {
          const section =
            booking.status === "CheckedIn" &&
            booking.checkOut === propertyToday()
              ? "Departures"
              : "Arrivals";
          if (section !== previousSection) {
            const heading = body.insertRow();
            heading.className = "booking-section-heading";
            const cell = heading.insertCell();
            cell.colSpan = 6;
            cell.textContent = section;
            previousSection = section;
          }
        }
        body.insertAdjacentHTML("beforeend", rowMarkup(booking));
      });
    }

    const firstShown = bookings.length ? first + 1 : 0;
    const lastShown = Math.min(first + pageSize, bookings.length);
    document.getElementById("booking-page-summary").textContent =
      `${firstShown}–${lastShown} of ${bookings.length}`;
    document.getElementById("booking-page-previous").disabled = state.page <= 1;
    document.getElementById("booking-page-next").disabled = state.page >= pageCount;
  }

  function movedTo(status, booking) {
    if (status === "Confirmed") {
      if (booking.checkIn > propertyToday()) return "Upcoming";
      if (booking.checkIn === propertyToday()) return "Today";
      return "Needs action";
    }
    if (status === "CheckedIn") return "In-house";
    if (status === "CheckedOut") return "Past";
    if (status === "Cancelled" || status === "Rejected" || status === "NoShow") {
      return "Cancelled";
    }
    return "Needs action";
  }

  function showToast(message, undo) {
    const toast = document.getElementById("booking-toast");
    const undoButton = document.getElementById("booking-undo");
    document.getElementById("booking-toast-message").textContent = message;
    undoButton.hidden = !undo;
    undoButton.onclick = undo || null;
    toast.hidden = false;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      toast.hidden = true;
    }, 8000);
  }

  async function undoAction(booking, previous, updated) {
    try {
      await apiRequest(
        `/api/admin/bookings/${encodeURIComponent(booking.id)}/undo`,
        {
          method: "POST",
          body: JSON.stringify({
            previousStatus: previous.status,
            previousCheckOut: previous.checkOut,
            previousRoomId: previous.roomId,
            expectedUpdatedAt: updated.updatedAt,
          }),
        },
      );
      document.getElementById("booking-toast").hidden = true;
      await reload();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function runAction(booking, status, edit = false) {
    if (status === "View" || status === "Edit") {
      window.bookingDrawer.open(booking.id, edit || status === "Edit");
      return;
    }
    if (status === "CheckedIn" && booking.roomId) {
      try {
        const result = await apiRequest(
          `/api/admin/room-status?start=${propertyToday()}&days=7`,
        );
        const room = result.rooms.find((item) => item.id === booking.roomId);
        if (
          room?.housekeepingStatus === "Dirty" &&
          !confirm("This room is Dirty. Check in anyway?")
        ) {
          return;
        }
      } catch (error) {
        showToast(error.message);
        return;
      }
    }
    const previous = {
      status: booking.status,
      checkOut: booking.checkOut,
      roomId: booking.roomId,
    };
    try {
      const updated = await apiRequest(
        `/api/admin/bookings/${encodeURIComponent(booking.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      );
      await reload();
      const undo =
        status === "Rejected" &&
        previous.status === "Pending" &&
        booking.type === "room" &&
        booking.checkOut < propertyToday()
          ? null
          : () => undoAction(booking, previous, updated);
      showToast(`Moved to ${movedTo(status, booking)}.`, undo);
      if (status === "Confirmed" && updated.emailDelivery?.sent === false) {
        showToast(`Booking confirmed. Email not sent: ${updated.emailDelivery.message}`, undo);
      }
    } catch (error) {
      if (
        error.details?.conflicts?.length ||
        /room free for these dates/i.test(error.message)
      ) {
        window.bookingDrawer.open(booking.id, false, {
          message: error.message,
          conflicts: error.details?.conflicts || [],
        });
      } else {
        showToast(error.message);
      }
    }
  }

  async function reload() {
    if (state.loading) return;
    state.loading = true;
    try {
      state.bookings = await apiRequest("/api/admin/bookings");
      document.getElementById("booking-list-error").style.display = "none";
      render();
    } catch (error) {
      const message = document.getElementById("booking-list-error");
      message.textContent = error.message;
      message.style.display = "block";
    } finally {
      state.loading = false;
    }
  }

  async function loadRoomTypes() {
    const select = document.getElementById("walkin-room-type");
    select.disabled = true;
    select.replaceChildren(new Option("Loading room types...", ""));
    try {
      const { rooms } = await apiRequest("/api/public-content");
      select.replaceChildren();
      rooms.forEach((room) => {
        const option = new Option(room.name, room.id);
        select.add(option);
      });
      if (!rooms.length) {
        select.add(new Option("No active room types available", ""));
      }
      select.disabled = rooms.length === 0;
    } catch (error) {
      select.replaceChildren(new Option("Could not load room types", ""));
      showToast(`Could not load room types: ${error.message}`);
    } finally {
      if (select.options.length && select.options[0].value === "") {
        select.selectedIndex = 0;
      }
    }
  }

  document.querySelectorAll("[data-booking-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.bookingTab;
      state.page = 1;
      document.querySelectorAll("[data-booking-tab]").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      render();
    });
  });

  const filterControls = [
    ["booking-search", "search", (value) => value.toLocaleLowerCase()],
    ["filter-type", "type", (value) => value],
    ["filter-status", "status", (value) => value],
    ["filter-start", "start", (value) => value],
    ["filter-end", "end", (value) => value],
  ];
  filterControls.forEach(([id, key, convert]) => {
    document.getElementById(id).addEventListener("input", (event) => {
      state[key] = convert(event.target.value);
      state.page = 1;
      if (state.start && state.end && state.start > state.end) {
        const message = document.getElementById("booking-list-error");
        message.textContent = "The date range start must be on or before its end.";
        message.style.display = "block";
        return;
      }
      document.getElementById("booking-list-error").style.display = "none";
      render();
    });
  });
  document.getElementById("clear-booking-filters").addEventListener("click", () => {
    state.search = "";
    state.type = "all";
    state.status = "All";
    state.start = "";
    state.end = "";
    state.page = 1;
    document.getElementById("booking-search").value = "";
    document.getElementById("filter-type").value = "all";
    document.getElementById("filter-status").value = "All";
    document.getElementById("filter-start").value = "";
    document.getElementById("filter-end").value = "";
    document.getElementById("booking-list-error").style.display = "none";
    render();
  });
  document.getElementById("booking-page-previous").addEventListener("click", () => {
    state.page -= 1;
    render();
  });
  document.getElementById("booking-page-next").addEventListener("click", () => {
    state.page += 1;
    render();
  });
  document.getElementById("booking-toast-close").addEventListener("click", () => {
    document.getElementById("booking-toast").hidden = true;
  });

  document
    .getElementById("add-walkin-form")
    .addEventListener("submit", async (event) => {
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
        if (!booking.roomTypeId) {
          showToast("Choose an active room type.");
          return;
        }
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
        if (created.emailDelivery?.sent === false) {
          showToast(`Booking saved. Email not sent: ${created.emailDelivery.message}`);
        }
        event.currentTarget.reset();
        toggleAddWalkin();
        await reload();
      } catch (error) {
        showToast(error.message);
      }
    });

  body.addEventListener("click", (event) => {
    const row = event.target.closest("[data-booking-id]");
    if (!row) return;
    const booking = state.bookings.find(
      (item) => String(item.id) === row.dataset.bookingId,
    );
    if (!booking) return;
    const action = event.target.closest("[data-action]");
    if (action) {
      event.stopPropagation();
      runAction(booking, action.dataset.action);
      return;
    }
    const menuAction = event.target.closest("[data-menu-action]");
    if (menuAction) {
      event.stopPropagation();
      menuAction.closest("details").open = false;
      runAction(
        booking,
        menuAction.dataset.menuAction === "Mark no-show"
          ? "NoShow"
          : menuAction.dataset.menuAction,
        menuAction.dataset.menuAction === "Edit",
      );
      return;
    }
    if (event.target.closest(".booking-menu")) return;
    window.bookingDrawer.open(booking.id);
  });
  body.addEventListener("keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches("tr[data-booking-id]")
    ) {
      event.preventDefault();
      window.bookingDrawer.open(event.target.dataset.bookingId);
    }
  });

  window.bookingsApp = { loadRoomTypes, reload };
  reload();
  window.setInterval(() => {
    if (!document.hidden) reload();
  }, 15000);
})();
