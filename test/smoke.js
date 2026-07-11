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

// 15. codex isolated profile shares history with ~/.codex (Phase 2)
const fakeHome2 = path.join(home, 'fakehome2');
fs.mkdirSync(path.join(fakeHome2, '.codex', 'sessions', 'x'), { recursive: true });
fs.writeFileSync(path.join(fakeHome2, '.codex', 'sessions', 'x', 's.jsonl'), 'CODEXMARK');
writeConfig({ version: 1, shareHistory: true, defaultProfile: 'ci', profiles: { ci: { type: 'codexApiKey', openaiKey: 'sk-o', isolate: true } } });
r = run([], { env: { CLDZ_CODEX_BIN: codexShim, HOME: fakeHome2, USERPROFILE: fakeHome2 } });
const codexLinked = path.join(home, 'sessions', 'ci', 'sessions', 'x', 's.jsonl');
check(
  'codex isolated profile shares history with ~/.codex',
  fs.existsSync(codexLinked) && fs.readFileSync(codexLinked, 'utf8') === 'CODEXMARK',
  r.stdout + r.stderr
);

// 16. --current shows the default profile + agent
writeConfig({ version: 1, defaultProfile: 'cx', profiles: { cx: { type: 'codexSubscription' } } });
r = run(['--current']);
check('--current shows active profile + agent', /cx/.test(r.stdout) && /Codex/.test(r.stdout), r.stdout + r.stderr);
r = run(['--whoami']);
check('--whoami is an alias for --current', /cx/.test(r.stdout), r.stdout + r.stderr);

// 17. --list --json emits valid JSON with the profile fields
writeConfig({ version: 1, defaultProfile: 'a', shareHistory: true, profiles: { a: { type: 'subscription' }, b: { type: 'codexApiKey', openaiKey: 'x' } } });
r = run(['--list', '--json']);
let parsed = null;
try { parsed = JSON.parse(r.stdout); } catch { /* stays null */ }
check(
  '--list --json emits valid JSON',
  parsed && Array.isArray(parsed.profiles) && parsed.profiles.length === 2 &&
    parsed.defaultProfile === 'a' && parsed.shareHistory === true &&
    parsed.profiles.find((p) => p.name === 'b').agent === 'codex',
  r.stdout + r.stderr
);

// 18. --use sets the default profile
writeConfig({ version: 1, defaultProfile: 'a', profiles: { a: { type: 'subscription' }, b: { type: 'subscription' } } });
run(['--use', 'b']);
const after = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check('--use sets the default profile', after.defaultProfile === 'b', JSON.stringify(after));

// 19. first-run auto-imports a detected credential ($ANTHROPIC_API_KEY)
const importHome = path.join(home, 'importhome');
fs.mkdirSync(importHome, { recursive: true });
fs.rmSync(path.join(home, 'config.json'), { force: true });
r = run([], {
  input: 'y\n',
  env: {
    CLDZ_CLAUDE_BIN: shim,
    HOME: importHome,
    USERPROFILE: importHome,
    ANTHROPIC_API_KEY: 'sk-ant-IMPORT',
    OPENAI_API_KEY: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
  },
});
let cfgAfter = null;
try { cfgAfter = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch { /* null */ }
check(
  'first-run imports detected $ANTHROPIC_API_KEY as an apiKey profile',
  cfgAfter && Object.values(cfgAfter.profiles).some((p) => p.type === 'apiKey'),
  r.stdout + r.stderr
);

// 20. per-profile default args are prepended (and user args appended)
writeConfig({ version: 1, defaultProfile: 'm', profiles: { m: { type: 'apiKey', apiKey: 'k', args: ['--model', 'opus'] } } });
r = run(['hi'], { env: { CLDZ_CLAUDE_BIN: shim } });
check('per-profile default args are passed before user args', /args=--model\|opus\|hi/.test(r.stdout), r.stdout + r.stderr);

// 21. --print-env emits raw unmasked exports for eval
writeConfig({ version: 1, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'sk-ant-RAWVALUE' } } });
r = run(['--print-env', 'k']);
check(
  '--print-env emits raw unmasked export lines',
  /export ANTHROPIC_API_KEY='sk-ant-RAWVALUE'/.test(r.stdout) && /export CLAUDE_CONFIG_DIR=/.test(r.stdout),
  r.stdout + r.stderr
);

// 22. --agent codex launches codex ad-hoc without any profile
fs.rmSync(path.join(home, 'config.json'), { force: true });
r = run(['--agent', 'codex', '--version'], { env: { CLDZ_CODEX_BIN: codexShim, HOME: importHome, USERPROFILE: importHome } });
check('--agent codex launches codex ad-hoc (no profile needed)', /^CODEX /m.test(r.stdout), r.stdout + r.stderr);

// 23. --agent claude launches claude ad-hoc on ambient login (no token injected)
r = run(['--agent', 'claude'], { env: { CLDZ_CLAUDE_BIN: shim, HOME: importHome, USERPROFILE: importHome, ANTHROPIC_API_KEY: '' } });
check('--agent claude launches claude ad-hoc (no token, no isolation)', /FAKE key= cfg= /.test(r.stdout), r.stdout + r.stderr);

// 24. codex token expiry: a valid JWT is reported healthy, expired one warns (doctor)
function fakeJwt(expSec) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSec })}.sig`;
}
const codexHome = path.join(home, 'codexhome');
fs.mkdirSync(path.join(codexHome, '.codex'), { recursive: true });
const nowSec = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(codexHome, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: fakeJwt(nowSec + 3600) } }));
r = run(['--doctor'], { env: { HOME: codexHome, USERPROFILE: codexHome } });
check('doctor reports a valid codex token', /Codex access token valid/.test(r.stdout), r.stdout + r.stderr);
fs.writeFileSync(path.join(codexHome, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: fakeJwt(nowSec - 60) } }));
r = run(['--doctor'], { env: { HOME: codexHome, USERPROFILE: codexHome } });
check('doctor warns on an expired codex token', /Codex access token is expired/.test(r.stdout), r.stdout + r.stderr);

// 25. --add creates a profile non-interactively (with --set and --args)
fs.rmSync(path.join(home, 'config.json'), { force: true });
r = run(['--add', 'work', '--type', 'apiKey', '--set', 'apiKey=sk-ant-ADD', '--args', '--model opus']);
let addCfg = null;
try { addCfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch { /* null */ }
check(
  '--add creates a profile with fields, args, and sets it default',
  addCfg && addCfg.profiles.work && addCfg.profiles.work.type === 'apiKey' &&
    addCfg.profiles.work.apiKey === 'sk-ant-ADD' &&
    JSON.stringify(addCfg.profiles.work.args) === JSON.stringify(['--model', 'opus']) &&
    addCfg.defaultProfile === 'work',
  r.stdout + r.stderr
);

// 26. --add rejects an unknown type and a duplicate name
r = run(['--add', 'x', '--type', 'nope']);
check('--add rejects an unknown --type', r.status !== 0 && /type must be one of/.test(r.stderr), r.stdout + r.stderr);
r = run(['--add', 'work', '--type', 'subscription']);
check('--add rejects a duplicate name', r.status !== 0 && /already exists/.test(r.stderr), r.stdout + r.stderr);

// 27. --rename renames a profile and moves the default pointer
r = run(['--rename', 'work', 'main']);
const renamed = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check(
  '--rename moves the profile and default pointer',
  renamed.profiles.main && !renamed.profiles.work && renamed.defaultProfile === 'main',
  r.stdout + r.stderr
);

// 28. --edit updates fields, --set, --unset, --args
writeConfig({ version: 1, defaultProfile: 'm', profiles: { m: { type: 'apiKey', apiKey: 'old', args: ['--x'] } } });
run(['--edit', 'm', '--set', 'apiKey=new', '--unset', 'args', '--type', 'oauth', '--set', 'oauthToken=tok']);
const edited = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).profiles.m;
check(
  '--edit applies --type/--set/--unset',
  edited.type === 'oauth' && edited.apiKey === 'new' && edited.oauthToken === 'tok' && edited.args === undefined,
  JSON.stringify(edited)
);
r = run(['--edit', 'nope', '--set', 'x=1']);
check('--edit rejects an unknown profile', r.status !== 0 && /not found/.test(r.stderr), r.stdout + r.stderr);

// 29. --current --json emits machine-readable active profile
writeConfig({ version: 1, defaultProfile: 'cx', shareHistory: true, profiles: { cx: { type: 'codexSubscription' } } });
r = run(['--current', '--json']);
let curJson = null;
try { curJson = JSON.parse(r.stdout); } catch { /* null */ }
check(
  '--current --json emits the active profile as JSON',
  curJson && curJson.profile === 'cx' && curJson.agent === 'codex' && curJson.shareHistory === true,
  r.stdout + r.stderr
);

// 30. --version --all prints cldz + agent versions
r = run(['--version', '--all'], { env: { CLDZ_CLAUDE_BIN: shim, CLDZ_CODEX_BIN: codexShim } });
check(
  '--version --all prints cldz and both agents',
  /cldz \d+\.\d+\.\d+/.test(r.stdout) && /Claude Code:/.test(r.stdout) && /Codex:/.test(r.stdout),
  r.stdout + r.stderr
);

// 31. --dry-run prints the plan without launching (no FAKE/CODEX output)
writeConfig({ version: 1, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'sk-ant-DRY', args: ['--model', 'opus'] } } });
r = run(['--dry-run', 'hello'], { env: { CLDZ_CLAUDE_BIN: shim } });
check(
  '--dry-run prints the launch plan and does not launch',
  /agent:\s+Claude Code/.test(r.stdout) && /command:.*--model opus hello/.test(r.stdout) && !/FAKE/.test(r.stdout),
  r.stdout + r.stderr
);
check('--dry-run masks secret env values', /ANTHROPIC_API_KEY=/.test(r.stdout) && !r.stdout.includes('sk-ant-DRY'), r.stdout + r.stderr);

// 32. doctor reports per-profile credential readiness
writeConfig({ version: 1, defaultProfile: 'ready', profiles: { ready: { type: 'apiKey', apiKey: 'k' }, missing: { type: 'oauth' } } });
r = run(['--doctor'], { env: { HOME: importHome, USERPROFILE: importHome, ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: '' } });
check(
  'doctor shows per-profile credential readiness',
  /ready: credentials resolve/.test(r.stdout) && /missing: missing \$CLAUDE_CODE_OAUTH_TOKEN/.test(r.stdout),
  r.stdout + r.stderr
);

try {
  fs.rmSync(home, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
