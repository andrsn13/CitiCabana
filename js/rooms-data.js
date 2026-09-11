// CMS Data for Citi Cabana Farm House Inn
// Fetched dynamically from Firestore

let roomsData = [];
let galleryImages = [];

const fallbackRoomsData = [
  { 
    id: 'standard', 
    name: 'Standard Room', 
    capacity: '2 pax (double bed)', 
    rate: 1000, 
    inclusions: 'Aircon, TV, private bathroom',
    inventory: 5,
    image: 'https://images.unsplash.com/photo-1618773928121-c32242fa11f5?q=80&w=800'
  },
  { 
    id: 'twin', 
    name: 'Twin Room', 
    capacity: '2–4 pax (2 separate beds)', 
    rate: 1500, 
    inclusions: 'Aircon, TV, private bathroom',
    inventory: 1,
    image: 'https://images.unsplash.com/photo-1598928506311-c55dd580e5cb?q=80&w=800'
  },
  { 
    id: 'couple', 
    name: 'Couple Room', 
    capacity: '2 pax (queen bed)', 
    rate: 1500, 
    inclusions: 'Aircon, TV, private bathroom',
    inventory: 4,
    image: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?q=80&w=800'
  },
  { 
    id: 'family', 
    name: 'Family Room', 
    capacity: '4–6 pax (2 double beds)', 
    rate: 2300, 
    inclusions: 'Aircon, TV, private bathroom',
    inventory: 2,
    image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?q=80&w=800'
  },
  { 
    id: 'villa', 
    name: 'Villa (private pool)', 
    capacity: '10 pax', 
    rate: 9000, 
    inclusions: 'Aircon, TV, private bathroom, private pool',
    inventory: 1,
    image: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?q=80&w=1200'
  }
];

const fallbackGalleryImages = [
  { url: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?q=80&w=1200", sort_order: 1 },
  { url: "https://images.unsplash.com/photo-1576013551627-1140e6c64147?q=80&w=1200", sort_order: 2 },
  { url: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?q=80&w=1200", sort_order: 3 },
  { url: "https://images.unsplash.com/photo-1530103862676-de8892bf309c?q=80&w=1200", sort_order: 4 },
  { url: "https://images.unsplash.com/photo-1499696010180-025ef6e1a8f9?q=80&w=1200", sort_order: 5 },
  { url: "https://images.unsplash.com/photo-1540541338287-41700207dee6?q=80&w=1200", sort_order: 6 },
  { url: "https://images.unsplash.com/photo-1618773928121-c32242fa11f5?q=80&w=1200", sort_order: 7 },
  { url: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?q=80&w=1200", sort_order: 8 }
];

let eventData = null;

const fallbackEventData = {
  title: "Celebrate Here",
  description: "Host your weddings, baptisms, birthdays, and special occasions in our beautiful event spaces. We offer customized setups tailored to unforgettable moments."
};

const generalAmenities = [
  'Swimming pool', 
  'Function/event hall', 
  'Food service', 
  'Videoke', 
  'Parking',
  'Free hygiene products included with every booking'
];

async function loadCMSData() {
  try {
    // 1. Load Rooms
    const roomsSnapshot = await db.collection('rooms').get();
    if (roomsSnapshot.empty) {
      console.log('Migrating static rooms to Firestore...');
      for (const room of fallbackRoomsData) {
        await db.collection('rooms').doc(room.id).set(room);
      }
      roomsData = fallbackRoomsData;
    } else {
      roomsData = roomsSnapshot.docs.map(doc => doc.data());
    }

    // 2. Load Gallery
    const gallerySnapshot = await db.collection('gallery').orderBy('sort_order').get();
    if (gallerySnapshot.empty) {
      console.log('Migrating static gallery to Firestore...');
      for (const img of fallbackGalleryImages) {
        await db.collection('gallery').add(img);
      }
      galleryImages = fallbackGalleryImages.map(img => img.url);
    } else {
      galleryImages = gallerySnapshot.docs.map(doc => doc.data().url);
    }

    // 3. Load Events
    const eventsSnapshot = await db.collection('events').doc('main').get();
    if (!eventsSnapshot.exists) {
      console.log('Migrating static events to Firestore...');
      await db.collection('events').doc('main').set(fallbackEventData);
      eventData = fallbackEventData;
    } else {
      eventData = eventsSnapshot.data();
    }
  } catch (error) {
    console.error("Error loading CMS data:", error);
    // Fallback to static if Firestore fails (e.g. permission issues)
    roomsData = fallbackRoomsData;
    galleryImages = fallbackGalleryImages.map(img => img.url);
    eventData = fallbackEventData;
  }
}
