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
fs.writeFileSync(path.join(fakeHome2, '.codex', 'session_index.jsonl'), '{"id":"x","thread_name":"t"}\n');
writeConfig({ version: 1, shareHistory: true, defaultProfile: 'ci', profiles: { ci: { type: 'codexApiKey', openaiKey: 'sk-o', isolate: true } } });
r = run([], { env: { CLDZ_CODEX_BIN: codexShim, HOME: fakeHome2, USERPROFILE: fakeHome2 } });
const codexLinked = path.join(home, 'sessions', 'ci', 'sessions', 'x', 's.jsonl');
const codexIndex = path.join(home, 'sessions', 'ci', 'session_index.jsonl');
check(
  'codex isolated profile shares transcripts AND the resume index with ~/.codex',
  fs.existsSync(codexLinked) && fs.readFileSync(codexLinked, 'utf8') === 'CODEXMARK' &&
    fs.existsSync(codexIndex) && fs.readFileSync(codexIndex, 'utf8').includes('thread_name'),
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

// 33. config migration: a legacy config (no version + unknown key) upgrades
//     losslessly and stamps the current version on the next save
fs.writeFileSync(
  path.join(home, 'config.json'),
  JSON.stringify({ profiles: { work: { type: 'apiKey', apiKey: 'k' } }, weirdLegacyKey: 123 })
);
run(['--add', 'extra', '--type', 'subscription']); // triggers load -> migrate -> save
const migrated = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check(
  'legacy config migrates losslessly and stamps version >= 2',
  migrated.version >= 2 &&
    migrated.profiles.work && migrated.profiles.work.apiKey === 'k' &&
    migrated.profiles.extra &&
    migrated.weirdLegacyKey === 123,
  JSON.stringify(migrated)
);

// 34. forward-compat: a newer-version config is not downgraded or corrupted
fs.writeFileSync(
  path.join(home, 'config.json'),
  JSON.stringify({ version: 999, defaultProfile: 'a', profiles: { a: { type: 'subscription' } } })
);
r = run(['--list', '--json']);
let fwd = null;
try { fwd = JSON.parse(r.stdout); } catch { /* null */ }
check(
  'a future-version config still loads without corruption',
  r.status === 0 && fwd && fwd.profiles.length === 1 && fwd.defaultProfile === 'a',
  r.stdout + r.stderr
);

// 35. shell completion scripts print for each shell; bad shell errors
for (const sh of ['bash', 'zsh', 'fish']) {
  r = run(['--completion', sh]);
  check(`--completion ${sh} prints a completion script`, r.status === 0 && /cldz/.test(r.stdout) && r.stdout.length > 50, r.stdout + r.stderr);
}
r = run(['--completion', 'nope']);
check('--completion rejects an unknown shell', r.status !== 0 && /bash\|zsh\|fish/.test(r.stderr), r.stdout + r.stderr);
// completion must cover the newer flags (keeps it in sync with the CLI)
r = run(['--completion', 'bash']);
const covers = ['--export', '--import', '--path', '--dry-run', '--desc', '--current', '--agent'].every((f) => r.stdout.includes(f));
check('--completion covers the newer flags', covers, r.stdout);

// 36. --profile-names lists profile names (used by completion)
writeConfig({ version: 2, defaultProfile: 'a', profiles: { a: { type: 'subscription' }, b: { type: 'subscription' } } });
r = run(['--profile-names']);
check('--profile-names lists names one per line', r.stdout.trim().split('\n').sort().join(',') === 'a,b', r.stdout + r.stderr);

// 37. --export omits secrets by default; --with-secrets includes them
writeConfig({ version: 2, defaultProfile: 'k', shareHistory: true, profiles: { k: { type: 'apiKey', apiKey: 'sk-ant-SECRET', args: ['--model', 'opus'] } } });
r = run(['--export']);
let exp = null;
try { exp = JSON.parse(r.stdout); } catch { /* null */ }
check(
  '--export omits secrets but keeps non-secret fields',
  exp && exp.profiles.k && exp.profiles.k.apiKey === undefined &&
    JSON.stringify(exp.profiles.k.args) === JSON.stringify(['--model', 'opus']) &&
    exp.shareHistory === true,
  r.stdout + r.stderr
);
r = run(['--export', '--with-secrets']);
let expS = null;
try { expS = JSON.parse(r.stdout); } catch { /* null */ }
check('--export --with-secrets includes the secret', expS && expS.profiles.k.apiKey === 'sk-ant-SECRET', r.stdout + r.stderr);

// 38. --import merges profiles (skips existing without --force, replaces with)
const impFile = path.join(home, 'backup.json');
fs.writeFileSync(impFile, JSON.stringify({ version: 2, defaultProfile: 'new1', profiles: { k: { type: 'subscription' }, new1: { type: 'codexSubscription' } } }));
writeConfig({ version: 2, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'keep' } } });
r = run(['--import', impFile]);
let afterImp = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check(
  '--import adds new profiles and skips existing without --force',
  afterImp.profiles.new1 && afterImp.profiles.k.apiKey === 'keep' && /1 added, 0 replaced, 1 skipped/.test(r.stdout),
  r.stdout + r.stderr
);
r = run(['--import', impFile, '--force']);
afterImp = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check('--import --force overwrites existing profiles', afterImp.profiles.k.type === 'subscription' && afterImp.profiles.k.apiKey === undefined, r.stdout + r.stderr);

// 39. round-trip: export --with-secrets then import into a fresh config restores it
writeConfig({ version: 2, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'sk-rt' } } });
const rtFile = path.join(home, 'rt.json');
run(['--export', rtFile, '--with-secrets']);
fs.rmSync(path.join(home, 'config.json'), { force: true });
run(['--import', rtFile]);
const rt = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check('export --with-secrets round-trips through import', rt.profiles.k && rt.profiles.k.apiKey === 'sk-rt' && rt.defaultProfile === 'k', JSON.stringify(rt));

// 40. per-profile description via --desc, shown in --list and --current --json
fs.rmSync(path.join(home, 'config.json'), { force: true });
run(['--add', 'work', '--type', 'subscription', '--desc', 'my main account']);
const withDesc = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
check('--desc stores a profile description', withDesc.profiles.work.description === 'my main account', JSON.stringify(withDesc));
r = run(['--list']);
check('--list shows the description', /my main account/.test(r.stdout), r.stdout + r.stderr);
r = run(['--current', '--json']);
check('--current --json includes description', JSON.parse(r.stdout).description === 'my main account', r.stdout + r.stderr);
run(['--edit', 'work', '--desc', 'renamed note']);
check('--edit --desc updates the description', JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).profiles.work.description === 'renamed note');

// 41. --path prints the config file path
r = run(['--path']);
check('--path prints the config file path', r.stdout.trim() === path.join(home, 'config.json'), r.stdout + r.stderr);

// 42. CLDZ_NO_ISOLATION forces no isolation even for an isolating type
writeConfig({ version: 2, defaultProfile: 'k', profiles: { k: { type: 'apiKey', apiKey: 'k' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim, CLDZ_NO_ISOLATION: '1' } });
check('CLDZ_NO_ISOLATION disables the isolated config dir', /FAKE key=k cfg= /.test(r.stdout), r.stdout + r.stderr);
r = run(['--current', '--json'], { env: { CLDZ_NO_ISOLATION: '1' } });
check('CLDZ_NO_ISOLATION reflected in --current --json', JSON.parse(r.stdout).isolated === false, r.stdout + r.stderr);

// 43. every read-only command exits 0 on an empty config (no crashes)
const emptyHome = path.join(home, 'emptyhome');
fs.mkdirSync(emptyHome, { recursive: true });
const roCmds = [
  ['--help'], ['--version'], ['--version', '--all'], ['--list'], ['--list', '--json'],
  ['--current'], ['--current', '--json'], ['--doctor'], ['--path'], ['--export'],
  ['--completion', 'bash'], ['--profile-names'],
];
let roOk = true;
let roBad = '';
for (const cmd of roCmds) {
  const rr = run(cmd, { env: { CLDZ_HOME: emptyHome, HOME: emptyHome, USERPROFILE: emptyHome } });
  if (rr.status !== 0) {
    roOk = false;
    roBad = cmd.join(' ') + ' -> exit ' + rr.status + ' ' + (rr.stderr || '').trim();
    break;
  }
}
check('all read-only commands exit 0 on an empty config', roOk, roBad);

// 44. --config "Save & exit" exits cleanly instead of hanging on stdin
writeConfig({ version: 2, defaultProfile: 'a', profiles: { a: { type: 'subscription' } } });
const cfgRun = spawnSync(process.execPath, [CLI, '--config'], {
  encoding: 'utf8',
  env: baseEnv,
  input: '8\n', // "Save & exit" is menu option 8
  timeout: 8000,
});
check('--config exits cleanly on Save & exit (no hang)', cfgRun.status === 0 && !cfgRun.signal, 'status=' + cfgRun.status + ' signal=' + cfgRun.signal);

// 45. unified `api` type — provider × agent matrix
const swJs = path.join(home, 'fakesw.js');
fs.writeFileSync(swJs, "console.log('SW ' + process.argv.slice(2).join('|'));");
const swShim = makeShim('fakesw', swJs);

// native anthropic + claude
writeConfig({ version: 2, defaultProfile: 'a', profiles: { a: { type: 'api', provider: 'anthropic', apiKey: 'sk-ant-A', agent: 'claude' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim } });
check('api native (anthropic+claude) sets ANTHROPIC_API_KEY on claude', /FAKE key=sk-ant-A/.test(r.stdout), r.stdout + r.stderr);

// native openai + codex
writeConfig({ version: 2, defaultProfile: 'o', profiles: { o: { type: 'api', provider: 'openai', apiKey: 'sk-oai-O', agent: 'codex' } } });
r = run([], { env: { CLDZ_CODEX_BIN: codexShim } });
check('api native (openai+codex) sets OPENAI_API_KEY on codex', /CODEX oai=sk-oai-O/.test(r.stdout), r.stdout + r.stderr);

// cross openai -> claude via Switchyard, using -P + --agent override
writeConfig({ version: 2, defaultProfile: 'o', profiles: { o: { type: 'api', provider: 'openai', apiKey: 'sk-oai-X', agent: 'codex', model: 'gpt-4o' } } });
r = run(['-P', 'o', '--agent', 'claude'], { env: { CLDZ_SWITCHYARD_BIN: swShim } });
check(
  'api cross (openai->claude) runs `switchyard launch claude` with the OpenAI backend',
  /SW launch\|claude\|--base-url\|https:\/\/api\.openai\.com\/v1/.test(r.stdout) && r.stdout.includes('gpt-4o'),
  r.stdout + r.stderr
);

// cross without a model errors helpfully
writeConfig({ version: 2, defaultProfile: 'a', profiles: { a: { type: 'api', provider: 'anthropic', apiKey: 'sk-ant-A', agent: 'claude' } } });
r = run(['-P', 'a', '--agent', 'codex'], { env: { CLDZ_SWITCHYARD_BIN: swShim } });
check('api cross without a model errors helpfully', r.status !== 0 && /needs a model/.test(r.stderr), r.stdout + r.stderr);

// api key read from env when not stored
writeConfig({ version: 2, defaultProfile: 'a', profiles: { a: { type: 'api', provider: 'anthropic', agent: 'claude' } } });
r = run([], { env: { CLDZ_CLAUDE_BIN: shim, ANTHROPIC_API_KEY: 'sk-ant-FROMENV2' } });
check('api reads the key from env when not stored', /FAKE key=sk-ant-FROMENV2/.test(r.stdout), r.stdout + r.stderr);

// 46. multiple isolated Codex accounts get their own CODEX_HOME (like Claude)
writeConfig({
  version: 2,
  defaultProfile: 'a',
  profiles: {
    a: { type: 'codexSubscription', isolate: true },
    b: { type: 'codexSubscription', isolate: true },
  },
});
r = run(['-P', 'a'], { env: { CLDZ_CODEX_BIN: codexShim } });
check('isolated codex account A gets its own CODEX_HOME', r.stdout.includes(path.join('sessions', 'a')), r.stdout + r.stderr);
r = run(['-P', 'b'], { env: { CLDZ_CODEX_BIN: codexShim } });
check('isolated codex account B gets a different CODEX_HOME', r.stdout.includes(path.join('sessions', 'b')), r.stdout + r.stderr);

// 47. an isolated SUBSCRIPTION profile is not onboarding-seeded (so the new
//     account's login screen actually shows), unlike an isolated token profile
writeConfig({ version: 2, defaultProfile: 'subacct', profiles: { subacct: { type: 'subscription', isolate: true } } });
run(['-P', 'subacct'], { env: { CLDZ_CLAUDE_BIN: shim, HOME: importHome, USERPROFILE: importHome } });
check(
  'isolated subscription profile is NOT onboarding-seeded (login shows for the new account)',
  !fs.existsSync(path.join(home, 'sessions', 'subacct', '.claude.json')),
  'seed file unexpectedly present'
);

// 48. --login runs the agent's native login in the profile's own dir
writeConfig({ version: 2, defaultProfile: 'wc', profiles: { wc: { type: 'codexSubscription', isolate: true } } });
r = run(['--login', '-P', 'wc'], { env: { CLDZ_CODEX_BIN: codexShim } });
check(
  '--login runs `codex login` with the profile isolated CODEX_HOME',
  /args=login/.test(r.stdout) && r.stdout.includes(path.join('sessions', 'wc')),
  r.stdout + r.stderr
);

// 49. --login --with-access-token uses codex's official token-login flag
r = run(['--login', '-P', 'wc', '--with-access-token'], { env: { CLDZ_CODEX_BIN: codexShim } });
check('--login --with-access-token invokes codex official flag', /args=login\|--with-access-token/.test(r.stdout), r.stdout + r.stderr);

// 50. --login --auth-json seeds the isolated profile's own codex auth.json
r = run(['--login', '-P', 'wc', '--auth-json'], { input: '{"tokens":{"access_token":"AT","refresh_token":"RT","account_id":"ID"}}' });
const seeded = path.join(home, 'sessions', 'wc', 'auth.json');
check(
  '--login --auth-json seeds codex auth.json (with refresh_token)',
  fs.existsSync(seeded) && JSON.parse(fs.readFileSync(seeded, 'utf8')).tokens.refresh_token === 'RT',
  r.stdout + r.stderr
);

// 51. --auth-json refuses a shared (non-isolated) profile so ~/.codex is safe
writeConfig({ version: 2, defaultProfile: 'sh', profiles: { sh: { type: 'codexSubscription' } } });
r = run(['--login', '-P', 'sh', '--auth-json'], { input: '{"tokens":{"access_token":"x"}}' });
check('--auth-json refuses a shared profile (protects ~/.codex)', r.status !== 0 && /ISOLATED profile/.test(r.stderr), r.stdout + r.stderr);

// cldz must NOT store the pasted tokens in its own config
const cfgTxt = fs.readFileSync(path.join(home, 'config.json'), 'utf8');
check('cldz config never stores the pasted tokens', !cfgTxt.includes('RT') && !cfgTxt.includes('access_token'), cfgTxt);

// 52. `cldz --config` offers codex sign-in; pasted auth.json lands in the profile
//     dir (not cldz config). Drives: Add(1) → codexSubscription(8) → separate(y) →
//     args(blank) → name → sign-in menu → auth.json(3) → JSON → Save&exit(8).
{
  const cfgHome = path.join(home, 'cfgsignin');
  fs.mkdirSync(cfgHome, { recursive: true });
  const authLine = '{"auth_mode":"chatgpt","tokens":{"access_token":"AAA","refresh_token":"RRR","account_id":"ID"}}';
  const input = ['1', '8', 'y', '', 'cxacct', '3', authLine, '8', ''].join('\n');
  const rr = spawnSync(process.execPath, [CLI, '--config'], {
    encoding: 'utf8',
    env: { ...baseEnv, CLDZ_HOME: cfgHome, CLDZ_CODEX_BIN: '/bin/true' },
    input,
    timeout: 10000,
  });
  const seededFile = path.join(cfgHome, 'sessions', 'cxacct', 'auth.json');
  const cfg = fs.existsSync(path.join(cfgHome, 'config.json')) ? fs.readFileSync(path.join(cfgHome, 'config.json'), 'utf8') : '';
  check(
    '--config codex sign-in seeds auth.json in the profile dir (not cldz config)',
    fs.existsSync(seededFile) &&
      JSON.parse(fs.readFileSync(seededFile, 'utf8')).tokens.refresh_token === 'RRR' &&
      !cfg.includes('RRR'),
    (rr.stdout || '') + (rr.stderr || ''),
  );
}

// 53. a multi-line paste into `--config` must NOT cascade into profile creation:
//     select() bails after a burst of invalid input instead of defaulting.
{
  const pg = path.join(home, 'pasteguard');
  fs.mkdirSync(pg, { recursive: true });
  fs.writeFileSync(path.join(pg, 'config.json'), JSON.stringify({ version: 2, defaultProfile: 'r', profiles: { r: { type: 'subscription' } } }));
  const blob = ['garbage line', 'ACCESS_TOKEN=$(jq ...)', 'more text', 'not a number', 'blah', 'zzz', 'nope'].join('\n') + '\n';
  const rr = spawnSync(process.execPath, [CLI, '--config'], { encoding: 'utf8', env: { ...baseEnv, CLDZ_HOME: pg }, input: blob, timeout: 10000 });
  const cfg = JSON.parse(fs.readFileSync(path.join(pg, 'config.json'), 'utf8'));
  check(
    '--config does not flood profiles on a multi-line paste (select bails on invalid burst)',
    Object.keys(cfg.profiles).length === 1 && rr.status === 0 && !rr.signal,
    'profiles=' + Object.keys(cfg.profiles).length + ' status=' + rr.status + ' signal=' + rr.signal,
  );
}

try {
  fs.rmSync(home, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
