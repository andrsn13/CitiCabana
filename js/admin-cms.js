// CMS Administration Logic

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname.endsWith('cms.html')) {
    initCMS();
  }
});

async function initCMS() {
  await fetchAndRenderRooms();
  await fetchAndRenderGallery();
  await fetchAndRenderEvents();

  // Setup form listeners
  document.getElementById('cms-room-form').addEventListener('submit', handleSaveRoom);
  document.getElementById('cms-gallery-form').addEventListener('submit', handleSaveGallery);
  document.getElementById('cms-events-form').addEventListener('submit', handleSaveEvents);
}

/* ==============================================================
   ROOMS MANAGEMENT
   ============================================================== */

async function fetchAndRenderRooms() {
  const grid = document.getElementById('cms-rooms-grid');
  grid.innerHTML = '<p>Loading rooms...</p>';
  try {
    const snapshot = await db.collection('rooms').get();
    grid.innerHTML = '';
    if (snapshot.empty) {
      grid.innerHTML = '<p>No rooms found.</p>';
      return;
    }
    snapshot.forEach(doc => {
      const room = doc.data();
      const card = document.createElement('div');
      card.className = 'cms-card';
      card.innerHTML = `
        <img src="${room.image}" alt="${room.name}">
        <h3>${room.name}</h3>
        <p><strong>Rate:</strong> ₱${room.rate}</p>
        <p><strong>Capacity:</strong> ${room.capacity}</p>
        <p><strong>Inventory:</strong> ${room.inventory}</p>
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
          <button class="btn-save" style="flex:1;" onclick='openRoomModal(${JSON.stringify({id: doc.id, ...room})})'>Edit</button>
          <button class="btn-delete" style="flex:1;" onclick="deleteRoom('${doc.id}')">Delete</button>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (error) {
    console.error("Error fetching rooms:", error);
    grid.innerHTML = '<p style="color:red;">Error loading rooms. Check permissions.</p>';
  }
}

function openRoomModal(roomData = null) {
  const modal = document.getElementById('cms-room-modal');
  const form = document.getElementById('cms-room-form');
  const title = document.getElementById('room-modal-title');
  
  form.reset();
  document.getElementById('room-image-url').value = '';
  document.getElementById('room-upload-progress').style.display = 'none';

  if (roomData) {
    title.textContent = 'Edit Room';
    document.getElementById('room-id-input').value = roomData.id;
    document.getElementById('room-name-input').value = roomData.name;
    document.getElementById('room-capacity-input').value = roomData.capacity;
    document.getElementById('room-rate-input').value = roomData.rate;
    document.getElementById('room-inclusions-input').value = roomData.inclusions;
    document.getElementById('room-inventory-input').value = roomData.inventory;
    document.getElementById('room-image-url').value = roomData.image;
  } else {
    title.textContent = 'Add New Room';
    document.getElementById('room-id-input').value = '';
  }
  
  modal.style.display = 'flex';
}

function closeRoomModal() {
  document.getElementById('cms-room-modal').style.display = 'none';
}

async function handleSaveRoom(e) {
  e.preventDefault();
  const btn = document.getElementById('save-room-btn');
  const progress = document.getElementById('room-upload-progress');
  btn.disabled = true;

  try {
    const roomId = document.getElementById('room-id-input').value;
    const name = document.getElementById('room-name-input').value;
    
    // Auto-generate ID for new rooms if not provided
    const docId = roomId || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    let imageUrl = document.getElementById('room-image-url').value;
    const fileInput = document.getElementById('room-image-upload');
    
    // Upload image if a new file is selected
    if (fileInput.files.length > 0) {
      progress.style.display = 'block';
      const file = fileInput.files[0];
      const storageRef = firebase.storage().ref();
      const fileRef = storageRef.child(`rooms/${Date.now()}_${file.name}`);
      await fileRef.put(file);
      imageUrl = await fileRef.getDownloadURL();
      progress.style.display = 'none';
    }

    if (!imageUrl) {
      alert("Please provide an image for the room.");
      btn.disabled = false;
      return;
    }

    const roomData = {
      id: docId,
      name: name,
      capacity: document.getElementById('room-capacity-input').value,
      rate: Number(document.getElementById('room-rate-input').value),
      inclusions: document.getElementById('room-inclusions-input').value,
      inventory: Number(document.getElementById('room-inventory-input').value),
      image: imageUrl
    };

    await db.collection('rooms').doc(docId).set(roomData);
    closeRoomModal();
    await fetchAndRenderRooms();

  } catch (error) {
    console.error("Error saving room:", error);
    alert("Failed to save room. Check console for details.");
  } finally {
    btn.disabled = false;
    progress.style.display = 'none';
  }
}

async function deleteRoom(roomId) {
  if (confirm('Are you sure you want to delete this room?')) {
    try {
      await db.collection('rooms').doc(roomId).delete();
      await fetchAndRenderRooms();
    } catch (error) {
      console.error("Error deleting room:", error);
      alert("Failed to delete room.");
    }
  }
}

/* ==============================================================
   GALLERY MANAGEMENT
   ============================================================== */

async function fetchAndRenderGallery() {
  const grid = document.getElementById('cms-gallery-grid');
  grid.innerHTML = '<p>Loading gallery...</p>';
  try {
    const snapshot = await db.collection('gallery').orderBy('sort_order').get();
    grid.innerHTML = '';
    if (snapshot.empty) {
      grid.innerHTML = '<p>No photos found.</p>';
      return;
    }
    snapshot.forEach(doc => {
      const img = doc.data();
      const card = document.createElement('div');
      card.className = 'cms-card';
      card.innerHTML = `
        <img src="${img.url}" alt="Gallery Image">
        <p><strong>Sort Order:</strong> ${img.sort_order}</p>
        <button class="btn-delete" style="width: 100%; margin-top: 1rem;" onclick="deleteGalleryImage('${doc.id}')">Delete Photo</button>
      `;
      grid.appendChild(card);
    });
  } catch (error) {
    console.error("Error fetching gallery:", error);
    grid.innerHTML = '<p style="color:red;">Error loading gallery.</p>';
  }
}

function openGalleryModal() {
  document.getElementById('cms-gallery-form').reset();
  document.getElementById('gallery-upload-progress').style.display = 'none';
  document.getElementById('cms-gallery-modal').style.display = 'flex';
}

function closeGalleryModal() {
  document.getElementById('cms-gallery-modal').style.display = 'none';
}

async function handleSaveGallery(e) {
  e.preventDefault();
  const btn = document.getElementById('save-gallery-btn');
  const progress = document.getElementById('gallery-upload-progress');
  const fileInput = document.getElementById('gallery-image-upload');
  
  if (fileInput.files.length === 0) {
    alert("Please select an image to upload.");
    return;
  }

  btn.disabled = true;
  progress.style.display = 'block';

  try {
    const sortOrder = Number(document.getElementById('gallery-sort-input').value);
    const file = fileInput.files[0];
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(`gallery/${Date.now()}_${file.name}`);
    
    await fileRef.put(file);
    const imageUrl = await fileRef.getDownloadURL();

    await db.collection('gallery').add({
      url: imageUrl,
      sort_order: sortOrder
    });

    closeGalleryModal();
    await fetchAndRenderGallery();

  } catch (error) {
    console.error("Error uploading gallery image:", error);
    alert("Failed to upload image.");
  } finally {
    btn.disabled = false;
    progress.style.display = 'none';
  }
}

async function deleteGalleryImage(docId) {
  if (confirm('Are you sure you want to delete this photo?')) {
    try {
      await db.collection('gallery').doc(docId).delete();
      await fetchAndRenderGallery();
    } catch (error) {
      console.error("Error deleting photo:", error);
      alert("Failed to delete photo.");
    }
  }
}

/* ==============================================================
   EVENTS MANAGEMENT
   ============================================================== */

async function fetchAndRenderEvents() {
  try {
    const doc = await db.collection('events').doc('main').get();
    if (doc.exists) {
      const data = doc.data();
      document.getElementById('event-title-input').value = data.title || '';
      document.getElementById('event-desc-input').value = data.description || '';
    }
  } catch (error) {
    console.error("Error fetching events:", error);
  }
}

async function handleSaveEvents(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const status = document.getElementById('event-save-status');
  btn.disabled = true;
  status.style.display = 'none';

  try {
    const data = {
      title: document.getElementById('event-title-input').value,
      description: document.getElementById('event-desc-input').value
    };

    await db.collection('events').doc('main').set(data);
    status.style.display = 'inline';
    setTimeout(() => status.style.display = 'none', 3000);
  } catch (error) {
    console.error("Error saving events:", error);
    alert("Failed to save events content.");
  } finally {
    btn.disabled = false;
  }
}
