const cmsContentGroups = [
  {
    title: "Page identity and navigation",
    test: (key) => /^(page|brand|nav)/.test(key),
  },
  { title: "Hero and booking bar", test: (key) => /^(hero|bar)/.test(key) },
  {
    title: "Rooms and booking copy",
    test: (key) =>
      /^(rooms|room|bookThis|bookingTab|stay|checkin|checkout|dateError|roomType|guests|detailsStep|fullName|contactLabel|notesLabel|summary)/.test(
        key,
      ),
  },
  { title: "Events", test: (key) => /^event/.test(key) },
  { title: "Gallery", test: (key) => /^gallery/.test(key) },
  {
    title: "Contact and policies",
    test: (key) =>
      /^(address|landmark|facebook|contact|phone|policies|checkinPolicy|downpaymentPolicy|paymentPolicy)/.test(
        key,
      ),
  },
  { title: "Other booking labels", test: () => true },
];

function cmsLabel(key) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

async function cmsRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.replace("login.html");
    throw new Error("Your admin session has ended");
  }
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function uploadImage(file) {
  const formData = new FormData();
  formData.append("image", file);
  return cmsRequest("/api/admin/upload", { method: "POST", body: formData });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!window.location.pathname.endsWith("cms.html")) return;
  initializeLocalCms();
});

async function initializeLocalCms() {
  document.getElementById("cms-room-form").addEventListener("submit", saveRoom);
  document
    .getElementById("cms-gallery-form")
    .addEventListener("submit", saveGalleryImage);
  try {
    const [publicData, rooms, gallery] = await Promise.all([
      cmsRequest("/api/public-content"),
      cmsRequest("/api/admin/rooms"),
      cmsRequest("/api/admin/gallery"),
    ]);
    renderContentEditor(publicData.content);
    renderRooms(rooms);
    renderGallery(gallery);
  } catch (error) {
    document
      .querySelector(".admin-content")
      .insertAdjacentHTML(
        "afterbegin",
        `<p class="cms-error" role="alert">${escapeCmsText(error.message)}</p>`,
      );
  }
}

function escapeCmsText(value) {
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

function renderContentEditor(content) {
  const container = document.getElementById("cms-content-fields");
  container.replaceChildren();
  const pending = new Set(Object.keys(content));

  cmsContentGroups.forEach((group, index) => {
    const keys = [...pending].filter(group.test);
    if (!keys.length) return;
    keys.forEach((key) => pending.delete(key));
    const details = document.createElement("details");
    details.className = "cms-content-group";
    details.open = index === 0;
    const summary = document.createElement("summary");
    summary.textContent = `${group.title} (${keys.length})`;
    const fields = document.createElement("div");
    fields.className = "cms-content-grid";
    keys.forEach((key) =>
      fields.appendChild(createContentField(key, content[key])),
    );
    details.append(summary, fields);
    container.appendChild(details);
  });
}

function createContentField(key, value) {
  const field = document.createElement("div");
  field.className = "form-group cms-content-field";
  const label = document.createElement("label");
  label.textContent = cmsLabel(key);
  const input = document.createElement(
    key.toLowerCase().includes("description") ||
      key === "address" ||
      key.toLowerCase().includes("text")
      ? "textarea"
      : "input",
  );
  input.dataset.contentKey = key;
  input.value = value;
  if (input.tagName === "TEXTAREA") input.rows = 3;
  if (/Image$/.test(key)) {
    input.type = "text";
    input.placeholder = "Image URL or upload a local image";
    const upload = document.createElement("input");
    upload.type = "file";
    upload.accept = "image/*";
    upload.setAttribute("aria-label", `Upload ${cmsLabel(key)}`);
    upload.addEventListener("change", async () => {
      if (!upload.files[0]) return;
      label.classList.add("is-uploading");
      try {
        const result = await uploadImage(upload.files[0]);
        input.value = result.url;
      } catch (error) {
        alert(error.message);
      } finally {
        label.classList.remove("is-uploading");
        upload.value = "";
      }
    });
    field.append(label, input, upload);
    return field;
  }
  field.append(label, input);
  return field;
}

async function saveSiteContent() {
  const button = document.getElementById("save-content-button");
  const status = document.getElementById("save-content-status");
  button.disabled = true;
  try {
    const content = {};
    document.querySelectorAll("[data-content-key]").forEach((input) => {
      content[input.dataset.contentKey] = input.value;
    });
    await cmsRequest("/api/admin/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
    status.textContent = "Saved";
    status.className = "cms-save-status success";
  } catch (error) {
    status.textContent = error.message;
    status.className = "cms-save-status error";
  } finally {
    button.disabled = false;
  }
}

async function loadRooms() {
  renderRooms(await cmsRequest("/api/admin/rooms"));
}

function renderRooms(rooms) {
  const grid = document.getElementById("cms-rooms-grid");
  grid.replaceChildren();
  if (!rooms.length) {
    grid.textContent = "No rooms found.";
    return;
  }
  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "cms-card";
    const image = document.createElement("img");
    image.src = room.image;
    image.alt = room.name;
    const title = document.createElement("h3");
    title.textContent = room.name;
    const details = document.createElement("p");
    details.textContent = `Rate: ₱${Number(room.rate).toLocaleString()} · Capacity: ${room.capacity} · Inventory: ${room.inventory}`;
    const actions = document.createElement("div");
    actions.className = "cms-actions";
    const edit = document.createElement("button");
    edit.className = "btn-save";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openRoomModal(room));
    const remove = document.createElement("button");
    remove.className = "btn-delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteRoom(room.id));
    actions.append(edit, remove);
    card.append(image, title, details, actions);
    grid.appendChild(card);
  });
}

function openRoomModal(room = null) {
  const form = document.getElementById("cms-room-form");
  form.reset();
  document.getElementById("room-id-input").value = room?.id || "";
  document.getElementById("room-name-input").value = room?.name || "";
  document.getElementById("room-capacity-input").value = room?.capacity || "";
  document.getElementById("room-rate-input").value = room?.rate ?? "";
  document.getElementById("room-inclusions-input").value =
    room?.inclusions || "";
  document.getElementById("room-inventory-input").value = room?.inventory ?? 1;
  document.getElementById("room-image-url").value = room?.image || "";
  document.getElementById("room-modal-title").textContent = room
    ? "Edit Room"
    : "Add Room";
  document.getElementById("cms-room-modal").style.display = "flex";
}

function closeRoomModal() {
  document.getElementById("cms-room-modal").style.display = "none";
}

async function saveRoom(event) {
  event.preventDefault();
  const button = document.getElementById("save-room-btn");
  button.disabled = true;
  try {
    let image = document.getElementById("room-image-url").value;
    const file = document.getElementById("room-image-upload").files[0];
    if (file) image = (await uploadImage(file)).url;
    await cmsRequest("/api/admin/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: document.getElementById("room-id-input").value,
        name: document.getElementById("room-name-input").value,
        capacity: document.getElementById("room-capacity-input").value,
        rate: document.getElementById("room-rate-input").value,
        inclusions: document.getElementById("room-inclusions-input").value,
        inventory: document.getElementById("room-inventory-input").value,
        image,
      }),
    });
    closeRoomModal();
    await loadRooms();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

async function deleteRoom(id) {
  if (
    !confirm(
      "Delete this room? Existing bookings will keep their saved room name.",
    )
  )
    return;
  try {
    await cmsRequest(`/api/admin/rooms/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await loadRooms();
  } catch (error) {
    alert(error.message);
  }
}

async function loadGallery() {
  renderGallery(await cmsRequest("/api/admin/gallery"));
}

function renderGallery(images) {
  const grid = document.getElementById("cms-gallery-grid");
  grid.replaceChildren();
  if (!images.length) {
    grid.textContent = "No gallery photos found.";
    return;
  }
  images.forEach((item) => {
    const card = document.createElement("article");
    card.className = "cms-card";
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = item.alt;
    const altInput = document.createElement("input");
    altInput.value = item.alt;
    altInput.maxLength = 300;
    altInput.setAttribute("aria-label", "Alternative text");
    const orderInput = document.createElement("input");
    orderInput.type = "number";
    orderInput.value = item.sort_order;
    orderInput.setAttribute("aria-label", "Sort order");
    const actions = document.createElement("div");
    actions.className = "cms-actions";
    const save = document.createElement("button");
    save.className = "btn-save";
    save.textContent = "Save details";
    save.addEventListener("click", async () => {
      try {
        await cmsRequest(`/api/admin/gallery/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alt: altInput.value,
            sort_order: orderInput.value,
          }),
        });
        await loadGallery();
      } catch (error) {
        alert(error.message);
      }
    });
    const remove = document.createElement("button");
    remove.className = "btn-delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this gallery photo?")) return;
      try {
        await cmsRequest(`/api/admin/gallery/${item.id}`, { method: "DELETE" });
        await loadGallery();
      } catch (error) {
        alert(error.message);
      }
    });
    actions.append(save, remove);
    card.append(image, altInput, orderInput, actions);
    grid.appendChild(card);
  });
}

function openGalleryModal() {
  document.getElementById("cms-gallery-form").reset();
  document.getElementById("cms-gallery-modal").style.display = "flex";
}

function closeGalleryModal() {
  document.getElementById("cms-gallery-modal").style.display = "none";
}

async function saveGalleryImage(event) {
  event.preventDefault();
  const button = document.getElementById("save-gallery-btn");
  button.disabled = true;
  try {
    const file = document.getElementById("gallery-image-upload").files[0];
    if (!file) throw new Error("Choose an image first");
    const { url } = await uploadImage(file);
    await cmsRequest("/api/admin/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        alt: document.getElementById("gallery-alt-input").value,
        sort_order: document.getElementById("gallery-sort-input").value,
      }),
    });
    closeGalleryModal();
    await loadGallery();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

function switchCmsTab(tabId, button) {
  document
    .querySelectorAll(".cms-tab")
    .forEach((tab) => tab.classList.remove("active"));
  document
    .querySelectorAll(".cms-section")
    .forEach((section) => section.classList.remove("active"));
  button.classList.add("active");
  document.getElementById(`cms-${tabId}`).classList.add("active");
}
