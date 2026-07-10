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
  "console.log('FAKE key=' + (process.env.ANTHROPIC_API_KEY||'') + ' cfg=' + (process.env.CLAUDE_CONFIG_DIR||'') + ' oai=' + (process.env.OPENAI_API_KEY||'') + ' args=' + process.argv.slice(2).join('|'));"
);
// A distinct fake for the codex agent so we can prove the right binary launches.
const codexJs = path.join(home, 'fakecodex.js');
fs.writeFileSync(
  codexJs,
  "console.log('CODEX oai=' + (process.env.OPENAI_API_KEY||'') + ' home=' + (process.env.CODEX_HOME||'') + ' args=' + process.argv.slice(2).join('|'));"
);
function makeShim(base, js) {
  if (process.platform === 'win32') {
    const s = path.join(home, base + '.cmd');
    fs.writeFileSync(s, '@echo off\r\nnode "' + js + '" %*\r\n');
    return s;
  }
  const s = path.join(home, base + '.sh');
  fs.writeFileSync(s, '#!/bin/sh\nexec node "' + js + '" "$@"\n');
  fs.chmodSync(s, 0o755);
  return s;
}
const shim = makeShim('fakeclaude', fakeJs);
const codexShim = makeShim('fakecodex', codexJs);
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

// 9. shared history links the main ~/.claude projects into an isolated profile
//    (also exercises the Windows directory-junction path in CI)
const fakeHome = path.join(home, 'fakehome');
fs.mkdirSync(path.join(fakeHome, '.claude', 'projects', 'proj'), { recursive: true });
fs.writeFileSync(path.join(fakeHome, '.claude', 'projects', 'proj', 's.jsonl'), 'MARK');
writeConfig({ version: 1, shareHistory: true, defaultProfile: 's', profiles: { s: { type: 'apiKey', apiKey: 'sk-ant-SHARE' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim, HOME: fakeHome, USERPROFILE: fakeHome } });
const linked = path.join(home, 'sessions', 's', 'projects', 'proj', 's.jsonl');
check(
  'shared history exposes main ~/.claude sessions to the profile',
  fs.existsSync(linked) && fs.readFileSync(linked, 'utf8') === 'MARK',
  r.stdout + r.stderr
);

// 10. skipPermissions auto-adds the flag, and never duplicates it
writeConfig({ version: 1, skipPermissions: true, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'sk-ant-SKIP' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim } });
check('skipPermissions adds --dangerously-skip-permissions', /args=[^\n]*--dangerously-skip-permissions/.test(r.stdout), r.stdout + r.stderr);
r = run(['--dangerously-skip-permissions'], { env: { CLDZ_CLAUDE_BIN: shim } });
check(
  'does not duplicate the flag when already passed',
  (r.stdout.match(/--dangerously-skip-permissions/g) || []).length === 1,
  r.stdout + r.stderr
);

// 11. subscription profile: no token injected, not isolated (shared login)
writeConfig({ version: 1, defaultProfile: 'sub', profiles: { sub: { type: 'subscription' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim } });
check(
  'subscription profile injects no token and shares the login (no CLAUDE_CONFIG_DIR)',
  /FAKE key= cfg= /.test(r.stdout),
  r.stdout + r.stderr
);

// 12. codex profile launches the codex binary, not claude
writeConfig({ version: 1, defaultProfile: 'cx', profiles: { cx: { type: 'codexSubscription' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim, CLDZ_CODEX_BIN: codexShim } });
check('codex subscription profile launches the codex binary', /^CODEX /m.test(r.stdout), r.stdout + r.stderr);

// 13. codex API key profile sets OPENAI_API_KEY for codex
writeConfig({ version: 1, defaultProfile: 'ck', profiles: { ck: { type: 'codexApiKey', openaiKey: 'sk-openai-TEST' } } });
r = run([], { env: { CLDZ_CODEX_BIN: codexShim } });
check('codex apiKey profile sets OPENAI_API_KEY', /CODEX oai=sk-openai-TEST/.test(r.stdout), r.stdout + r.stderr);

// 14. skip-permissions does NOT apply to codex (claude-only flag)
writeConfig({ version: 1, skipPermissions: true, defaultProfile: 'cx', profiles: { cx: { type: 'codexSubscription' } } });
r = run([], { env: { CLDZ_CODEX_BIN: codexShim } });
check('skip-permissions is not injected for codex', !/--dangerously-skip-permissions/.test(r.stdout), r.stdout + r.stderr);

try {
  fs.rmSync(home, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
