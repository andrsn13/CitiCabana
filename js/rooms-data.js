// CMS Data for Citi Cabana Farm House Inn
// Loaded from the local PostgreSQL-backed API

let roomsData = [];
let galleryImages = [];
let galleryImageAltTexts = [];
let siteContent = {};

const fallbackRoomsData = [
  {
    id: "standard",
    name: "Standard Room",
    capacity: "2 pax (double bed)",
    rate: 1000,
    inclusions: "Aircon, TV, private bathroom",
    inventory: 5,
    image: "/images/room-standard.jpg",
  },
  {
    id: "twin",
    name: "Twin Room",
    capacity: "2–4 pax (2 separate beds)",
    rate: 1500,
    inclusions: "Aircon, TV, private bathroom",
    inventory: 1,
    image: "/images/room-twin.jpg",
  },
  {
    id: "couple",
    name: "Couple Room",
    capacity: "2 pax (queen bed)",
    rate: 1500,
    inclusions: "Aircon, TV, private bathroom",
    inventory: 4,
    image: "/images/room-couple.jpg",
  },
  {
    id: "family",
    name: "Family Room",
    capacity: "4–6 pax (2 double beds)",
    rate: 2300,
    inclusions: "Aircon, TV, private bathroom",
    inventory: 2,
    image: "/images/room-family.jpg",
  },
  {
    id: "villa",
    name: "Villa (private pool)",
    capacity: "10 pax",
    rate: 9000,
    inclusions: "Aircon, TV, private bathroom, private pool",
    inventory: 1,
    image: "/images/room-villa.jpg",
  },
];

const fallbackGalleryImages = [
  {
    url: "/images/gallery-01.jpg",
    sort_order: 1,
  },
  {
    url: "/images/gallery-02.jpg",
    sort_order: 2,
  },
  {
    url: "/images/gallery-03.jpg",
    sort_order: 3,
  },
  {
    url: "/images/gallery-04.jpg",
    sort_order: 4,
  },
  {
    url: "/images/gallery-05.jpg",
    sort_order: 5,
  },
  {
    url: "/images/hero.jpg",
    sort_order: 6,
  },
  {
    url: "/images/room-standard.jpg",
    sort_order: 7,
  },
  {
    url: "/images/events.jpg",
    sort_order: 8,
  },
];

let eventData = null;

const fallbackEventData = {
  title: "Celebrate Here",
  description:
    "Host your weddings, baptisms, birthdays, and special occasions in our beautiful event spaces. We offer customized setups tailored to unforgettable moments.",
};

const generalAmenities = [
  "Swimming pool",
  "Function/event hall",
  "Food service",
  "Videoke",
  "Parking",
  "Free hygiene products included with every booking",
];

async function loadCMSData() {
  try {
    const response = await fetch("/api/public-content");
    if (!response.ok)
      throw new Error(`Content request failed: ${response.status}`);
    const data = await response.json();
    siteContent = data.content;
    roomsData = data.rooms;
    galleryImages = data.gallery.map((image) => image.url);
    galleryImageAltTexts = data.gallery.map((image) => image.alt);
    eventData = {
      title: siteContent.eventsTitle,
      description: siteContent.eventsDescription,
      button: siteContent.eventsButton,
    };
    applySiteContent(siteContent);
  } catch (error) {
    console.error("Error loading local CMS data:", error);
    roomsData = fallbackRoomsData;
    galleryImages = fallbackGalleryImages.map((img) => img.url);
    galleryImageAltTexts = galleryImages.map(
      (_url, index) => `Citi Cabana gallery photo ${index + 1}`,
    );
    eventData = fallbackEventData;
  }
}

function applySiteContent(content) {
  document.title = content.pageTitle;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = content.pageDescription;

  document.querySelectorAll("[data-content]").forEach((element) => {
    const value = content[element.dataset.content];
    if (typeof value === "string") element.textContent = value;
  });

  document.querySelectorAll("[data-content-href]").forEach((element) => {
    const value = content[element.dataset.contentHref];
    if (typeof value === "string") {
      element.href =
        element.dataset.contentHref === "contactEmail"
          ? `mailto:${value}`
          : value;
    }
  });

  document.querySelectorAll("[data-content-aria-label]").forEach((element) => {
    const value = content[element.dataset.contentAriaLabel];
    if (typeof value === "string") element.setAttribute("aria-label", value);
  });

  const hero = document.querySelector('[data-content-background="heroImage"]');
  if (hero && content.heroImage) {
    hero.style.backgroundImage = `linear-gradient(rgba(42, 43, 37, 0.4), rgba(42, 43, 37, 0.4)), url("${content.heroImage.replaceAll('"', "")}")`;
  }

  const events = document.querySelector(
    '[data-content-background="eventsImage"]',
  );
  if (events && content.eventsImage) {
    events.style.backgroundImage = `url("${content.eventsImage.replaceAll('"', "")}")`;
  }

  const address = document.querySelector('[data-content="address"]');
  if (address) address.style.whiteSpace = "pre-line";
}
