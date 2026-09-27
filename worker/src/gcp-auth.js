/**
 * Athenaeum Worker - Google/Firebase auth primitives, reimplemented with
 * the Web Crypto API since Cloudflare Workers can't run the Node-only
 * firebase-admin / google-auth-library packages.
 *
 * Everything here is standard: a Firebase custom token and a Google OAuth2
 * service-account token are both just RS256-signed JWTs. Signing them
 * yourself with SubtleCrypto is exactly what those Node libraries do
 * internally - there's no missing functionality, just a different runtime.
 */

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlDecodeToString(str) {
  return new TextDecoder().decode(base64urlDecodeToBytes(str));
}

async function importPrivateKey(pem) {
  const pemBody = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const binary = atob(pemBody);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function signJwt(serviceAccount, claims, expiresInSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now, exp: now + expiresInSeconds, ...claims };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}

/** Exchanges a service-account JWT assertion for a real Google OAuth2 access token. */
export async function getGoogleAccessToken(serviceAccount, scopes) {
  const assertion = await signJwt(serviceAccount, {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: scopes.join(' ')
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Failed to get Google access token: ' + JSON.stringify(json).slice(0, 300));
  return json.access_token;
}

/** Firebase Auth custom token - same shape the Admin SDK's createCustomToken() produces. */
export async function createFirebaseCustomToken(serviceAccount, uid, claims = {}) {
  return signJwt(serviceAccount, {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    uid,
    claims
  }, 3600);
}

/** Sets custom claims (e.g. { admin: true }) on a user via the Identity Toolkit REST API. */
export async function setFirebaseCustomClaims(serviceAccount, uid, claims) {
  const token = await getGoogleAccessToken(serviceAccount, [
    'https://www.googleapis.com/auth/identitytoolkit',
    'https://www.googleapis.com/auth/firebase'
  ]);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${serviceAccount.project_id}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) })
  });
  return res.json();
}

let cachedCerts = null;
let certsFetchedAt = 0;

async function getGooglePublicCerts() {
  if (cachedCerts && Date.now() - certsFetchedAt < 3600_000) return cachedCerts;
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/[email protected]');
  cachedCerts = await res.json();
  certsFetchedAt = Date.now();
  return cachedCerts;
}

async function pemToCryptoKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey('spki', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/**
 * Verifies a Firebase Auth ID token sent from the frontend
 * (Authorization: Bearer <idToken>) - same checks the Firebase Admin SDK's
 * verifyIdToken() performs: signature, expiry, audience, issuer.
 */
export async function verifyFirebaseIdToken(idToken, projectId) {
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed token.');

  const header = JSON.parse(base64urlDecodeToString(headerB64));
  const payload = JSON.parse(base64urlDecodeToString(payloadB64));

  const certs = await getGooglePublicCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error('Unknown signing key - token may be stale, try signing in again.');

  const key = await pemToCryptoKey(pem);
  const signature = base64urlDecodeToBytes(sigB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) throw new Error('Invalid token signature.');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired.');
  if (payload.aud !== projectId) throw new Error('Token audience mismatch.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Token issuer mismatch.');

  // Custom claims set via createCustomToken land under payload.claims initially,
  // but once exchanged for a real ID token Firebase flattens them onto the
  // top-level payload (e.g. payload.admin, payload.guest) - matches what
  // context.auth.token looked like in the old Cloud Functions code.
  return { sub: payload.sub || payload.user_id, ...payload };
}
