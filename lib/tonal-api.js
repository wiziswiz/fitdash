/**
 * tonal-api.js — Network layer for Tonal's private /v6 API.
 *
 * This is the ONLY module (besides auth.js) that hits the network. It powers the
 * `sync` and `workout` commands. The read/analyze commands stay fully offline.
 *
 * Endpoint knowledge (discovered via one-time mitmproxy capture; universal):
 *   POST   /v6/user-workouts          → create custom workout      (HTTP 200)
 *   GET    /v6/user-workouts          → list custom workouts       (HTTP 200)
 *   DELETE /v6/user-workouts/{id}     → delete                     (HTTP 204)
 *   GET    /v6/movements              → exercise library (~331)    (HTTP 200)
 *   GET    /v6/users/userinfo         → user profile (id auto-fetched)
 *   GET    /v6/users/{id}/workout-activities    → workout history (paginated)
 *   GET    /v6/users/{id}/strength-scores/...   → strength data
 *   GET    /v6/users/{id}/muscle-readiness/current
 */

import { login, TONAL } from './auth.js';

function authHeaders(token, json = false) {
  const h = { appversion: TONAL.appVersion, accept: '*/*', authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${TONAL.apiBase}${path}`, {
    method,
    headers: { ...authHeaders(token, body != null), ...(headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res;
}

/**
 * Create an authenticated API session. Logs in, auto-fetches user_id.
 * @returns {Promise<{ token, userId, userInfo }>}
 */
export async function connect(creds = null) {
  const token = await login(creds);
  const res = await req('GET', '/v6/users/userinfo', { token });
  if (!res.ok) throw new Error(`userinfo failed (HTTP ${res.status})`);
  const userInfo = await res.json();
  const userId = userInfo.id; // top-level "id", NOT userId/user_id
  if (!userId) throw new Error('Could not resolve user id from userinfo.');
  return { token, userId, userInfo };
}

// ─── MOVEMENT LIBRARY ────────────────────────────────────────────────────────

/**
 * Fetch the full exercise library. Always fetched live — never hardcode UUIDs.
 * @returns {Promise<Array>} [{ id, name, muscleGroups, onMachine, countReps, ... }]
 */
export async function getMovements(token) {
  const res = await req('GET', '/v6/movements', { token });
  if (!res.ok) throw new Error(`movements fetch failed (HTTP ${res.status})`);
  return res.json();
}

/**
 * Build a name→movement lookup (case-insensitive) for resolving exercise names.
 */
export function indexMovements(movements) {
  const byName = {};
  for (const m of movements) {
    if (m.name) byName[m.name.toLowerCase()] = m;
  }
  return byName;
}

// ─── CUSTOM WORKOUTS (CRUD) ──────────────────────────────────────────────────

/**
 * List the user's custom workouts.
 * NOTE: the list/summary view reports sets:0 even for populated workouts — the
 * sets live on the detail object returned by create. sets:0 here is NOT a bug.
 */
export async function listWorkouts(token) {
  const res = await req('GET', '/v6/user-workouts', { token });
  if (!res.ok) throw new Error(`list failed (HTTP ${res.status})`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  return data.workouts || data.data || [];
}

/**
 * Create a custom workout. `spec` is the full body { title, sets: [...] }.
 * Returns the created workout object (includes id).
 * IMPORTANT: HTTP 200 means accepted, NOT instantly visible in the phone app —
 * the device shows it quickly; the app may need a pull-to-refresh. There is no
 * separate publish/finalize step.
 */
export async function createWorkout(token, spec) {
  const res = await req('POST', '/v6/user-workouts', { token, body: spec });
  const text = await res.text();
  if (!res.ok) {
    // Surface the rep-vs-duration 400 message clearly when present.
    throw new Error(`create failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Delete a custom workout by id. Returns true on HTTP 204.
 */
export async function deleteWorkout(token, id) {
  const res = await req('DELETE', `/v6/user-workouts/${id}`, { token });
  if (res.status !== 204 && !res.ok) {
    throw new Error(`delete failed (HTTP ${res.status})`);
  }
  return true;
}

// ─── DATA SYNC (read-down) ───────────────────────────────────────────────────

/**
 * Paginated fetch of all workout-activities for a user.
 */
export async function getAllWorkoutActivities(token, userId) {
  const limit = 100;
  const headers = { 'pg-offset': '0', 'pg-limit': String(limit) };
  const first = await req('GET', `/v6/users/${userId}/workout-activities`, { token, headers });
  if (!first.ok) throw new Error(`workout-activities failed (HTTP ${first.status})`);
  const total = parseInt(first.headers.get('pg-total') || '0', 10);
  let all = await first.json();

  let offset = limit;
  while (offset < total) {
    const batch = await req('GET', `/v6/users/${userId}/workout-activities`, {
      token,
      headers: { 'pg-offset': String(offset), 'pg-limit': String(limit) },
    });
    if (!batch.ok) break;
    all = all.concat(await batch.json());
    offset += limit;
  }
  all.sort((a, b) => (b.beginTime || '').localeCompare(a.beginTime || ''));
  return all;
}

async function getJsonSafe(token, path) {
  try {
    const res = await req('GET', path, { token });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Pull every dataset the read/analyze layer expects.
 * @returns {Promise<Object>} keyed bundle of all synced data.
 */
export async function fetchAll(token, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const [workouts, movements, strengthHistory, readiness, strengthCurrent, distribution, external] =
    await Promise.all([
      getAllWorkoutActivities(token, userId),
      getMovements(token).catch(() => []),
      getJsonSafe(token, `/v6/users/${userId}/strength-scores/history?limit=5000&endDate=${today}`),
      getJsonSafe(token, `/v6/users/${userId}/muscle-readiness/current`),
      getJsonSafe(token, `/v6/users/${userId}/strength-scores/current`),
      getJsonSafe(token, `/v6/users/${userId}/strength-scores/distribution`),
      getJsonSafe(token, `/v6/users/${userId}/external-activities`),
    ]);
  return {
    workouts,
    movements,
    strengthHistory: strengthHistory || [],
    readiness,
    strengthCurrent,
    distribution,
    external,
  };
}
