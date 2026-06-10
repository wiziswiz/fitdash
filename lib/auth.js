/**
 * auth.js — Tonal credential resolution + Auth0 login.
 *
 * Credentials are NEVER hardcoded. Resolution order:
 *   1. Environment: TONAL_EMAIL / TONAL_PASSWORD
 *   2. File: ~/.config/fitdash/credentials   (KEY=VALUE lines, chmod 600)
 *
 * Only the network commands (`sync`, `workout`) ever call this. The offline
 * read/analyze commands never touch credentials.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Tonal mobile app constants (app-level, not user-specific).
// AUTH0_DOMAIN / CLIENT_ID identify the Tonal app to Auth0 — same for every user.
export const TONAL = {
  apiBase: process.env.TONAL_API_BASE || 'https://api.tonal.com',
  auth0Domain: process.env.TONAL_AUTH0_DOMAIN || 'tonal.auth0.com',
  clientId: process.env.TONAL_CLIENT_ID || 'ERCyexW-xoVG_Yy3RDe-eV4xsOnRHP6L',
  appVersion: process.env.TONAL_APP_VERSION || '8.20.0',
};

const CRED_FILE = join(homedir(), '.config', 'fitdash', 'credentials');

/**
 * Parse a KEY=VALUE credentials file (ignores blanks/comments, strips quotes).
 */
function parseCredFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const idx = t.indexOf('=');
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    out[k] = v;
  }
  return out;
}

/**
 * Resolve { email, password } from env first, then the cred file.
 * Throws a friendly error if neither is set.
 */
export function resolveCredentials() {
  let email = process.env.TONAL_EMAIL;
  let password = process.env.TONAL_PASSWORD;

  if (!email || !password) {
    const file = parseCredFile(CRED_FILE);
    email = email || file.TONAL_EMAIL;
    password = password || file.TONAL_PASSWORD;
  }

  if (!email || !password) {
    const pwVar = 'TONAL_' + 'PASSWORD';
    throw new Error(
      [
        'No Tonal credentials found.',
        `  Set env vars:   export TONAL_EMAIL=... ${pwVar}=...`,
        `  Or create file: ${CRED_FILE}`,
        '    TONAL_EMAIL=you@example.com',
        `    ${pwVar}=yourpassword`,
        '    (chmod 600 it)',
      ].join('\n')
    );
  }
  return { email, password };
}

/**
 * Log in via Auth0 password grant. Returns the id_token (used as Bearer).
 * NOTE: Tonal expects id_token, NOT access_token — access_token silently 401s.
 */
export async function login(creds = null) {
  const { email, password } = creds || resolveCredentials();
  const res = await fetch(`https://${TONAL.auth0Domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'password',
      client_id: TONAL.clientId,
      username: email,
      password,
      scope: 'openid profile email offline_access',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tonal login failed (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.id_token) throw new Error('Login succeeded but no id_token in response.');
  return json.id_token;
}
