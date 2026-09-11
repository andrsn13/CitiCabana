// Hub & Spoke Interactivity & Logic

let currentLightboxIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
  // Phase 2: Load CMS Data before rendering UI
  if (typeof loadCMSData === 'function') {
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
  const sections = document.querySelectorAll('section, header');
  const navLinks = document.querySelectorAll('.nav-link');

  const observerOptions = {
    root: null,
    rootMargin: '-50% 0px -50% 0px', // Triggers when section is in the middle of the viewport
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          }
        });
      }
    });
  }, observerOptions);

  sections.forEach(section => {
    observer.observe(section);
  });
}

// Render Alternating Editorial Rooms Layout with Bounding Boxes
function renderSplitScreenRooms() {
  const container = document.getElementById('rooms-container');
  const select = document.getElementById('room-type-select');
  
  if (!container || !select) return;

  container.innerHTML = ''; // Clear container

  roomsData.forEach(room => {
    // Populate dropdown
    const option = document.createElement('option');
    option.value = room.name;
    option.textContent = `${room.name} (₱${room.rate.toLocaleString()})`;
    select.appendChild(option);

    // Build editorial row
    const isVilla = room.id === 'villa' || room.name.toLowerCase().includes('villa');
    const row = document.createElement('div');
    row.className = `room-row ${isVilla ? 'full-width' : ''}`;
    
    row.innerHTML = `
      <div class="room-image-pane">
        <img src="${room.image}" alt="${room.name}">
      </div>
      <div class="room-text-pane">
        <h3 class="display-heading">${room.name}</h3>
        <div class="room-price">₱${room.rate.toLocaleString()} / night</div>
        <div class="room-meta">
          <strong>Capacity:</strong> ${room.capacity}<br>
          <strong>Inclusions:</strong> ${room.inclusions}<br>
          <span style="display:inline-block; margin-top:10px;">Guests also have full access to general resort amenities including our swimming pool, parking, and food service options.</span>
        </div>
        <div>
          <button class="btn btn-outline" onclick="openBookingModal('room', '${room.name}')">Book This Stay</button>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

// Render Events Section
function renderEventsSection() {
  const container = document.getElementById('events-card-container');
  if (!container || !eventData) return;

  container.innerHTML = `
    <h2 class="display-heading">${eventData.title}</h2>
    <p>${eventData.description}</p>
    <button class="btn btn-primary mt-4" onclick="openBookingModal('event')">Inquire About Events</button>
  `;
}

// Render Bento Grid (Top 5 images)
function renderBentoGrid() {
  const container = document.getElementById('bento-grid-container');
  if (!container || !galleryImages) return;
  
  container.innerHTML = ''; // clear

  const topImages = galleryImages.slice(0, 5);
  topImages.forEach((url, index) => {
    const item = document.createElement('div');
    item.className = `bento-item bento-${index + 1}`;
    item.onclick = () => openLightbox(index);
    item.innerHTML = `<img src="${url}" alt="Gallery Image ${index + 1}">`;
    container.appendChild(item);
  });
}

// Hub Floating Booking Bar Logic
function triggerBookingFromBar() {
  const checkin = document.getElementById('bar-checkin').value;
  const checkout = document.getElementById('bar-checkout').value;
  const pax = document.getElementById('bar-pax').value;

  // Transfer values to modal form if they exist
  if (checkin) document.getElementById('room-checkin').value = checkin;
  if (checkout) document.getElementById('room-checkout').value = checkout;
  if (pax) document.getElementById('room-pax').value = pax;

  openBookingModal('room');
  calculateOrderSummary();
}

// Modal Logic
function openBookingModal(tab = 'room', prefillRoom = null) {
  const modal = document.getElementById('booking-modal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // Prevent background scroll
  
  switchBookingTab(tab);
  
  if (prefillRoom) {
    const select = document.getElementById('room-type-select');
    select.value = prefillRoom;
    calculateOrderSummary();
  }
}

function openGalleryModal() {
  const modal = document.getElementById('gallery-modal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  
  const grid = document.getElementById('full-gallery-grid');
  if (grid && grid.children.length === 0) {
    // Populate full gallery
    galleryImages.forEach((url, index) => {
      grid.innerHTML += `
        <div class="gallery-card" onclick="openLightbox(${index})">
          <img src="${url}" loading="lazy" alt="Gallery Image ${index + 1}">
        </div>
      `;
    });
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// Vanilla JS Lightbox Logic
function openLightbox(index) {
  currentLightboxIndex = index;
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  
  img.src = galleryImages[currentLightboxIndex];
  lightbox.classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
}

function nextLightbox() {
  currentLightboxIndex = (currentLightboxIndex + 1) % galleryImages.length;
  document.getElementById('lightbox-img').src = galleryImages[currentLightboxIndex];
}

function prevLightbox() {
  currentLightboxIndex = (currentLightboxIndex - 1 + galleryImages.length) % galleryImages.length;
  document.getElementById('lightbox-img').src = galleryImages[currentLightboxIndex];
}

// Listen for Escape key to close modals/lightbox
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox();
    const bModal = document.getElementById('booking-modal');
    const gModal = document.getElementById('gallery-modal');
    if (bModal && !bModal.classList.contains('hidden')) closeModal('booking-modal');
    if (gModal && !gModal.classList.contains('hidden')) closeModal('gallery-modal');
  }
});

// Tab Logic inside Booking Drawer
function switchBookingTab(tab) {
  document.getElementById('tab-room').classList.toggle('active', tab === 'room');
  document.getElementById('tab-event').classList.toggle('active', tab === 'event');
  
  document.getElementById('room-form-container').classList.toggle('hidden', tab !== 'room');
  document.getElementById('event-form-container').classList.toggle('hidden', tab !== 'event');
  
  document.getElementById('summary-room-view').classList.toggle('hidden', tab !== 'room');
  document.getElementById('summary-event-view').classList.toggle('hidden', tab !== 'event');
}

// Live Order Summary Calculation
function setupOrderSummaryListeners() {
  const checkinInput = document.getElementById('room-checkin');
  const checkoutInput = document.getElementById('room-checkout');
  const typeSelect = document.getElementById('room-type-select');

  if(checkinInput) checkinInput.addEventListener('change', calculateOrderSummary);
  if(checkoutInput) checkoutInput.addEventListener('change', calculateOrderSummary);
  if(typeSelect) typeSelect.addEventListener('change', calculateOrderSummary);
}

function calculateOrderSummary() {
  const checkin = document.getElementById('room-checkin').value;
  const checkout = document.getElementById('room-checkout').value;
  const roomName = document.getElementById('room-type-select').value;
  
  const sumRoomName = document.getElementById('sum-room-name');
  const sumDates = document.getElementById('sum-dates');
  const sumNights = document.getElementById('sum-nights');
  const sumTotal = document.getElementById('sum-total');
  
  let rate = 0;
  
  if (roomName) {
    sumRoomName.textContent = roomName;
    const roomObj = roomsData.find(r => r.name === roomName);
    if (roomObj) {
      rate = roomObj.rate;
      // Inject room image into summary
      const imgContainer = document.querySelector('.summary-img-placeholder');
      if (imgContainer) {
        imgContainer.innerHTML = `<img src="${roomObj.image}" alt="${roomObj.name}">`;
      }
    }
  } else {
    sumRoomName.textContent = "Not selected";
    const imgContainer = document.querySelector('.summary-img-placeholder');
    if (imgContainer) imgContainer.innerHTML = 'Select a room';
  }

  let nights = 0;
  if (checkin && checkout) {
    sumDates.textContent = `${formatShortDate(checkin)} - ${formatShortDate(checkout)}`;
    const d1 = new Date(checkin);
    const d2 = new Date(checkout);
    if (d2 > d1) {
      nights = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    } else {
      sumDates.textContent = "Invalid dates";
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Mobile Menu
function setupMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn');
  const nav = document.querySelector('.nav-links');
  if (btn && nav) {
    btn.addEventListener('click', () => {
      nav.classList.toggle('show');
    });
    // Close menu when a link is clicked
    nav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => nav.classList.remove('show'));
    });
  }
}
