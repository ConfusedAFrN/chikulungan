// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push, serverTimestamp, remove, get } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAYlTSEQIC7ClvgYeWcqrciTFSBoA2tr5A",
  authDomain: "chikulungan-app.firebaseapp.com",
  databaseURL: "https://chikulungan-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chikulungan-app",
  storageBucket: "chikulungan-app.firebasestorage.app",
  messagingSenderId: "50919272300",
  appId: "1:50919272300:web:7f4a1c5c1f2fd1fdd08d49",
  measurementId: "G-GMVQZ6F3C6"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, onValue, set, push, serverTimestamp, remove, get };
export default app;

