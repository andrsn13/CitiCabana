// Hub & Spoke Interactivity & Logic

// Array for Lightbox Gallery Data
const galleryImages = [
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?q=80&w=1200", // Resort View
  "https://images.unsplash.com/photo-1576013551627-1140e6c64147?q=80&w=1200", // Pool Area
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?q=80&w=1200", // Villa Interior
  "https://images.unsplash.com/photo-1530103862676-de8892bf309c?q=80&w=1200", // Event Setup
  "https://images.unsplash.com/photo-1499696010180-025ef6e1a8f9?q=80&w=1200", // Night Lights
  "https://images.unsplash.com/photo-1540541338287-41700207dee6?q=80&w=1200", // Additional 1
  "https://images.unsplash.com/photo-1618773928121-c32242fa11f5?q=80&w=1200", // Additional 2
  "https://images.unsplash.com/photo-1519225421980-715cb0215aed?q=80&w=1200"  // Additional 3
];
let currentLightboxIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  renderSplitScreenRooms();
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

  roomsData.forEach(room => {
    // Populate dropdown
    const option = document.createElement('option');
    option.value = room.name;
    option.textContent = `${room.name} (₱${room.rate.toLocaleString()})`;
    select.appendChild(option);

    // Build editorial row
    const isVilla = room.id === 'villa';
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
