document.addEventListener("DOMContentLoaded", async () => {
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
