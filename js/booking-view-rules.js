globalThis.bookingViewRules = Object.freeze({
  isCancelled(booking) {
    return ["Cancelled", "Rejected", "NoShow"].includes(booking.status);
  },
  belongsToTab(booking, tab, today) {
    switch (tab) {
      case "needs-action":
        return (
          booking.status === "Pending" ||
          (booking.status === "Confirmed" && booking.checkIn < today) ||
          (booking.status === "CheckedIn" && booking.checkOut < today)
        );
      case "today":
        return (
          (["Pending", "Confirmed"].includes(booking.status) &&
            booking.checkIn === today) ||
          (booking.status === "CheckedIn" && booking.checkOut === today)
        );
      case "in-house":
        return booking.status === "CheckedIn";
      case "upcoming":
        return (
          ["Pending", "Confirmed"].includes(booking.status) &&
          booking.checkIn > today
        );
      case "past":
        return booking.status === "CheckedOut";
      case "cancelled":
        return ["Cancelled", "Rejected", "NoShow"].includes(booking.status);
      case "all":
        return true;
      default:
        return false;
    }
  },
});
