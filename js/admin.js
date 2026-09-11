// Admin Application Logic

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  
  if (path.endsWith('dashboard.html')) initDashboard();
  if (path.endsWith('bookings.html')) initBookings();
  if (path.endsWith('booking-detail.html')) initBookingDetail();
  if (path.endsWith('room-status.html')) initRoomStatus();
  if (path.endsWith('reports.html')) initReports();
});

/* --- Utilities --- */
function getBadgeClass(status) {
  const map = {
    'Pending': 'badge-pending',
    'Confirmed': 'badge-confirmed',
    'Cancelled': 'badge-cancelled',
    'Completed': 'badge-completed',
    'CheckedIn': 'badge-checkedin'
  };
  return map[status] || 'badge-completed';
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  // Check if it's a Firestore timestamp
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString();
}

/* --- Dashboard --- */
function initDashboard() {
  // Listen to bookings to calculate stats
  db.collection('bookings').onSnapshot(snapshot => {
    let pendingCount = 0;
    let checkinsToday = 0;
    let checkoutsToday = 0;
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'Pending') pendingCount++;
      if (data.type === 'room') {
        if (data.checkIn === todayStr) checkinsToday++;
        if (data.checkOut === todayStr) checkoutsToday++;
      }
    });

    document.getElementById('dash-pending').textContent = pendingCount;
    document.getElementById('dash-checkins').textContent = checkinsToday;
    document.getElementById('dash-checkouts').textContent = checkoutsToday;
  });
}

/* --- Bookings List --- */
let bookingsUnsubscribe = null;

function initBookings() {
  const tbody = document.getElementById('bookings-tbody');
  const filterStatus = document.getElementById('filter-status');
  const filterType = document.getElementById('filter-type');
  
  // Set initial filter from URL if present
  const params = new URLSearchParams(window.location.search);
  if (params.get('filter')) {
    filterStatus.value = params.get('filter');
  }

  function renderTable(docs) {
    if (docs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No bookings found.</td></tr>';
      return;
    }
    
    tbody.innerHTML = '';
    docs.forEach(doc => {
      const data = doc.data();
      const tr = document.createElement('tr');
      
      const typeStr = data.type === 'room' ? `Room: ${data.roomType}` : `Event: ${data.eventType}`;
      const datesStr = data.type === 'room' ? `${data.checkIn} to ${data.checkOut}` : data.eventDate;
      
      tr.innerHTML = `
        <td>${formatDate(data.createdAt)}</td>
        <td><strong>${data.guestName}</strong><br><small>${data.contact || ''}</small></td>
        <td>${typeStr}</td>
        <td>${datesStr}</td>
        <td><span class="badge ${getBadgeClass(data.status)}">${data.status}</span></td>
        <td><a href="booking-detail.html?id=${doc.id}" class="btn btn-outline" style="padding:4px 8px; font-size:0.85rem;">View</a></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function fetchBookings() {
    let query = db.collection('bookings').orderBy('createdAt', 'desc');
    
    if (bookingsUnsubscribe) bookingsUnsubscribe();
    
    bookingsUnsubscribe = query.onSnapshot(snapshot => {
      let docs = [];
      snapshot.forEach(doc => docs.push(doc));
      
      // Apply client-side filters
      const statusF = filterStatus.value;
      const typeF = filterType.value;
      
      if (statusF !== 'All') docs = docs.filter(d => d.data().status === statusF);
      if (typeF !== 'All') docs = docs.filter(d => d.data().type === typeF);
      
      renderTable(docs);
    });
  }

  filterStatus.addEventListener('change', fetchBookings);
  filterType.addEventListener('change', fetchBookings);
  
  fetchBookings();
  
  // Walk-in form logic
  const walkinForm = document.getElementById('add-walkin-form');
  walkinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('walkin-type').value;
    const data = {
      type: type,
      status: "Confirmed", // direct walk-in/phone assumes confirmed
      guestName: document.getElementById('walkin-name').value,
      contact: "Walk-in/Phone",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    if (type === 'room') {
      data.roomType = document.getElementById('walkin-room-type').value;
      data.checkIn = document.getElementById('walkin-checkin').value;
      data.checkOut = document.getElementById('walkin-checkout').value;
    } else {
      data.eventType = document.getElementById('walkin-event-type').value;
      data.eventDate = document.getElementById('walkin-event-date').value;
    }
    
    await db.collection('bookings').add(data);
    toggleAddWalkin();
    walkinForm.reset();
  });
}

function toggleAddWalkin() {
  const c = document.getElementById('add-walkin-container');
  c.style.display = c.style.display === 'none' ? 'block' : 'none';
}

function toggleWalkinFields() {
  const type = document.getElementById('walkin-type').value;
  document.getElementById('walkin-room-fields').style.display = type === 'room' ? 'grid' : 'none';
  document.getElementById('walkin-event-fields').style.display = type === 'event' ? 'grid' : 'none';
}

/* --- Booking Detail --- */
let currentBookingId = null;
let currentBookingData = null;

function initBookingDetail() {
  const params = new URLSearchParams(window.location.search);
  currentBookingId = params.get('id');
  if (!currentBookingId) {
    document.querySelector('.admin-content').innerHTML = '<h2>Booking ID not found</h2>';
    return;
  }
  
  db.collection('bookings').doc(currentBookingId).onSnapshot(doc => {
    if (!doc.exists) return;
    currentBookingData = doc.data();
    renderBookingDetail(currentBookingData);
    if (currentBookingData.status === 'Pending' && currentBookingData.type === 'room') {
      checkOverlap(currentBookingData);
    }
  });
}

function renderBookingDetail(data) {
  const guestDiv = document.getElementById('detail-guest');
  const infoDiv = document.getElementById('detail-info');
  const actions = document.getElementById('action-buttons');
  
  guestDiv.innerHTML = `
    <p><strong>Name:</strong> ${data.guestName}</p>
    <p><strong>Contact:</strong> ${data.contact}</p>
    <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
    <p><strong>Created:</strong> ${formatDate(data.createdAt)}</p>
  `;
  
  if (data.type === 'room') {
    infoDiv.innerHTML = `
      <p><strong>Type:</strong> Room Booking</p>
      <p><strong>Room:</strong> ${data.roomType}</p>
      <p><strong>Check-in:</strong> ${data.checkIn}</p>
      <p><strong>Check-out:</strong> ${data.checkOut}</p>
      <p><strong>Pax:</strong> ${data.pax || 'N/A'}</p>
    `;
  } else {
    infoDiv.innerHTML = `
      <p><strong>Type:</strong> Event Booking</p>
      <p><strong>Event:</strong> ${data.eventType}</p>
      <p><strong>Date:</strong> ${data.eventDate}</p>
      <p><strong>Time:</strong> ${data.timeBlock || 'N/A'}</p>
      <p><strong>Pax:</strong> ${data.guestCount || 'N/A'}</p>
    `;
  }
  
  infoDiv.innerHTML += `<p><strong>Status:</strong> <span class="badge ${getBadgeClass(data.status)}">${data.status}</span></p>`;
  if (data.downpaymentAmount) {
    infoDiv.innerHTML += `<p><strong>Downpayment:</strong> ₱${data.downpaymentAmount} via ${data.downpaymentMethod}</p>`;
  }

  // Render actions based on status
  actions.innerHTML = '';
  if (data.status === 'Pending') {
    actions.innerHTML += `<button class="btn btn-success" onclick="showConfirmPanel()">Confirm (Log DP)</button>`;
    actions.innerHTML += `<button class="btn btn-danger" onclick="updateStatus('Cancelled')">Decline</button>`;
  } else if (data.status === 'Confirmed') {
    actions.innerHTML += `<button class="btn btn-primary" onclick="updateStatus('CheckedIn')">Mark Checked-In</button>`;
    actions.innerHTML += `<button class="btn btn-danger" onclick="updateStatus('Cancelled')">Cancel Booking</button>`;
  } else if (data.status === 'CheckedIn') {
    actions.innerHTML += `<button class="btn btn-primary" style="background:#6c757d;" onclick="updateStatus('Completed')">Mark Completed</button>`;
  }
}

async function checkOverlap(data) {
  // Simple check for any confirmed booking of the same room type that overlaps
  const snapshot = await db.collection('bookings')
    .where('type', '==', 'room')
    .where('roomType', '==', data.roomType)
    .where('status', '==', 'Confirmed')
    .get();
    
  let hasOverlap = false;
  const newStart = new Date(data.checkIn);
  const newEnd = new Date(data.checkOut);
  
  snapshot.forEach(doc => {
    if (doc.id === currentBookingId) return;
    const existing = doc.data();
    const extStart = new Date(existing.checkIn);
    const extEnd = new Date(existing.checkOut);
    
    // Logic: overlap if (newStart < extEnd) and (newEnd > extStart)
    if (newStart < extEnd && newEnd > extStart) {
      hasOverlap = true;
    }
  });
  
  if (hasOverlap) {
    document.getElementById('overlap-warning').style.display = 'block';
  }
}

function showConfirmPanel() {
  document.getElementById('confirm-panel').style.display = 'block';
}

function executeConfirm() {
  const amount = document.getElementById('dp-amount').value || 0;
  const method = document.getElementById('dp-method').value;
  
  db.collection('bookings').doc(currentBookingId).update({
    status: 'Confirmed',
    downpaymentAmount: parseFloat(amount),
    downpaymentMethod: method
  }).then(() => {
    document.getElementById('confirm-panel').style.display = 'none';
  });
}

function updateStatus(newStatus) {
  if (newStatus === 'Cancelled') {
    if (!confirm('Are you sure you want to cancel? If a downpayment was made, please ensure it is refunded.')) return;
  }
  db.collection('bookings').doc(currentBookingId).update({ status: newStatus });
}


/* --- Room Status --- */
// ASSUMPTION: 5 Standard, 1 Twin, 4 Couple, 2 Family, 1 Villa (Total 13)
const physicalRooms = [
  { id: 'std-1', label: 'Standard Room 1' }, { id: 'std-2', label: 'Standard Room 2' },
  { id: 'std-3', label: 'Standard Room 3' }, { id: 'std-4', label: 'Standard Room 4' },
  { id: 'std-5', label: 'Standard Room 5' },
  { id: 'twn-1', label: 'Twin Room 1' },
  { id: 'cpl-1', label: 'Couple Room 1' }, { id: 'cpl-2', label: 'Couple Room 2' },
  { id: 'cpl-3', label: 'Couple Room 3' }, { id: 'cpl-4', label: 'Couple Room 4' },
  { id: 'fam-1', label: 'Family Room 1' }, { id: 'fam-2', label: 'Family Room 2' },
  { id: 'vla-1', label: 'Villa' }
];

function initRoomStatus() {
  const grid = document.getElementById('status-grid');
  
  db.collection('roomStatus').onSnapshot(snapshot => {
    if (snapshot.empty) {
      grid.innerHTML = '<p>No status documents found. Click "Initialize/Reset Rooms" above.</p>';
      return;
    }
    
    grid.innerHTML = '';
    // Sort by ID naturally
    let docs = [];
    snapshot.forEach(d => docs.push({id: d.id, ...d.data()}));
    docs.sort((a,b) => a.id.localeCompare(b.id));
    
    docs.forEach(room => {
      const card = document.createElement('div');
      const cssClass = 'status-' + room.status.replace(' ', '');
      card.className = `status-card ${cssClass}`;
      
      card.innerHTML = `
        <h3>${room.roomLabel}</h3>
        <select onchange="updateRoomStatus('${room.id}', this.value)" style="width:100%; padding:8px;">
          <option value="Ready" ${room.status==='Ready'?'selected':''}>Ready</option>
          <option value="Occupied" ${room.status==='Occupied'?'selected':''}>Occupied</option>
          <option value="Needs Cleaning" ${room.status==='Needs Cleaning'?'selected':''}>Needs Cleaning</option>
        </select>
        <div style="font-size:0.8rem; margin-top:10px; color:#666;">
          Updated: ${formatDate(room.lastUpdated)}
        </div>
      `;
      grid.appendChild(card);
    });
  });
}

function updateRoomStatus(id, status) {
  db.collection('roomStatus').doc(id).update({
    status: status,
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function initRoomStatusDocs() {
  if (!confirm('This will recreate all physical room records. Continue?')) return;
  
  const batch = db.batch();
  physicalRooms.forEach(r => {
    const ref = db.collection('roomStatus').doc(r.id);
    batch.set(ref, {
      roomLabel: r.label,
      status: 'Ready',
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
  alert('Rooms initialized.');
}

/* --- Reports --- */
function initReports() {
  // Set default dates to current week
  const curr = new Date();
  const first = curr.getDate() - curr.getDay(); // First day is Sunday
  const last = first + 6; 
  
  const firstday = new Date(curr.setDate(first)).toISOString().split('T')[0];
  const lastday = new Date(curr.setDate(last)).toISOString().split('T')[0];
  
  document.getElementById('report-start').value = firstday;
  document.getElementById('report-end').value = lastday;
  
  document.getElementById('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = new Date(document.getElementById('report-start').value);
    const end = new Date(document.getElementById('report-end').value);
    end.setHours(23, 59, 59, 999);
    
    document.getElementById('report-results').style.display = 'grid';
    
    // Fetch bookings and filter in memory for simpler compat setup
    const snapshot = await db.collection('bookings')
      .where('status', '==', 'Confirmed')
      .get();
      
    let totalDp = 0;
    let count = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const created = data.createdAt ? data.createdAt.toDate() : new Date();
      if (created >= start && created <= end) {
        count++;
        if (data.downpaymentAmount) {
          totalDp += parseFloat(data.downpaymentAmount);
        }
      }
    });
    
    document.getElementById('report-total-bookings').textContent = count;
    document.getElementById('report-total-dp').textContent = totalDp.toLocaleString();
  });
}
