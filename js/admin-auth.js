// Admin Auth Guard & Login Logic

function translateFirebaseError(errorCode) {
  switch (errorCode) {
    case 'auth/email-already-in-use': return 'An account with this email already exists.';
    case 'auth/weak-password': return 'Your password must be at least 6 characters long.';
    case 'auth/user-not-found': return 'We could not find an admin account with that email.';
    case 'auth/wrong-password': return 'Incorrect password. Please try again.';
    case 'auth/invalid-credential': return 'Invalid credentials. Please check your email and password.';
    case 'auth/invalid-email': return 'Please enter a valid email address.';
    case 'auth/too-many-requests': return 'Too many failed attempts. Please reset your password or try again later.';
    default: return 'An unexpected error occurred. Please try again.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. SIGN IN
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const pass = document.getElementById('login-password').value;
      const errorMsg = document.getElementById('login-error');
      
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Logging in...';

      auth.signInWithEmailAndPassword(email, pass)
        .catch(err => {
          console.error(err);
          errorMsg.textContent = translateFirebaseError(err.code);
          errorMsg.style.display = 'block';
          errorMsg.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Sign In';
        });
    });
  }

  // 2. CREATE ACCOUNT (Day Zero Setup)
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('signup-email').value;
      const pass = document.getElementById('signup-password').value;
      const errorMsg = document.getElementById('signup-error');
      const successMsg = document.getElementById('signup-success');
      
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      auth.createUserWithEmailAndPassword(email, pass)
        .then((userCredential) => {
          successMsg.style.display = 'block';
          successMsg.classList.remove('hidden');
          errorMsg.style.display = 'none';
          signupForm.reset();
        })
        .catch((error) => {
          console.error(error.code, error.message);
          errorMsg.textContent = translateFirebaseError(error.code); 
          errorMsg.style.display = 'block';
          errorMsg.classList.remove('hidden');
          successMsg.style.display = 'none';
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = 'Create Admin Account';
        });
    });
  }

  // 3. RESET PASSWORD
  const resetForm = document.getElementById('reset-form');
  if (resetForm) {
    resetForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('reset-email').value;
      const errorMsg = document.getElementById('reset-error');
      const successMsg = document.getElementById('reset-success');
      
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      auth.sendPasswordResetEmail(email)
        .then(() => {
          successMsg.style.display = 'block';
          successMsg.classList.remove('hidden');
          errorMsg.style.display = 'none';
          resetForm.reset();
        })
        .catch((error) => {
          errorMsg.textContent = translateFirebaseError(error.code);
          errorMsg.style.display = 'block';
          errorMsg.classList.remove('hidden');
          successMsg.style.display = 'none';
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = 'Send Reset Link';
        });
    });
  }

});

auth.onAuthStateChanged(user => {
  const path = window.location.pathname;
  const isLoginPage = path.endsWith('login.html') || path.endsWith('/admin/');
  
  if (user) {
    if (isLoginPage) {
      window.location.replace('dashboard.html');
    }
    
    // Set user display in sidebar if it exists
    const userDisplay = document.getElementById('admin-user-display');
    if (userDisplay) {
      userDisplay.textContent = user.email;
    }
  } else {
    // Redirect to login if unauthenticated on an admin page
    if (!isLoginPage && path.includes('/admin/')) {
      window.location.replace('login.html');
    }
  }
});

function logout() {
  auth.signOut();
}
