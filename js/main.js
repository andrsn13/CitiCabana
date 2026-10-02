// Hub & Spoke Interactivity & Logic

let currentLightboxIndex = 0;
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

document.addEventListener("DOMContentLoaded", async () => {
  // Phase 2: Load CMS Data before rendering UI
  if (typeof loadCMSData === "function") {
    await loadCMSData();
  }

  renderSplitScreenRooms();
  renderEventsSection();
  renderBentoGrid();
  setupMobileMenu();
  setupOrderSummaryListeners();
  setupScrollspy();
});

// IntersectionObserver for Sticky Nav Scrollspy
function setupScrollspy() {
  const sections = document.querySelectorAll("section, header");
  const navLinks = document.querySelectorAll(".nav-link");

  const observerOptions = {
    root: null,
    rootMargin: "-50% 0px -50% 0px", // Triggers when section is in the middle of the viewport
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        navLinks.forEach((link) => {
          link.classList.remove("active");
          if (link.getAttribute("href") === `#${id}`) {
            link.classList.add("active");
          }
        });
      }
    });
  }, observerOptions);

  sections.forEach((section) => {
    observer.observe(section);
  });
}

// Render Alternating Editorial Rooms Layout with Bounding Boxes
function renderSplitScreenRooms() {
  const container = document.getElementById("rooms-container");
  const select = document.getElementById("room-type-select");

  if (!container || !select) return;

  container.innerHTML = ""; // Clear container

  roomsData.forEach((room) => {
    // Populate dropdown
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = `${room.name} (₱${Number(room.rate).toLocaleString()})`;
    select.appendChild(option);

    // Build editorial row
    const isVilla =
      room.id === "villa" || room.name.toLowerCase().includes("villa");
    const row = document.createElement("div");
    row.className = `room-row ${isVilla ? "full-width" : ""}`;

    row.innerHTML = `
      <div class="room-image-pane">
        <img src="${escapeHTML(room.image)}" alt="${escapeHTML(room.name)}">
      </div>
      <div class="room-text-pane">
        <h3 class="display-heading">${escapeHTML(room.name)}</h3>
        <div class="room-price">₱${Number(room.rate).toLocaleString()} ${escapeHTML(siteContent.roomNightLabel)}</div>
        <div class="room-meta">
          <strong>${escapeHTML(siteContent.roomCapacityLabel)}</strong> ${escapeHTML(room.capacity)}<br>
          <strong>${escapeHTML(siteContent.roomInclusionsLabel)}</strong> ${escapeHTML(room.inclusions)}<br>
          <span style="display:inline-block; margin-top:10px;">${escapeHTML(siteContent.roomAmenitiesNote)}</span>
        </div>
        <div>
          <button class="btn btn-outline book-room-button">${escapeHTML(siteContent.bookThisStay)}</button>
        </div>
      </div>
    `;
    row
      .querySelector(".book-room-button")
      .addEventListener("click", () => openBookingModal("room", room.id));
    container.appendChild(row);
  });
}

// Render Events Section
function renderEventsSection() {
  const container = document.getElementById("events-card-container");
  if (!container || !eventData) return;

  container.innerHTML = `
    <h2 class="display-heading">${escapeHTML(eventData.title)}</h2>
    <p>${escapeHTML(eventData.description)}</p>
    <button class="btn btn-primary mt-4">${escapeHTML(eventData.button || siteContent.eventsButton)}</button>
  `;
  container
    .querySelector("button")
    .addEventListener("click", () => openBookingModal("event"));
}

// Render Bento Grid (Top 5 images)
function renderBentoGrid() {
  const container = document.getElementById("bento-grid-container");
  if (!container || !galleryImages) return;

  container.innerHTML = ""; // clear

  const topImages = galleryImages.slice(0, 5);
  topImages.forEach((url, index) => {
    const item = document.createElement("div");
    item.className = `bento-item bento-${index + 1}`;
    item.onclick = () => openLightbox(index);
    const image = document.createElement("img");
    image.src = url;
    image.alt =
      galleryImageAltTexts[index] ||
      `${siteContent.galleryImageAlt} ${index + 1}`;
    item.appendChild(image);
    container.appendChild(item);
  });
}

// Hub Floating Booking Bar Logic
function triggerBookingFromBar() {
  const checkin = document.getElementById("bar-checkin").value;
  const checkout = document.getElementById("bar-checkout").value;
  const pax = document.getElementById("bar-pax").value;

  // Transfer values to modal form if they exist
  if (checkin) document.getElementById("room-checkin").value = checkin;
  if (checkout) document.getElementById("room-checkout").value = checkout;
  if (pax) document.getElementById("room-pax").value = pax;

  openBookingModal("room");
  calculateOrderSummary();
}

// Modal Logic
function openBookingModal(tab = "room", prefillRoom = null) {
  const modal = document.getElementById("booking-modal");
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden"; // Prevent background scroll

  switchBookingTab(tab);

  if (prefillRoom) {
    const select = document.getElementById("room-type-select");
    select.value = prefillRoom;
    calculateOrderSummary();
  }
}

function openGalleryModal() {
  const modal = document.getElementById("gallery-modal");
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const grid = document.getElementById("full-gallery-grid");
  if (grid && grid.children.length === 0) {
    // Populate full gallery
    galleryImages.forEach((url, index) => {
      const card = document.createElement("div");
      card.className = "gallery-card";
      card.addEventListener("click", () => openLightbox(index));
      const image = document.createElement("img");
      image.src = url;
      image.loading = "lazy";
      image.alt =
        galleryImageAltTexts[index] ||
        `${siteContent.galleryImageAlt} ${index + 1}`;
      card.appendChild(image);
      grid.appendChild(card);
    });
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
}

// Vanilla JS Lightbox Logic
function openLightbox(index) {
  currentLightboxIndex = index;
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightbox-img");

  img.src = galleryImages[currentLightboxIndex];
  img.alt =
    galleryImageAltTexts[currentLightboxIndex] ||
    `${siteContent.galleryImageAlt} ${currentLightboxIndex + 1}`;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  document.getElementById("lightbox").classList.add("hidden");
}

function nextLightbox() {
  currentLightboxIndex = (currentLightboxIndex + 1) % galleryImages.length;
  document.getElementById("lightbox-img").src =
    galleryImages[currentLightboxIndex];
}

function prevLightbox() {
  currentLightboxIndex =
    (currentLightboxIndex - 1 + galleryImages.length) % galleryImages.length;
  document.getElementById("lightbox-img").src =
    galleryImages[currentLightboxIndex];
}

// Listen for Escape key to close modals/lightbox
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLightbox();
    const bModal = document.getElementById("booking-modal");
    const gModal = document.getElementById("gallery-modal");
    if (bModal && !bModal.classList.contains("hidden"))
      closeModal("booking-modal");
    if (gModal && !gModal.classList.contains("hidden"))
      closeModal("gallery-modal");
  }
});

// Tab Logic inside Booking Drawer
function switchBookingTab(tab) {
  document
    .getElementById("tab-room")
    .classList.toggle("active", tab === "room");
  document
    .getElementById("tab-event")
    .classList.toggle("active", tab === "event");

  document
    .getElementById("room-form-container")
    .classList.toggle("hidden", tab !== "room");
  document
    .getElementById("event-form-container")
    .classList.toggle("hidden", tab !== "event");

  document
    .getElementById("summary-room-view")
    .classList.toggle("hidden", tab !== "room");
  document
    .getElementById("summary-event-view")
    .classList.toggle("hidden", tab !== "event");
}

// Live Order Summary Calculation
function setupOrderSummaryListeners() {
  const checkinInput = document.getElementById("room-checkin");
  const checkoutInput = document.getElementById("room-checkout");
  const typeSelect = document.getElementById("room-type-select");

  if (checkinInput)
    checkinInput.addEventListener("change", calculateOrderSummary);
  if (checkoutInput)
    checkoutInput.addEventListener("change", calculateOrderSummary);
  if (typeSelect) typeSelect.addEventListener("change", calculateOrderSummary);
}

function calculateOrderSummary() {
  const checkin = document.getElementById("room-checkin").value;
  const checkout = document.getElementById("room-checkout").value;
  const roomName = document.getElementById("room-type-select").value;

  const sumRoomName = document.getElementById("sum-room-name");
  const sumDates = document.getElementById("sum-dates");
  const sumNights = document.getElementById("sum-nights");
  const sumTotal = document.getElementById("sum-total");

  let rate = 0;

  if (roomName) {
    const roomObj = roomsData.find((r) => r.id === roomName);
    if (roomObj) {
      sumRoomName.textContent = roomObj.name;
      rate = Number(roomObj.rate);
      // Inject room image into summary
      const imgContainer = document.querySelector(".summary-img-placeholder");
      if (imgContainer) {
        const image = document.createElement("img");
        image.src = roomObj.image;
        image.alt = roomObj.name;
        imgContainer.replaceChildren(image);
      }
    }
  } else {
    sumRoomName.textContent = siteContent.roomSummaryNotSelected;
    const imgContainer = document.querySelector(".summary-img-placeholder");
    if (imgContainer) imgContainer.textContent = siteContent.roomSummaryEmpty;
  }

  let nights = 0;
  if (checkin && checkout) {
    sumDates.textContent = `${formatShortDate(checkin)} - ${formatShortDate(checkout)}`;
    const d1 = new Date(checkin);
    const d2 = new Date(checkout);
    if (d2 > d1) {
      nights = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    } else {
      sumDates.textContent = siteContent.invalidDates;
    }
  } else {
    sumDates.textContent = "-";
  }

  sumNights.textContent = nights;

  const total = nights * rate;
  sumTotal.textContent = `₱${total.toLocaleString()}`;
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Mobile Menu
function setupMobileMenu() {
  const btn = document.getElementById("mobile-menu-btn");
  const nav = document.querySelector(".nav-links");
  if (btn && nav) {
    btn.addEventListener("click", () => {
      nav.classList.toggle("show");
    });
    // Close menu when a link is clicked
    nav.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", () => nav.classList.remove("show"));
    });
  }
}
