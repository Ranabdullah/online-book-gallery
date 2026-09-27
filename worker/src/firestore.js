/**
 * Athenaeum Worker - minimal Firestore REST wrapper.
 * Covers what the app needs: get/set/delete a document, a simple
 * equality query, and listing a collection.
 */

import { getGoogleAccessToken } from './gcp-auth.js';

const FIRESTORE_SCOPE = ['https://www.googleapis.com/auth/datastore'];

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    fields[k] = toFirestoreValue(val);
  }
  return fields;
}

function fromFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromFirestoreValue(v);
  return obj;
}

export function makeFirestore(serviceAccount) {
  const projectBase = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents`;

  async function authHeaders() {
    const token = await getGoogleAccessToken(serviceAccount, FIRESTORE_SCOPE);
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  return {
    async get(path) {
      const res = await fetch(`${projectBase}/${path}`, { headers: await authHeaders() });
      if (res.status === 404) return null;
      const json = await res.json();
      if (!json.fields) return null;
      return { id: path.split('/').pop(), ...fromFirestoreFields(json.fields) };
    },

    async set(path, data, merge = true) {
      const url = new URL(`${projectBase}/${path}`);
      if (merge) Object.keys(data).forEach(k => url.searchParams.append('updateMask.fieldPaths', k));
      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ fields: toFirestoreFields(data) })
      });
      return res.json();
    },

    async delete(path) {
      await fetch(`${projectBase}/${path}`, { method: 'DELETE', headers: await authHeaders() });
    },

    /** Simple single-field equality query, e.g. query('books', 'category', 'EQUAL', 'Fiction'). */
    async query(collection, field, op, value) {
      const headers = await authHeaders();
      const body = {
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: { fieldFilter: { field: { fieldPath: field }, op, value: toFirestoreValue(value) } }
        }
      };
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents:runQuery`, {
        method: 'POST', headers, body: JSON.stringify(body)
      });
      const json = await res.json();
      return (Array.isArray(json) ? json : [])
        .filter(r => r.document)
        .map(r => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields) }));
    },

    async list(collection) {
      const res = await fetch(`${projectBase}/${collection}`, { headers: await authHeaders() });
      const json = await res.json();
      return (json.documents || []).map(d => ({ id: d.name.split('/').pop(), ...fromFirestoreFields(d.fields) }));
    }
  };
}
