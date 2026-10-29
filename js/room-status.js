(() => {
  const grid = document.getElementById("status-grid");
  if (!grid) return;

  const blockingStatuses = new Set(["Pending", "Confirmed", "CheckedIn"]);
  const state = {
    rooms: [],
    unassignedBookings: [],
    startDate: "",
    days: 14,
    selection: null,
    filter: null,
  };
  let dragStart = null;
  let dragEnd = null;
  let ignoreNextClick = false;
  let bookingDrag = null;
  let suppressBookingClick = false;
  let latestLoadRequest = 0;

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

  function dateString(value) {
    return value.toISOString().slice(0, 10);
  }

  function addDays(value, amount) {
    const date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return dateString(date);
  }

  function differenceInDays(from, to) {
    return Math.round((parseDate(to) - parseDate(from)) / 86400000);
  }

  function dateLabel(value, options = { month: "short", day: "numeric" }) {
    return new Intl.DateTimeFormat("en", {
      ...options,
      timeZone: "UTC",
    }).format(parseDate(value));
  }

  function updateWindowSummary() {
    const summary = document.getElementById("chart-window-summary");
    const lastNight = addDays(state.startDate, state.days - 1);
    summary.textContent =
      `Showing ${dateLabel(state.startDate)}–${dateLabel(lastNight)} · ${state.days} nights`;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showError(message) {
    const error = document.getElementById("room-status-error");
    error.textContent = message;
    error.style.display = "block";
  }

  function clearError() {
    const error = document.getElementById("room-status-error");
    error.textContent = "";
    error.style.display = "none";
  }

  function getRoom(roomId) {
    return state.rooms.find((room) => room.id === roomId);
  }

  function getTodayBooking(room) {
    const today = propertyToday();
    return room.bookings.find(
      (booking) =>
        blockingStatuses.has(booking.status) &&
        booking.checkIn <= today &&
        today < booking.checkOut,
    );
  }

  function renderTodayStrip(stats) {
    const strip = document.getElementById("today-strip");
    strip.replaceChildren();
    const metrics = [
      ["occupied", "Occupied tonight", stats.occupied],
      ["arriving", "Arriving today", stats.arriving],
      ["departing", "Departing today", stats.departing],
      ["dirty", "Dirty", stats.dirty],
      ["available", "Available tonight", stats.available],
    ];
    metrics.forEach(([key, label, count]) => {
      const button = makeElement("button", "today-metric");
      button.type = "button";
      button.setAttribute("aria-pressed", String(state.filter === key));
      const value = makeElement("strong", "", count);
      const caption = makeElement("span", "", label);
      button.append(value, caption);
      button.addEventListener("click", () => {
        state.filter = state.filter === key ? null : key;
        renderTodayStrip(stats);
        renderTapeChart();
        renderHousekeeping();
      });
      strip.appendChild(button);
    });
  }

  function rowMatchesFilter(room) {
    if (!state.filter) return true;
    const today = propertyToday();
    const occupied = Boolean(getTodayBooking(room));
    if (state.filter === "occupied") return occupied;
    if (state.filter === "arriving") {
      return room.bookings.some(
        (booking) =>
          booking.checkIn === today &&
          ["Pending", "Confirmed"].includes(booking.status),
      );
    }
    if (state.filter === "departing") {
      return room.bookings.some(
        (booking) =>
          booking.status === "CheckedIn" && booking.checkOut <= today,
      );
    }
    if (state.filter === "dirty") return room.housekeepingStatus === "Dirty";
    if (state.filter === "available") {
      return (
        !occupied &&
        !room.blocks.some((block) => block.startDate <= today && today < block.endDate)
      );
    }
    return true;
  }

  function renderTapeChart() {
    grid.replaceChildren();
    grid.style.setProperty("--chart-days", state.days);
    const today = propertyToday();
    const lastDate = addDays(state.startDate, state.days);

    const header = makeElement("div", "chart-header-row");
    header.style.gridTemplateColumns =
      `var(--room-col-width) repeat(${state.days}, var(--day-col-width))`;
    const corner = makeElement("div", "chart-room-heading", "Room");
    header.appendChild(corner);
    for (let index = 0; index < state.days; index += 1) {
      const date = addDays(state.startDate, index);
      const day = makeElement(
        "div",
        [
          "chart-date-heading",
          date === today ? "is-today" : "",
          [0, 6].includes(parseDate(date).getUTCDay()) ? "is-weekend" : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      day.append(
        makeElement("strong", "", dateLabel(date, { weekday: "short" })),
        makeElement("span", "", dateLabel(date)),
      );
      day.title = date;
      header.appendChild(day);
    }
    grid.appendChild(header);

    const groups = new Map();
    state.rooms.forEach((room) => {
      if (!groups.has(room.roomId)) {
        groups.set(room.roomId, { type: room.roomType, rooms: [] });
      }
      groups.get(room.roomId).rooms.push(room);
    });
    state.unassignedBookings.forEach((booking) => {
      if (!groups.has(booking.roomTypeId)) {
        groups.set(booking.roomTypeId, {
          type: booking.roomType,
          rooms: [],
        });
      }
    });
    for (const [roomTypeId, group] of groups) {
      const { type, rooms } = group;
      const groupHeader = makeElement("div", "chart-group-header", type);
      groupHeader.style.gridColumn = `1 / span ${state.days + 1}`;
      grid.appendChild(groupHeader);
      rooms.forEach((room) => {
        if (!rowMatchesFilter(room)) return;
        const row = makeElement("div", "chart-row");
        row.dataset.roomId = room.id;
        row.style.gridTemplateColumns =
          `var(--room-col-width) repeat(${state.days}, var(--day-col-width))`;

        const roomHeader = makeElement("div", "chart-room-cell");
        const roomName = makeElement("strong", "chart-room-name", room.roomLabel);
        const housekeeping = makeElement(
          "button",
          `housekeeping-dot ${room.housekeepingStatus.toLowerCase()}`,
          room.housekeepingStatus === "Clean" ? "● Clean" : "● Dirty",
        );
        housekeeping.type = "button";
        housekeeping.title = `Mark ${room.housekeepingStatus === "Clean" ? "Dirty" : "Clean"}`;
        housekeeping.setAttribute(
          "aria-label",
          `${room.roomLabel}: ${room.housekeepingStatus}. Click to toggle.`,
        );
        housekeeping.addEventListener("click", () =>
          toggleHousekeeping(room),
        );
        roomHeader.append(roomName, housekeeping);
        row.appendChild(roomHeader);

        for (let index = 0; index < state.days; index += 1) {
          const date = addDays(state.startDate, index);
          const cell = makeElement(
            "button",
            [
              "chart-day-cell",
              date === today ? "is-today" : "",
              [0, 6].includes(parseDate(date).getUTCDay()) ? "is-weekend" : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
          cell.type = "button";
          cell.dataset.roomId = room.id;
          cell.dataset.date = date;
          cell.disabled = date < today;
          cell.style.gridColumn = String(index + 2);
          cell.title =
            date < today
              ? `${room.roomLabel} · ${date} · Past nights are read-only`
              : `${room.roomLabel} · ${date}`;
          row.appendChild(cell);
        }

        room.blocks.forEach((block) => {
          const startOffset = differenceInDays(state.startDate, block.startDate);
          const endOffset = differenceInDays(state.startDate, block.endDate);
          if (endOffset <= 0 || startOffset >= state.days) return;
          const bar = makeElement(
            "button",
            "chart-bar block-bar",
            `${startOffset < 0 ? "◀ " : ""}${block.reason}${endOffset > state.days ? " ▶" : ""}`,
          );
          bar.type = "button";
          bar.style.gridColumn =
            `${Math.max(0, startOffset) + 2} / ${Math.min(state.days, endOffset) + 2}`;
          bar.title =
            `${block.reason} · ${dateLabel(block.startDate)}–${dateLabel(block.endDate)} · Click to remove`;
          bar.addEventListener("click", () => removeRoomBlock(block));
          row.appendChild(bar);
        });

        room.bookings.forEach((booking) => {
          let visibleEnd = booking.checkOut;
          const isOverstay =
            booking.status === "CheckedIn" && booking.checkOut <= today;
          if (isOverstay) visibleEnd = addDays(today, 1);
          const startOffset = differenceInDays(state.startDate, booking.checkIn);
          const endOffset = differenceInDays(state.startDate, visibleEnd);
          if (endOffset <= 0 || startOffset >= state.days) return;
          const clippedLeft = startOffset < 0;
          const clippedRight = endOffset > state.days;
          const bar = makeElement(
            "button",
            [
              "chart-bar",
              "booking-bar",
              `booking-${booking.status.toLowerCase()}`,
              isOverstay ? "is-overstay" : "",
            ]
              .filter(Boolean)
              .join(" "),
            `${clippedLeft ? "◀ " : ""}${booking.guestName}${clippedRight ? " ▶" : ""}`,
          );
          bar.type = "button";
          bar.dataset.bookingId = booking.id;
          bar.style.gridColumn =
            `${Math.max(0, startOffset) + 2} / ${Math.min(state.days, endOffset) + 2}`;
          bar.title =
            `${booking.guestName} · ${booking.status} · ${booking.checkIn} to ${booking.checkOut} · ${booking.source}`;
          bar.setAttribute(
            "aria-label",
            `${booking.guestName}, ${booking.status}, ${booking.checkIn} to ${booking.checkOut}`,
          );
          bar.addEventListener("click", () => {
            if (suppressBookingClick) {
              suppressBookingClick = false;
              return;
            }
            openBooking(booking.id);
          });
          row.appendChild(bar);
        });
        grid.appendChild(row);
      });
      const unassigned = state.unassignedBookings.filter(
        (booking) => booking.roomTypeId === roomTypeId,
      );
      if (unassigned.length) {
        const row = makeElement("div", "chart-row chart-unassigned-row");
        row.style.gridTemplateColumns =
          `var(--room-col-width) repeat(${state.days}, var(--day-col-width))`;
        row.appendChild(
          makeElement("div", "chart-room-cell chart-unassigned-label", "Unassigned"),
        );
        for (let index = 0; index < state.days; index += 1) {
          const date = addDays(state.startDate, index);
          const cell = makeElement("div", "chart-day-cell");
          cell.classList.toggle("is-today", date === today);
          cell.classList.toggle(
            "is-weekend",
            [0, 6].includes(parseDate(date).getUTCDay()),
          );
          row.appendChild(cell);
        }
        unassigned.forEach((booking) => {
          const isOverstay =
            booking.status === "CheckedIn" && booking.checkOut <= today;
          const visibleEnd = isOverstay ? addDays(today, 1) : booking.checkOut;
          const startOffset = differenceInDays(state.startDate, booking.checkIn);
          const endOffset = differenceInDays(state.startDate, visibleEnd);
          if (endOffset <= 0 || startOffset >= state.days) return;
          const bar = makeElement(
            "button",
            [
              "chart-bar",
              "booking-bar",
              `booking-${booking.status.toLowerCase()}`,
              isOverstay ? "is-overstay" : "",
            ]
              .filter(Boolean)
              .join(" "),
            `${startOffset < 0 ? "◀ " : ""}${booking.guestName}${endOffset > state.days ? " ▶" : ""}`,
          );
          bar.type = "button";
          bar.dataset.bookingId = booking.id;
          bar.title =
            `${booking.guestName} · ${booking.status} · ${booking.checkIn} to ${booking.checkOut} · Unassigned`;
          bar.style.gridColumn =
            `${Math.max(0, startOffset) + 2} / ${Math.min(state.days, endOffset) + 2}`;
          bar.addEventListener("click", () => openBooking(booking.id));
          row.appendChild(bar);
        });
        grid.appendChild(row);
      }
    }

    if (!state.rooms.length && !state.unassignedBookings.length) {
      grid.appendChild(
        makeElement("p", "chart-message", "No physical rooms are configured."),
      );
    } else if (!grid.querySelector(".chart-row")) {
      grid.appendChild(
        makeElement("p", "chart-message", "No rooms match this highlight."),
      );
    }
    grid.dataset.rangeEnd = lastDate;
  }

  function renderHousekeeping() {
    const container = document.getElementById("housekeeping-grid");
    container.replaceChildren();
    const today = propertyToday();
    const rooms = [...state.rooms].sort(
      (a, b) =>
        Number(b.housekeepingStatus === "Dirty") -
          Number(a.housekeepingStatus === "Dirty") ||
        a.sortOrder - b.sortOrder ||
        a.unitNumber - b.unitNumber,
    );
    rooms.forEach((room) => {
      if (!rowMatchesFilter(room)) return;
      const card = makeElement("article", "housekeeping-card");
      const header = makeElement("div", "housekeeping-card-heading");
      header.append(
        makeElement("h3", "", room.roomLabel),
        makeElement(
          "span",
          `housekeeping-state ${room.housekeepingStatus.toLowerCase()}`,
          room.housekeepingStatus,
        ),
      );
      const tonightBooking = getTodayBooking(room);
      const block = room.blocks.find(
        (item) => item.startDate <= today && today < item.endDate,
      );
      const tonight = tonightBooking
        ? `Occupied until ${dateLabel(tonightBooking.checkOut)}`
        : block
          ? `Maintenance blocked: ${block.reason}`
          : "Vacant";
      const updated = room.housekeepingUpdatedAt
        ? new Date(room.housekeepingUpdatedAt).toLocaleString()
        : "Not recorded";
      const detail = makeElement("p", "housekeeping-tonight", tonight);
      const timestamp = makeElement("small", "", `Last updated ${updated}`);
      const toggle = makeElement(
        "button",
        "btn btn-outline",
        `Mark ${room.housekeepingStatus === "Clean" ? "Dirty" : "Clean"}`,
      );
      toggle.type = "button";
      toggle.addEventListener("click", () => toggleHousekeeping(room));
      card.append(header, detail, timestamp, toggle);
      container.appendChild(card);
    });
  }

  async function toggleHousekeeping(room) {
    const housekeepingStatus =
      room.housekeepingStatus === "Clean" ? "Dirty" : "Clean";
    try {
      await apiRequest(`/api/admin/room-status/${encodeURIComponent(room.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ housekeepingStatus }),
      });
      await load();
    } catch (error) {
      showError(error.message);
    }
  }

  function render() {
    renderTapeChart();
    renderHousekeeping();
  }

  async function load() {
    const requestId = ++latestLoadRequest;
    clearError();
    const query = new URLSearchParams({
      start: state.startDate || propertyToday(),
      days: String(state.days),
    });
    try {
      const result = await apiRequest(`/api/admin/room-status?${query}`);
      if (requestId !== latestLoadRequest) return;
      state.rooms = result.rooms;
      state.unassignedBookings = result.unassignedBookings;
      state.startDate = result.startDate;
      state.days = result.days;
      document.getElementById("chart-start").value = state.startDate;
      document.getElementById("chart-window").value = String(state.days);
      updateWindowSummary();
      renderTodayStrip(result.stats);
      render();
      if (result.unassignedBookings.length) {
        showError(
          `${result.unassignedBookings.length} active booking(s) have no assigned room unit. Resolve them from All Bookings.`,
        );
      }
    } catch (error) {
      if (requestId !== latestLoadRequest) return;
      grid.replaceChildren(makeElement("p", "chart-message", error.message));
      showError(error.message);
    }
  }

  async function openBooking(bookingId) {
    window.bookingDrawer.open(bookingId);
  }

  function openNewBooking(roomId, startDate, endDate) {
    const form = document.getElementById("new-booking-form");
    const roomSelect = form.elements.roomId;
    roomSelect.replaceChildren();
    state.rooms.forEach((room) => {
      const option = makeElement("option", "", room.roomLabel);
      option.value = room.id;
      option.dataset.roomTypeId = room.roomId;
      option.dataset.housekeepingStatus = room.housekeepingStatus;
      option.selected = room.id === roomId;
      roomSelect.appendChild(option);
    });
    form.elements.checkIn.value = startDate;
    form.elements.checkOut.value = endDate;
    document.getElementById("dirty-room-warning").hidden =
      roomSelect.selectedOptions[0]?.dataset.housekeepingStatus !== "Dirty";
    roomSelect.onchange = () => {
      document.getElementById("dirty-room-warning").hidden =
        roomSelect.selectedOptions[0]?.dataset.housekeepingStatus !== "Dirty";
    };
    document.getElementById("new-booking-dialog").showModal();
  }

  function openRoomBlock(roomId, startDate, endDate) {
    const form = document.getElementById("room-block-form");
    const error = document.getElementById("room-block-error");
    error.textContent = "";
    error.hidden = true;
    error.style.display = "none";
    const roomSelect = form.elements.roomId;
    roomSelect.replaceChildren();
    state.rooms.forEach((room) => {
      const option = makeElement("option", "", room.roomLabel);
      option.value = room.id;
      option.selected = room.id === roomId;
      roomSelect.appendChild(option);
    });
    form.elements.startDate.value = startDate;
    form.elements.endDate.value = endDate;
    form.elements.reason.value = "";
    document.getElementById("room-block-dialog").showModal();
  }

  function setSelection(roomId, firstDate, lastDate) {
    const startDate = firstDate <= lastDate ? firstDate : lastDate;
    const endDate = addDays(firstDate <= lastDate ? lastDate : firstDate, 1);
    state.selection = { roomId, startDate, endDate };
    grid.querySelectorAll(".chart-day-cell.is-selected").forEach((cell) => {
      cell.classList.remove("is-selected");
    });
    const startOffset = differenceInDays(state.startDate, startDate);
    const endOffset = differenceInDays(state.startDate, endDate);
    const row = grid.querySelector(`[data-room-id="${CSS.escape(roomId)}"]`);
    row
      ?.querySelectorAll(".chart-day-cell")
      .forEach((cell) => {
        const index = Number(cell.style.gridColumn) - 2;
        if (index >= startOffset && index < endOffset) {
          cell.classList.add("is-selected");
        }
      });
    document.getElementById("chart-block-selected").disabled = false;
  }

  grid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const bar = event.target.closest(".booking-bar");
    if (bar) return;
    const cell = event.target.closest(".chart-day-cell");
    if (!cell || cell.closest(".chart-unassigned-row")) return;
    dragStart = { roomId: cell.dataset.roomId, date: cell.dataset.date };
    dragEnd = dragStart;
    ignoreNextClick = true;
    event.preventDefault();
  });
  grid.addEventListener("pointerover", (event) => {
    if (!dragStart) return;
    const cell = event.target.closest(".chart-day-cell");
    if (
      cell &&
      cell.dataset.roomId === dragStart.roomId &&
      cell.dataset.date >= propertyToday()
    ) {
      dragEnd = { roomId: cell.dataset.roomId, date: cell.dataset.date };
      setSelection(dragStart.roomId, dragStart.date, dragEnd.date);
    }
  });
  window.addEventListener("pointerup", (event) => {
    if (bookingDrag) {
      const currentDrag = bookingDrag;
      bookingDrag = null;
      if (currentDrag.moved) {
        suppressBookingClick = true;
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const row = target?.closest(".chart-row");
        const targetRoom = row && getRoom(row.dataset.roomId);
        if (targetRoom) {
          const targetDate = dateAtPointer(event.clientX);
          const newStart = addDays(targetDate, -currentDrag.offsetDays);
          const nights = differenceInDays(
            currentDrag.booking.checkIn,
            currentDrag.booking.checkOut,
          );
          moveBooking(currentDrag.booking, targetRoom, newStart, addDays(newStart, nights));
        } else {
          window.setTimeout(() => {
            suppressBookingClick = false;
          }, 0);
        }
      }
      return;
    }
    if (!dragStart) return;
    const cell = event.target.closest?.(".chart-day-cell");
    if (
      cell &&
      cell.dataset.roomId === dragStart.roomId &&
      cell.dataset.date >= propertyToday()
    ) {
      dragEnd = { roomId: cell.dataset.roomId, date: cell.dataset.date };
    }
    setSelection(dragStart.roomId, dragStart.date, dragEnd.date);
    openNewBooking(
      dragStart.roomId,
      state.selection.startDate,
      state.selection.endDate,
    );
    dragStart = null;
    dragEnd = null;
  });
  grid.addEventListener("click", (event) => {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      event.preventDefault();
      return;
    }
    const cell = event.target.closest(".chart-day-cell");
    if (!cell || cell.closest(".chart-unassigned-row")) return;
    const endDate = addDays(cell.dataset.date, 1);
    setSelection(cell.dataset.roomId, cell.dataset.date, cell.dataset.date);
    openNewBooking(cell.dataset.roomId, cell.dataset.date, endDate);
  });
  grid.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest(".chart-day-cell");
    if (!cell || cell.closest(".chart-unassigned-row")) return;
    event.preventDefault();
    if (cell.dataset.date < propertyToday()) return;
    openRoomBlock(
      cell.dataset.roomId,
      cell.dataset.date,
      addDays(cell.dataset.date, 1),
    );
  });

  function dateAtPointer(clientX) {
    const scroll = document.getElementById("chart-scroll");
    const rect = scroll.getBoundingClientRect();
    const roomWidth =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--room-col-width",
        ),
      ) || 220;
    const dayWidth =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--day-col-width",
        ),
      ) || 84;
    const offset =
      clientX - rect.left + scroll.scrollLeft - roomWidth;
    const index = Math.max(
      0,
      Math.min(state.days - 1, Math.floor(offset / dayWidth)),
    );
    return addDays(state.startDate, index);
  }

  grid.addEventListener("pointerdown", (event) => {
    const bar = event.target.closest(".booking-bar");
    if (!bar) return;
    const booking = state.rooms
      .flatMap((room) => room.bookings)
      .find((item) => String(item.id) === bar.dataset.bookingId);
    if (!booking) return;
    const offsetDays = Math.max(
      0,
      differenceInDays(booking.checkIn, dateAtPointer(event.clientX)),
    );
    bookingDrag = {
      booking,
      offsetDays,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  });
  window.addEventListener("pointermove", (event) => {
    if (
      bookingDrag &&
      (Math.abs(event.clientX - bookingDrag.startX) > 5 ||
        Math.abs(event.clientY - bookingDrag.startY) > 5)
    ) {
      bookingDrag.moved = true;
    }
  });

  async function moveBooking(booking, targetRoom, checkIn, checkOut) {
    try {
      await apiRequest(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          roomTypeId: targetRoom.roomId,
          roomId: targetRoom.id,
          checkIn,
          checkOut,
        }),
      });
      state.selection = null;
      document.getElementById("chart-block-selected").disabled = true;
      await load();
    } catch (error) {
      showError(error.message);
      await load();
    }
  }

  async function removeRoomBlock(block) {
    if (!confirm(`Remove maintenance block "${block.reason}"?`)) return;
    try {
      await apiRequest(`/api/admin/room-blocks/${encodeURIComponent(block.id)}`, {
        method: "DELETE",
      });
      await load();
    } catch (error) {
      showError(error.message);
    }
  }

  document
    .getElementById("new-booking-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const option = form.elements.roomId.selectedOptions[0];
        if (!option) throw new Error("Choose a room unit.");
        const booking = {
          type: "room",
          roomTypeId: option.dataset.roomTypeId,
          roomId: option.value,
          guestName: form.elements.guestName.value,
          guestEmail: form.elements.guestEmail.value,
          contact: form.elements.contact.value,
          checkIn: form.elements.checkIn.value,
          checkOut: form.elements.checkOut.value,
          status: form.elements.status.value,
        };
        await apiRequest("/api/admin/bookings", {
          method: "POST",
          body: JSON.stringify(booking),
        });
        document.getElementById("new-booking-dialog").close();
        form.reset();
        await load();
      } catch (error) {
        showError(error.message);
      }
    });

  document
    .getElementById("room-block-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      const error = document.getElementById("room-block-error");
      error.textContent = "";
      error.hidden = true;
      error.style.display = "none";
      submit.disabled = true;
      submit.textContent = "Saving...";
      try {
        await apiRequest("/api/admin/room-blocks", {
          method: "POST",
          body: JSON.stringify({
            roomId: form.elements.roomId.value,
            startDate: form.elements.startDate.value,
            endDate: form.elements.endDate.value,
            reason: form.elements.reason.value,
          }),
        });
        document.getElementById("room-block-dialog").close();
        await load();
      } catch (error) {
        const message = document.getElementById("room-block-error");
        message.textContent = error.message;
        message.hidden = false;
        message.style.display = "block";
      } finally {
        submit.disabled = false;
        submit.textContent = "Save block";
      }
    });

  document
    .getElementById("chart-block-selected")
    .addEventListener("click", () => {
      if (state.selection) {
        openRoomBlock(
          state.selection.roomId,
          state.selection.startDate,
          state.selection.endDate,
        );
      }
    });

  document.getElementById("chart-previous").addEventListener("click", () => {
    state.startDate = addDays(state.startDate, -7);
    load();
  });
  document.getElementById("chart-next").addEventListener("click", () => {
    state.startDate = addDays(state.startDate, 7);
    load();
  });
  document.getElementById("chart-today").addEventListener("click", () => {
    state.startDate = propertyToday();
    load();
  });
  document.getElementById("chart-start").addEventListener("change", (event) => {
    state.startDate = event.target.value;
    load();
  });
  document.getElementById("chart-window").addEventListener("change", (event) => {
    state.days = Number(event.target.value);
    document.getElementById("chart-scroll").scrollLeft = 0;
    load();
  });
  document.getElementById("status-refresh").addEventListener("click", load);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () =>
      document.getElementById(button.dataset.closeDialog).close(),
    );
  });
  document.querySelectorAll("[data-status-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-status-tab]").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
      document.getElementById("chart-view").hidden =
        button.dataset.statusTab !== "chart";
      document.getElementById("housekeeping-view").hidden =
        button.dataset.statusTab !== "housekeeping";
    });
  });

  window.roomStatusApp = { load, showError };
})();
