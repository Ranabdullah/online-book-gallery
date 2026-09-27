/**
 * Athenaeum - Firebase config loader
 *
 * This file is what makes the app "multi-tenant": by default it points at
 * YOUR Firebase project below, so every link you share connects to your
 * library. Anyone who forks the repo and wants their OWN library just
 * overwrites the DEFAULT_CONFIG object with their own project's config -
 * nothing else in the app needs to change.
 *
 * Optional escape hatch: if a visitor's URL has ?fb=<base64-json-config>,
 * that overrides the default. Harmless if you never use it - most visitors
 * never will - but it's there for someone self-hosting against their own
 * Firebase project without forking the code.
 */

// TODO: paste your real firebaseConfig object from
// Firebase Console -> Project settings -> General -> Your apps -> SDK setup
const DEFAULT_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

function resolveFirebaseConfig() {
  try {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('fb');
    if (override) {
      const decoded = JSON.parse(atob(override));
      if (decoded.projectId) return decoded;
    }
  } catch (e) {
    console.warn('Ignoring invalid ?fb= override:', e.message);
  }
  return DEFAULT_CONFIG;
}

const ATHENAEUM_FIREBASE_CONFIG = resolveFirebaseConfig();
firebase.initializeApp(ATHENAEUM_FIREBASE_CONFIG);

// TODO: paste your deployed Worker URL (from `wrangler deploy` output),
// e.g. "https://athenaeum-backend.your-subdomain.workers.dev"
const ATHENAEUM_WORKER_URL = "https://athenaeum-backend.YOUR_SUBDOMAIN.workers.dev";

// Calls a Worker endpoint with the visitor's Firebase ID token attached,
// the way the old firebase.functions().httpsCallable() calls used to work.
async function athenaeumWorkerCall(path, body) {
  const user = firebase.auth().currentUser;
  const idToken = user ? await user.getIdToken() : null;
  const res = await fetch(`${ATHENAEUM_WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request to ${path} failed.`);
  return json;
}

window.AthenaeumFirebase = {
  auth: firebase.auth(),
  workerCall: athenaeumWorkerCall
};
