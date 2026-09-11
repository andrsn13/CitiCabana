// Modal form handling

document.addEventListener('DOMContentLoaded', () => {
  const roomForm = document.getElementById('room-booking-form');
  const eventForm = document.getElementById('event-booking-form');

  if (roomForm) {
    roomForm.addEventListener('submit', handleRoomBooking);
  }
  if (eventForm) {
    eventForm.addEventListener('submit', handleEventBooking);
  }
});

async function handleRoomBooking(e) {
  e.preventDefault();
  
  const checkIn = document.getElementById('room-checkin').value;
  const checkOut = document.getElementById('room-checkout').value;
  const errorMsg = document.getElementById('room-date-error');
  
  if (new Date(checkOut) <= new Date(checkIn)) {
    errorMsg.style.display = 'block';
    return;
  }
  errorMsg.style.display = 'none';

  const bookingData = {
    type: "room",
    status: "Pending",
    guestName: document.getElementById('room-name').value,
    contact: document.getElementById('room-contact').value,
    roomType: document.getElementById('room-type-select').value,
    checkIn: checkIn,
    checkOut: checkOut,
    pax: parseInt(document.getElementById('room-pax').value, 10),
    notes: document.getElementById('room-notes').value || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Submitting...";

    await db.collection('bookings').add(bookingData);
    
    // Inject success state inside modal split view
    document.getElementById('room-booking-form').classList.add('hidden');
    document.getElementById('room-success-msg').classList.remove('hidden');
    
  } catch (err) {
    console.error("Error writing document: ", err);
    alert("There was an error submitting your request. Please try calling us instead.");
  } finally {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = false;
    btn.textContent = "Submit Reservation Request";
  }
}

async function handleEventBooking(e) {
  e.preventDefault();
  
  const bookingData = {
    type: "event",
    status: "Pending",
    guestName: document.getElementById('event-name').value,
    contact: document.getElementById('event-contact').value,
    eventType: document.getElementById('event-type').value,
    eventDate: document.getElementById('event-date').value,
    guestCount: parseInt(document.getElementById('event-pax').value, 10),
    timeBlock: document.getElementById('event-time').value,
    notes: document.getElementById('event-notes').value || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Submitting...";

    await db.collection('bookings').add(bookingData);
    
    document.getElementById('event-booking-form').classList.add('hidden');
    document.getElementById('event-success-msg').classList.remove('hidden');
    
  } catch (err) {
    console.error("Error writing document: ", err);
    alert("There was an error submitting your request. Please try calling us instead.");
  } finally {
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = false;
    btn.textContent = "Inquire Now";
  }
}

function resetRoomForm() {
  const form = document.getElementById('room-booking-form');
  form.reset();
  form.classList.remove('hidden');
  document.getElementById('room-success-msg').classList.add('hidden');
  // Reset sticky summary
  if (typeof calculateOrderSummary === 'function') calculateOrderSummary();
}

function resetEventForm() {
  const form = document.getElementById('event-booking-form');
  form.reset();
  form.classList.remove('hidden');
  document.getElementById('event-success-msg').classList.add('hidden');
}
