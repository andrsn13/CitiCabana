document.addEventListener("DOMContentLoaded", async () => {
  initializeAdminSidebar();
  const loginForm = document.getElementById("login-form");

  if (loginForm) {
    await initializeLoginPage(loginForm);
    return;
  }

  try {
    const response = await fetch("/api/admin/session");
    if (!response.ok) throw new Error("Admin session check failed");
    const { admin } = await response.json();
    if (!admin) {
      window.location.replace("login.html");
      return;
    }
    const display = document.getElementById("admin-user-display");
    if (display) display.textContent = admin.email;
  } catch (error) {
    console.error("Could not verify local admin session:", error);
    window.location.replace("login.html");
  }
});

function initializeAdminSidebar() {
  const sidebar = document.querySelector(".admin-sidebar");
  const layout = sidebar?.closest(".admin-layout");
  const brand = sidebar?.querySelector(".admin-brand");
  const navigation = sidebar?.querySelector(".admin-nav");
  if (!sidebar || !layout || !brand || !navigation) return;

  const brandName = document.createElement("span");
  brandName.className = "admin-brand-name";
  brandName.textContent = brand.textContent.trim();
  brand.replaceChildren(brandName);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "admin-sidebar-toggle";
  toggle.setAttribute("aria-controls", navigation.id || "admin-navigation");
  navigation.id = navigation.id || "admin-navigation";
  brand.appendChild(toggle);

  const labels = new Map([
    ["Dashboard", "D"],
    ["Bookings", "B"],
    ["Room Status", "RS"],
    ["Reports", "R"],
    ["Manage Website", "CMS"],
    ["Logout", "↪"],
  ]);
  navigation.querySelectorAll("li").forEach((item) => {
    const link = item.querySelector("a");
    if (!link) {
      item.classList.add("admin-nav-section");
      return;
    }

    const label = link.textContent.trim();
    const text = document.createElement("span");
    text.className = "admin-nav-label";
    text.textContent = label;
    link.replaceChildren(text);
    link.dataset.shortLabel = labels.get(label) || label.slice(0, 2).toUpperCase();
    link.title = label;
    link.setAttribute("aria-label", label);
  });

  function setCollapsed(collapsed, persist = true) {
    layout.classList.toggle("sidebar-collapsed", collapsed);
    toggle.textContent = collapsed ? "›" : "‹";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "aria-label",
      collapsed ? "Expand navigation" : "Collapse navigation",
    );
    toggle.title = collapsed ? "Expand navigation" : "Collapse navigation";
    if (persist) {
      localStorage.setItem("citicabana-admin-sidebar-collapsed", String(collapsed));
    }
  }

  const savedState = localStorage.getItem("citicabana-admin-sidebar-collapsed");
  setCollapsed(savedState === "true", false);
  toggle.addEventListener("click", () => {
    setCollapsed(!layout.classList.contains("sidebar-collapsed"));
  });
}

async function initializeLoginPage(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const heading = document.querySelector("#view-signin h2");
  const subtitle = document.getElementById("auth-subtitle");
  const submitLabel = document.getElementById("login-submit-label");
  const errorMessage = document.getElementById("login-error");
  let setupMode = false;
  let loginReady = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginReady) return;

    button.disabled = true;
    submitLabel.textContent = setupMode ? "Creating..." : "Signing in...";
    errorMessage.classList.add("hidden");
    errorMessage.style.display = "none";

    try {
      const response = await fetch(
        `/api/admin/${setupMode ? "setup" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("login-email").value,
            password: document.getElementById("login-password").value,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign in failed");
      window.location.replace("dashboard.html");
    } catch (error) {
      errorMessage.textContent = error.message;
      errorMessage.classList.remove("hidden");
      errorMessage.style.display = "block";
      button.disabled = false;
      submitLabel.textContent = setupMode ? "Create Admin Account" : "Sign In";
    }
  });

  try {
    const [setupResponse, sessionResponse] = await Promise.all([
      fetch("/api/admin/setup-status"),
      fetch("/api/admin/session"),
    ]);
    if (!setupResponse.ok || !sessionResponse.ok) {
      throw new Error("The local server did not return an admin status");
    }
    const { configured } = await setupResponse.json();
    const { admin } = await sessionResponse.json();
    if (admin) {
      window.location.replace("dashboard.html");
      return;
    }

    setupMode = !configured;
    if (setupMode) {
      heading.textContent = "Create Admin Account";
      subtitle.textContent =
        "Create the first administrator for this local app.";
      submitLabel.textContent = "Create Admin Account";
      document.getElementById("login-password").minLength = 10;
      document.getElementById("login-password").autocomplete = "new-password";
    }
  } catch (error) {
    errorMessage.textContent = `${error.message}. Start the local server, then reload this page.`;
    errorMessage.classList.remove("hidden");
    errorMessage.style.display = "block";
    return;
  }

  loginReady = true;
  button.disabled = false;
}

async function logout() {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.replace("login.html");
}
