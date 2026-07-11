'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Decode the `exp` (unix seconds) claim from a JWT without verifying it.
function decodeJwtExp(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    return typeof obj.exp === 'number' ? obj.exp : null;
  } catch {
    return null;
  }
}

// Inspect the Codex access token stored in ~/.codex/auth.json.
// Returns { present, hasToken, exp, expired, secondsLeft }.
function codexTokenInfo(home) {
  const base = home || os.homedir();
  const file = path.join(base, '.codex', 'auth.json');
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { present: false };
  }
  const tok = j && j.tokens && j.tokens.access_token;
  if (!tok) return { present: true, hasToken: false };
  const exp = decodeJwtExp(tok);
  if (exp == null) return { present: true, hasToken: true, exp: null };
  const now = Math.floor(Date.now() / 1000);
  return { present: true, hasToken: true, exp, expired: exp <= now, secondsLeft: exp - now };
}

module.exports = { decodeJwtExp, codexTokenInfo };
