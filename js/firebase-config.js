// Firebase v10 compat initialization

const firebaseConfig = {
  apiKey: "AIzaSyBeeqcnkTPdS_Ncq4NmWDLWfoJdHmq8vt4",
  authDomain: "citi-cabana.firebaseapp.com",
  projectId: "citi-cabana",
  storageBucket: "citi-cabana.firebasestorage.app",
  messagingSenderId: "799572717209",
  appId: "1:799572717209:web:76a6b343c5b416d375d208",
  measurementId: "G-JRKPVWFKEJ",
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Export references for global use
const db = firebase.firestore();
const auth = firebase.auth();
