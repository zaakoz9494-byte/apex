// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC7eVUI5bimniUfGEczaSu8BelIuv1KmlU",
  authDomain: "apex-2c0e4.firebaseapp.com",
  projectId: "apex-2c0e4",
  storageBucket: "apex-2c0e4.firebasestorage.app",
  messagingSenderId: "730797375406",
  appId: "1:730797375406:web:cc7ea9d4236f7dea3ed23f",
  measurementId: "G-FF1PNB9G2F"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
