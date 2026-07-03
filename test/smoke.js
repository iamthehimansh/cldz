'use strict';

// Cross-platform smoke test — exercises cldz without a real `claude`.
// Runs on Linux/macOS/Windows in CI. No test framework, zero deps.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'cldz.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cldz-smoke-'));
const baseEnv = { ...process.env, CLDZ_HOME: home, NO_COLOR: '1' };

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('ok   - ' + name);
  } else {
    console.error('FAIL - ' + name + (detail ? '\n        ' + String(detail).replace(/\n/g, '\n        ') : ''));
    failures++;
  }
}

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...baseEnv, ...(opts.env || {}) },
    input: opts.input,
  });
}

function writeConfig(cfg) {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(cfg));
}

// 1. --version
let r = run(['--version']);
check('--version prints cldz x.y.z', /cldz \d+\.\d+\.\d+/.test(r.stdout), r.stdout + r.stderr);

// 2. --help
r = run(['--help']);
check('--help runs', r.status === 0 && /USAGE/.test(r.stdout), r.stderr);

// 3. --list
writeConfig({ version: 1, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'sk-ant-SMOKE' } } });
r = run(['--list']);
check('--list shows the profile', /k/.test(r.stdout) && /API key/.test(r.stdout), r.stdout + r.stderr);

// 4. --env
r = run(['--env', 'k']);
check('--env emits ANTHROPIC_API_KEY', /ANTHROPIC_API_KEY/.test(r.stdout), r.stdout + r.stderr);
check('--env emits isolated CLAUDE_CONFIG_DIR', /CLAUDE_CONFIG_DIR/.test(r.stdout), r.stdout);

// 5. --doctor (never launches claude)
r = run(['--doctor']);
check('--doctor runs', r.status === 0 && /doctor/i.test(r.stdout), r.stderr);

// 6. --set-default / --remove
run(['--set-default', 'k']);
r = run(['--remove', 'k']);
check('--remove works', r.status === 0 && /Removed/.test(r.stdout), r.stdout + r.stderr);

// 7. launch plumbing — a fake `claude` (cross-platform shim) that echoes env
const fakeJs = path.join(home, 'fakeclaude.js');
fs.writeFileSync(
  fakeJs,
  "console.log('FAKE key=' + (process.env.ANTHROPIC_API_KEY||'') + ' cfg=' + (process.env.CLAUDE_CONFIG_DIR||''));"
);
let shim;
if (process.platform === 'win32') {
  shim = path.join(home, 'fakeclaude.cmd');
  fs.writeFileSync(shim, '@echo off\r\nnode "' + fakeJs + '" %*\r\n');
} else {
  shim = path.join(home, 'fakeclaude.sh');
  fs.writeFileSync(shim, '#!/bin/sh\nexec node "' + fakeJs + '" "$@"\n');
  fs.chmodSync(shim, 0o755);
}
writeConfig({ version: 1, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'sk-ant-LAUNCH' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim } });
check('launch passes ANTHROPIC_API_KEY through to claude', /FAKE key=sk-ant-LAUNCH/.test(r.stdout), r.stdout + r.stderr);
check(
  'launch sets a per-profile isolated CLAUDE_CONFIG_DIR',
  /cfg=.+sessions/.test(r.stdout.replace(/\\/g, '/')),
  r.stdout + r.stderr
);
check('isolated dir was seeded with onboarding flag', fs.existsSync(path.join(home, 'sessions', 'k', '.claude.json')));

// 8. env override wins over stored secret
r = run([], { env: { CLDZ_CLAUDE_BIN: shim, ANTHROPIC_API_KEY: 'sk-ant-FROMENV' } });
check('runtime env var overrides stored secret', /FAKE key=sk-ant-FROMENV/.test(r.stdout), r.stdout + r.stderr);

try {
  fs.rmSync(home, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
