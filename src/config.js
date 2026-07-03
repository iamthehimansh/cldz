'use strict';

const fs = require('node:fs');
const { configDir, configPath } = require('./paths.js');

const CONFIG_VERSION = 1;

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
  if (typeof data.version !== 'number') data.version = CONFIG_VERSION;
  if (!('defaultProfile' in data)) data.defaultProfile = null;
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
  emptyConfig,
  load,
  save,
  profileNames,
  getProfile,
  setDefault,
  removeProfile,
  configPath,
};
