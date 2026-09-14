import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAPKsaLlTCYq4gwGKICPzaaI3zjpLDEGjo",
  authDomain: "mff-whatsapp.firebaseapp.com",
  projectId: "mff-whatsapp",
  storageBucket: "mff-whatsapp.firebasestorage.app",
  messagingSenderId: "1025169712842",
  appId: "1:1025169712842:web:60623b16f120af2873f633"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
