'use strict';

const os = require('node:os');
const path = require('node:path');

// Resolve the cldz home directory in a cross-platform way.
// Override with CLDZ_HOME for tests / custom locations.
// - macOS / Linux:  ~/.cldz
// - Windows:        C:\Users\<you>\.cldz   (os.homedir() -> %USERPROFILE%)
function configDir() {
  if (process.env.CLDZ_HOME && process.env.CLDZ_HOME.trim()) {
    return process.env.CLDZ_HOME;
  }
  return path.join(os.homedir(), '.cldz');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

module.exports = { configDir, configPath };
