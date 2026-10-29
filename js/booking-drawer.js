(() => {
  const dialog = document.getElementById("booking-drawer");
  if (!dialog) return;

  const content = document.getElementById("booking-drawer-content");
  const title = document.getElementById("booking-drawer-title");
  let booking = null;
  let rooms = [];

  function element(tag, className = "", text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

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

  function dateLabel(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function nights(checkIn, checkOut) {
    if (!checkIn || !checkOut) return 0;
    return Math.round(
      (new Date(`${checkOut}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) /
        86400000,
    );
  }

  function setError(message, conflicts = []) {
    content.querySelector(".booking-action-error")?.remove();
    const error = element("p", "booking-action-error", message);
    content.prepend(error);
    if (!conflicts.length) return;
    const list = element("ul", "booking-conflict-list");
    conflicts.forEach((conflict) => {
      const item = element(
        "li",
        "",
        `#${conflict.id} · ${conflict.guestName} · ${conflict.checkIn}–${conflict.checkOut} · ${conflict.unitLabel || "Unassigned"}`,
      );
      list.appendChild(item);
    });
    content.insertBefore(list, error.nextSibling);
  }

  function renderDetails() {
    title.textContent = booking.guestName || `Booking #${booking.id}`;
    content.replaceChildren();
    const facts = element("dl", "booking-facts");
    const details = [
      ["Guest", booking.guestName],
      ["Email / contact", booking.guestEmail || booking.contact || "—"],
      ["Room type", booking.type === "room" ? booking.roomType : "Event"],
      ["Unit", booking.type === "event" ? booking.eventType : booking.unitLabel || "Unassigned"],
      [
        "Stay",
        booking.type === "event"
          ? `${dateLabel(booking.eventDate)} · Event`
          : `${dateLabel(booking.checkIn)} → ${dateLabel(booking.checkOut)} · ${nights(booking.checkIn, booking.checkOut)} nights`,
      ],
      ["Status", booking.status],
      ["Source", booking.source],
    ];
    facts.append(
      ...details.flatMap(([label, value]) => [
        element("dt", "", label),
        element("dd", "", value || "—"),
      ]),
    );
    content.appendChild(facts);
    const actions = element("div", "booking-drawer-actions");
    const addAction = (label, className, action) => {
      const button = element("button", className, label);
      button.type = "button";
      button.addEventListener("click", action);
      actions.appendChild(button);
    };
    if (booking.status === "Pending") {
      if (booking.type !== "room" || booking.checkOut >= propertyToday()) {
        addAction("Confirm", "btn btn-primary", () => update({ status: "Confirmed" }));
      }
      addAction("Reject", "btn btn-danger", () => update({ status: "Rejected" }));
      addAction("Cancel", "btn btn-outline", () => update({ status: "Cancelled" }));
    } else if (booking.status === "Confirmed") {
      addAction("Check in", "btn btn-primary", () => checkIn());
      addAction("Cancel", "btn btn-danger", () => update({ status: "Cancelled" }));
      addAction("Mark no-show", "btn btn-outline", () => update({ status: "NoShow" }));
      if (booking.type === "room") {
        addAction("Edit dates / unit", "btn btn-outline", () => renderEditor());
      }
    } else if (booking.status === "CheckedIn") {
      addAction("Check out", "btn btn-primary", () => update({ status: "CheckedOut" }));
      addAction("Extend / edit stay", "btn btn-outline", () => renderEditor());
    }
    content.appendChild(actions);
  }

  async function checkIn() {
    if (booking.roomId) {
      try {
        const chart = await apiRequest(
          `/api/admin/room-status?start=${propertyToday()}&days=7`,
        );
        const room = chart.rooms.find((item) => item.id === booking.roomId);
        if (
          room?.housekeepingStatus === "Dirty" &&
          !confirm("This room is Dirty. Check in anyway?")
        ) {
          return;
        }
      } catch (error) {
        setError(error.message);
        return;
      }
    }
    await update({ status: "CheckedIn" });
  }

  async function renderEditor() {
    try {
      if (!rooms.length) {
        const result = await apiRequest(
          `/api/admin/room-status?start=${propertyToday()}&days=7`,
        );
        rooms = result.rooms;
      }
    } catch (error) {
      setError(error.message);
      return;
    }

    content.replaceChildren();
    const form = element("form", "status-form booking-edit-form");
    const roomLabel = element("label", "", "Assigned unit");
    const roomSelect = element("select");
    roomSelect.name = "roomId";
    rooms.forEach((room) => {
      if (room.roomId !== booking.roomTypeId) return;
      const option = element("option", "", room.roomLabel);
      option.value = room.id;
      option.dataset.roomTypeId = room.roomId;
      option.selected = room.id === booking.roomId;
      roomSelect.appendChild(option);
    });
    roomSelect.required = true;
    roomLabel.appendChild(roomSelect);

    const checkInLabel = element("label", "", "Check-in");
    const checkIn = document.createElement("input");
    checkIn.type = "date";
    checkIn.name = "checkIn";
    checkIn.required = true;
    checkIn.value = booking.checkIn;
    checkInLabel.appendChild(checkIn);
    const checkOutLabel = element("label", "", "Check-out");
    const checkOut = document.createElement("input");
    checkOut.type = "date";
    checkOut.name = "checkOut";
    checkOut.required = true;
    checkOut.value = booking.checkOut;
    checkOutLabel.appendChild(checkOut);

    const submit = element("button", "btn btn-primary", "Save changes");
    submit.type = "submit";
    const cancel = element("button", "btn btn-outline", "Cancel edit");
    cancel.type = "button";
    cancel.addEventListener("click", renderDetails);
    form.append(roomLabel, checkInLabel, checkOutLabel, submit, cancel);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const selected = roomSelect.selectedOptions[0];
      await update({
        roomTypeId: selected.dataset.roomTypeId,
        roomId: selected.value,
        checkIn: checkIn.value,
        checkOut: checkOut.value,
      });
    });
    content.appendChild(form);
  }

  async function update(changes) {
    try {
      booking = await apiRequest(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      dialog.close();
      await refreshLists();
    } catch (error) {
      setError(error.message, error.details?.conflicts || []);
    }
  }

  async function refreshLists() {
    await Promise.all([
      window.roomStatusApp?.load?.(),
      window.bookingsApp?.reload?.(),
    ]);
  }

  async function open(id, edit = false, initialError = null) {
    try {
      booking = await apiRequest(`/api/admin/bookings/${encodeURIComponent(id)}`);
      rooms = [];
      renderDetails();
      dialog.showModal();
      if (edit) await renderEditor();
      if (initialError) {
        setError(initialError.message, initialError.conflicts || []);
      }
    } catch (error) {
      if (window.roomStatusApp) {
        window.roomStatusApp.showError(error.message);
      } else {
        const listError = document.getElementById("booking-list-error");
        listError.textContent = error.message;
        listError.style.display = "block";
      }
    }
  }

  document.querySelectorAll('[data-close-dialog="booking-drawer"]').forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });

  window.bookingDrawer = { open };
})();
