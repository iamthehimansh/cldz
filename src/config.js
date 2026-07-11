'use strict';

const fs = require('node:fs');
const { configDir, configPath } = require('./paths.js');

const CONFIG_VERSION = 2;

// Stepwise migrations keyed by the version they upgrade FROM. Each returns the
// migrated object with `version` bumped. Keep them additive and lossless.
const MIGRATIONS = {
  // 1 -> 2: no structural change (subscription/agent/args fields are all
  // additive and back-compatible). Just stamp the new version.
  1: (d) => {
    d.version = 2;
    return d;
  },
};

// Bring a parsed config up to CONFIG_VERSION without losing unknown keys. A
// config from a newer cldz (version > ours) is left untouched (forward-compat).
function migrate(data) {
  if (typeof data.version === 'number' && data.version > CONFIG_VERSION) return data;
  let v = typeof data.version === 'number' ? data.version : 1;
  while (v < CONFIG_VERSION && MIGRATIONS[v]) {
    data = MIGRATIONS[v](data);
    v = typeof data.version === 'number' ? data.version : v + 1;
  }
  data.version = v < CONFIG_VERSION ? CONFIG_VERSION : data.version;
  return data;
}

function emptyConfig() {
  return { version: CONFIG_VERSION, defaultProfile: null, profiles: {} };
}

function load() {
  const file = configPath();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyConfig();
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config file at ${file} is not valid JSON (${err.message}). Fix or delete it.`);
  }
  if (!data || typeof data !== 'object') return emptyConfig();
  if (!data.profiles || typeof data.profiles !== 'object') data.profiles = {};
  if (!('defaultProfile' in data)) data.defaultProfile = null;
  // Normalize/upgrade the schema (preserves unknown keys — no data loss).
  data = migrate(data);
  return data;
}

function save(data) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = configPath();
  // Write with restrictive perms (0600) since it may hold plaintext secrets.
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
  }
  return file;
}

function profileNames(data) {
  return Object.keys(data.profiles);
}

function getProfile(data, name) {
  return data.profiles[name] || null;
}

function setDefault(data, name) {
  data.defaultProfile = name;
}

function removeProfile(data, name) {
  delete data.profiles[name];
  if (data.defaultProfile === name) {
    const remaining = profileNames(data);
    data.defaultProfile = remaining.length ? remaining[0] : null;
  }
}

module.exports = {
  CONFIG_VERSION,
  migrate,
  emptyConfig,
  load,
  save,
  profileNames,
  getProfile,
  setDefault,
  removeProfile,
  configPath,
};
