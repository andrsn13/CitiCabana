import nodemailer from "nodemailer";

function escapeHtml(value) {
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

export async function sendBookingConfirmation(booking) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.SMTP_FROM;
  const secure =
    process.env.SMTP_SECURE === "true" || port === 465;
  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !from
  ) {
    throw new Error(
      "Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.",
    );
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD || "",
          },
        }
      : {}),
  });
  const bookingDetails =
    booking.type === "room"
      ? `Room: ${booking.roomType}\nCheck-in: ${booking.checkIn}\nCheck-out: ${booking.checkOut}\nGuests: ${booking.pax}`
      : `Event: ${booking.eventType}\nDate: ${booking.eventDate}\nTime: ${booking.timeBlock || "To be arranged"}\nGuests: ${booking.guestCount}`;
  const htmlDetails =
    booking.type === "room"
      ? `<p><strong>Room:</strong> ${escapeHtml(booking.roomType)}</p>
         <p><strong>Check-in:</strong> ${escapeHtml(booking.checkIn)}</p>
         <p><strong>Check-out:</strong> ${escapeHtml(booking.checkOut)}</p>
         <p><strong>Guests:</strong> ${escapeHtml(booking.pax)}</p>`
      : `<p><strong>Event:</strong> ${escapeHtml(booking.eventType)}</p>
         <p><strong>Date:</strong> ${escapeHtml(booking.eventDate)}</p>
         <p><strong>Time:</strong> ${escapeHtml(booking.timeBlock || "To be arranged")}</p>
         <p><strong>Guests:</strong> ${escapeHtml(booking.guestCount)}</p>`;
  const subject = "Your Citi Cabana booking is confirmed";
  const greeting = `Hello ${booking.guestName},`;
  const downpayment =
    "A 50% downpayment is required to secure your booking. Please reply to this email or call the front desk to coordinate the amount and payment method directly. Payment is not processed through our booking system.";

  try {
    await transport.sendMail({
      from,
      to: booking.guestEmail,
      ...(process.env.SMTP_REPLY_TO
        ? { replyTo: process.env.SMTP_REPLY_TO }
        : {}),
      subject,
      text: `${greeting}\n\nYour Citi Cabana ${booking.type === "room" ? "room booking" : "event booking"} is confirmed.\n\n${bookingDetails}\n\n${downpayment}\n\nThank you,\nCiti Cabana Front Desk`,
      html: `<p>${escapeHtml(greeting)}</p>
        <p>Your Citi Cabana ${booking.type === "room" ? "room booking" : "event booking"} is confirmed.</p>
        ${htmlDetails}
        <p>${escapeHtml(downpayment)}</p>
        <p>Thank you,<br>Citi Cabana Front Desk</p>`,
    });
  } finally {
    transport.close();
  }
}
