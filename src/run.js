'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { typeDef, buildEnv, agentOf } = require('./auth.js');
const { agentDef, AGENTS } = require('./agents.js');
const { codexTokenInfo } = require('./codextoken.js');
const config = require('./config.js');
const { configDir } = require('./paths.js');
const wizard = require('./wizard.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

// Effective isolation for a profile: CLDZ_NO_ISOLATION forces it off, then an
// explicit flag wins, else the type default (subscription-style types share the
// ambient login, everything else isolates).
function isIsolated(stored) {
  if (process.env.CLDZ_NO_ISOLATION) return false;
  if (stored.isolate !== undefined) return stored.isolate;
  return typeDef(stored.type).defaultIsolate !== false;
}

// Non-interactive check of whether a profile's required credentials resolve
// (from config or the current environment). Subscription types are always ready.
function profileReadiness(stored) {
  if (stored.type === 'api') {
    const keyEnv = stored.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const has = (process.env[keyEnv] && process.env[keyEnv] !== '') || (stored.apiKey && stored.apiKey !== '');
    return { ready: Boolean(has), missing: has ? [] : ['$' + keyEnv] };
  }
  const def = typeDef(stored.type);
  const missing = [];
  for (const field of def.fields) {
    if (field.optional) continue;
    const envVal = process.env[field.env];
    const has =
      (envVal !== undefined && envVal !== '') ||
      (stored[field.key] !== undefined && stored[field.key] !== '');
    if (!has) missing.push('$' + field.env);
  }
  return { ready: missing.length === 0, missing };
}

function maskValue(v) {
  const s = String(v);
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

// Where an isolated profile keeps its own Claude Code config/credentials.
function sessionDir(name, stored) {
  return stored.configDir || path.join(configDir(), 'sessions', name);
}

// A brand-new config dir makes Claude Code run first-time onboarding (the
// "Select login method" screen) instead of using the injected credential. Seed
// the onboarding-complete flag so an isolated profile drops straight into
// Claude, authenticated by its token. Only runs on the very first launch (before
// claude has written its own .claude.json).
function seedOnboarding(dir) {
  const cfgFile = path.join(dir, '.claude.json');
  if (fs.existsSync(cfgFile)) return; // already initialized by claude
  const seed = { hasCompletedOnboarding: true };
  try {
    const home = path.join(os.homedir(), '.claude.json');
    const j = JSON.parse(fs.readFileSync(home, 'utf8'));
    if (j.lastOnboardingVersion) seed.lastOnboardingVersion = j.lastOnboardingVersion;
  } catch {
    /* no global config to borrow the version from — the flag alone suffices */
  }
  try {
    fs.writeFileSync(cfgFile, JSON.stringify(seed, null, 2), { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

function agentHomeDir(agent) {
  return path.join(os.homedir(), agentDef(agent).homeDir);
}

function symlinkCompat(target, link, file) {
  if (!file) {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return;
  }
  if (process.platform === 'win32') {
    try {
      fs.symlinkSync(target, link, 'file');
    } catch {
      try {
        fs.linkSync(target, link); // hard link — no privilege needed on Windows
      } catch {
        /* give up on the file link */
      }
    }
    return;
  }
  fs.symlinkSync(target, link, 'file');
}

function migrateInto(link, target, file) {
  if (file) {
    try {
      fs.appendFileSync(target, fs.readFileSync(link));
    } catch {
      /* ignore */
    }
    fs.rmSync(link, { force: true });
    return;
  }
  try {
    for (const child of fs.readdirSync(link)) {
      const to = path.join(target, child);
      if (!fs.existsSync(to)) {
        try {
          fs.renameSync(path.join(link, child), to);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  fs.rmSync(link, { recursive: true, force: true });
}

// Point an isolated dir's history entries at the shared agent-home ones (~/.claude
// or ~/.codex). Safe to call repeatedly: already-linked entries are skipped, and
// an entry the agent already populated is migrated into the shared store first.
function linkSharedHistory(dir, agent = 'claude') {
  const mainDir = agentHomeDir(agent);
  for (const { name, file } of agentDef(agent).sharedEntries) {
    const target = path.join(mainDir, name);
    const link = path.join(dir, name);
    try {
      if (!fs.existsSync(target)) {
        if (file) fs.writeFileSync(target, '');
        else fs.mkdirSync(target, { recursive: true });
      }
      let st = null;
      try {
        st = fs.lstatSync(link);
      } catch {
        st = null;
      }
      if (st && st.isSymbolicLink()) continue; // already linked
      if (st) migrateInto(link, target, file);
      symlinkCompat(target, link, file);
    } catch {
      /* best effort — history sharing is non-fatal */
    }
  }
}

// Unless the profile shares the ambient login (subscription types / isolate:false)
// or the user already set the agent's config-dir env themselves, point the agent
// at a per-profile config dir so the profile's credential is the one actually used
// — a stored login otherwise takes precedence over an injected token. Returns the
// dir, or null when not isolating.
function applyIsolation(extraEnv, name, stored, shareHistory, agentName) {
  if (!isIsolated(stored)) return null;
  const agent = agentName || agentOf(stored);
  const cfgEnv = agentDef(agent).configDirEnv;
  if (process.env[cfgEnv]) return process.env[cfgEnv]; // env override wins
  const dir = sessionDir(name, stored);
  fs.mkdirSync(dir, { recursive: true });
  // Seed onboarding only when a credential is injected (so claude skips the login
  // screen and uses the token). For a subscription profile there is no token —
  // we WANT the login screen so a separate account can sign in.
  const injectsCredential = typeDef(stored.type).defaultIsolate !== false;
  if (agentDef(agent).seedOnboarding && injectsCredential) seedOnboarding(dir);
  if (shareHistory) linkSharedHistory(dir, agent);
  extraEnv[cfgEnv] = dir;
  return dir;
}

// Resolve a stored profile into concrete field values, letting a runtime
// environment variable override the saved value. Prompts for anything that is
// still missing (when interactive) and offers to save it.
async function resolveProfile(data, name) {
  const stored = data.profiles[name];
  if (!stored) throw new Error(`profile "${name}" not found`);
  const def = typeDef(stored.type);

  const resolved = { type: stored.type };
  const sources = {};
  const missing = [];

  for (const field of def.fields) {
    const envVal = process.env[field.env];
    if (envVal !== undefined && envVal !== '') {
      resolved[field.key] = envVal;
      sources[field.key] = 'env';
    } else if (stored[field.key] !== undefined && stored[field.key] !== '') {
      resolved[field.key] = stored[field.key];
      sources[field.key] = 'config';
    } else if (!field.optional) {
      missing.push(field);
    }
  }

  if (missing.length) {
    if (!tty.isInteractive()) {
      const names = missing.map((f) => '$' + f.env).join(', ');
      throw new Error(
        `profile "${name}" is missing required values (${names}). ` +
          `Set the env var(s) or run: cldz --config`
      );
    }
    process.stdout.write(
      paint(c.yellow, `Profile "${name}" needs a few values:`) + '\n'
    );
    let touched = false;
    for (const field of missing) {
      const val = field.secret
        ? await tty.askSecret('  ' + field.label)
        : await tty.ask('  ' + field.label, { defaultValue: field.default || '' });
      if (!val && !field.optional) throw new Error(`${field.label} is required`);
      if (val) {
        resolved[field.key] = val;
        sources[field.key] = 'prompt';
        touched = true;
      }
    }
    if (touched) {
      const store = await tty.confirm('Save these to the profile?', { defaultValue: true });
      if (store) {
        for (const field of missing) {
          if (sources[field.key] === 'prompt') stored[field.key] = resolved[field.key];
        }
        config.save(data);
      }
    }
  }

  return { resolved, sources };
}

function pickDefaultProfileName(data) {
  const names = config.profileNames(data);
  if (data.defaultProfile && data.profiles[data.defaultProfile]) return data.defaultProfile;
  if (names.length === 1) return names[0];
  return null;
}

// Determine which profile to run, creating one if none exist.
async function determineProfile(data, requested) {
  if (requested) {
    if (!data.profiles[requested]) {
      throw new Error(`profile "${requested}" not found. Run: cldz --config`);
    }
    return requested;
  }

  const names = config.profileNames(data);
  if (names.length === 0) {
    process.stdout.write(paint(c.bold, 'Welcome to cldz — let’s set up authentication.\n\n'));
    // Offer to import any credentials already on the machine first.
    const imported = await wizard.offerImport(data);
    if (imported) {
      config.save(data);
      const count = config.profileNames(data).length;
      process.stdout.write(paint(c.green, `\n✓ Imported ${count} profile(s). Default: "${data.defaultProfile}".\n\n`));
      return data.defaultProfile || imported;
    }
    const name = await wizard.configureProfile(data, {});
    config.save(data);
    process.stdout.write(paint(c.green, `\n✓ Saved profile "${name}".\n\n`));
    return name;
  }

  const chosen = pickDefaultProfileName(data);
  if (chosen) return chosen;

  // Multiple profiles, no default -> ask.
  const choice = await tty.select(
    'Which profile?',
    names.map((n) => ({ name: n, value: n, hint: data.profiles[n].type }))
  );
  return choice;
}

function launchAgent(agent, agentArgs, extraEnv) {
  // Release stdin (any open prompt interface) before the child inherits it.
  tty.close();
  const def = agentDef(agent);
  const bin = process.env[def.binEnv] || def.bin;
  const env = { ...process.env, ...extraEnv };
  const child = spawn(bin, agentArgs, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`cldz: could not find "${bin}". Install ${def.label} first:\n  ${def.installHint}`);
      process.exit(127);
    }
    console.error(`cldz: failed to launch ${def.label} — ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code == null ? 0 : code);
    }
  });
}

// Back-compat alias.
const launchClaude = (args, env) => launchAgent('claude', args, env);

const SKIP_PERMS_FLAG = '--dangerously-skip-permissions';

// Backend base URL Switchyard should hit for a given provider.
function backendBaseUrl(provider) {
  return provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1';
}

function switchyardArgs(agent, provider, key, model, agentArgs) {
  const args = ['launch', agent, '--base-url', backendBaseUrl(provider), '--api-key', key, '--no-model-discovery'];
  if (model) args.push('--model', model);
  if (agentArgs.length) args.push('--', ...agentArgs);
  return args;
}

// Cross-provider launch: Switchyard runs a translating proxy and spawns the agent
// pointed at it, tearing the proxy down when the agent exits.
function launchViaSwitchyard(agent, provider, key, model, agentArgs, extraEnv) {
  tty.close();
  const bin = process.env.CLDZ_SWITCHYARD_BIN || 'switchyard';
  const child = spawn(bin, switchyardArgs(agent, provider, key, model, agentArgs), {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(
        `cldz: running ${agent} on an ${provider} API needs the Switchyard proxy.\n` +
          '  Install it:  pip install "nemo-switchyard[cli,server]"\n' +
          '  (or set $CLDZ_SWITCHYARD_BIN to its path)'
      );
      process.exit(127);
    }
    console.error('cldz: failed to launch switchyard — ' + err.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code == null ? 0 : code);
  });
}

// Launch path for the unified `api` profile type (provider + agent + key).
function launchApiProfile({ name, stored, agent, claudeArgs, data, quiet, dryRun }) {
  const provider = stored.provider === 'openai' ? 'openai' : 'anthropic';
  const keyEnv = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const key = process.env[keyEnv] || stored.apiKey;
  if (!key) {
    throw new Error(`profile "${name}" needs an API key — set $${keyEnv} or run: cldz --edit ${name} --set apiKey=<key>`);
  }
  const native = (provider === 'anthropic' && agent === 'claude') || (provider === 'openai' && agent === 'codex');
  if (!native && !stored.model) {
    throw new Error(
      `running ${agent} on an ${provider} API is cross-provider and needs a model — ` +
        `set one: cldz --edit ${name} --set model=<model>`
    );
  }

  // Per-profile default args + skip-permissions (claude only).
  const defaultArgs = Array.isArray(stored.args) ? stored.args : [];
  let finalArgs = [...defaultArgs, ...claudeArgs];
  const skipping = agent === 'claude' && data.skipPermissions === true && !finalArgs.includes(SKIP_PERMS_FLAG);
  if (skipping) finalArgs = [SKIP_PERMS_FLAG, ...finalArgs];

  // Per-profile isolation (works for both native and proxied launches).
  const extraEnv = {};
  const agDef = agentDef(agent);
  let isolatedDir = null;
  if (isIsolated(stored) && !process.env[agDef.configDirEnv]) {
    isolatedDir = sessionDir(name, stored);
    fs.mkdirSync(isolatedDir, { recursive: true });
    if (agDef.seedOnboarding) seedOnboarding(isolatedDir);
    if (data.shareHistory === true) linkSharedHistory(isolatedDir, agent);
    extraEnv[agDef.configDirEnv] = isolatedDir;
  }
  if (native) extraEnv[keyEnv] = key;

  if (!quiet && process.stdout.isTTY) {
    const mode = native
      ? paint(c.dim, 'native')
      : paint(c.yellow, `via Switchyard (${provider}→${agent}${stored.model ? ', ' + stored.model : ''})`);
    process.stderr.write(paint(c.dim, `cldz › ${agDef.label} · profile "${name}" · api:${provider} · `) + mode + '\n');
  }

  if (dryRun) {
    if (native) {
      const bin = process.env[agDef.binEnv] || agDef.bin;
      process.stdout.write(
        `agent:      ${agDef.label}\n` +
          `profile:    ${name} (api:${provider}, native)\n` +
          `command:    ${bin} ${finalArgs.join(' ')}\n` +
          `config dir: ${isolatedDir || '(ambient)'}\n` +
          `env:        ${keyEnv}=${maskValue(key)}${isolatedDir ? ` ${agDef.configDirEnv}=${isolatedDir}` : ''}\n`
      );
    } else {
      const bin = process.env.CLDZ_SWITCHYARD_BIN || 'switchyard';
      const sa = switchyardArgs(agent, provider, key, stored.model, finalArgs).map((a) => (a === key ? maskValue(key) : a));
      process.stdout.write(
        `agent:      ${agDef.label} (via Switchyard)\n` +
          `profile:    ${name} (api:${provider} → ${agent})\n` +
          `command:    ${bin} ${sa.join(' ')}\n` +
          `backend:    ${backendBaseUrl(provider)}\n` +
          `config dir: ${isolatedDir || '(ambient)'}\n`
      );
    }
    return;
  }

  if (native) launchAgent(agent, finalArgs, extraEnv);
  else launchViaSwitchyard(agent, provider, key, stored.model, finalArgs, extraEnv);
}

// `cldz --login -P <name>`: sign a profile into its account. Modes:
//   (default)            interactive OAuth (`codex login` / claude login screen)
//   --with-access-token  pipe a token to codex's official `codex login --with-access-token`
//   --with-api-key       pipe a key to codex's official `codex login --with-api-key`
//   --auth-json [file]   seed the profile's own auth.json (codex re-mints from its refresh_token)
// cldz never stores tokens in its config — they live in the agent's auth file.
function seedCodexAuth(name, dir, authSrc) {
  if (!dir) {
    throw new Error(
      `seeding auth.json needs an ISOLATED profile so it won't overwrite your main ~/.codex — run: cldz --edit ${name} --set isolate=true`
    );
  }
  let raw;
  if (authSrc && authSrc !== true) raw = fs.readFileSync(authSrc, 'utf8');
  else raw = fs.readFileSync(0, 'utf8'); // stdin (paste the auth.json)
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('input is not a valid codex auth.json (expected JSON)');
  }
  if (!parsed || !parsed.tokens || !parsed.tokens.access_token) {
    throw new Error('auth.json is missing tokens.access_token');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(
    paint(c.green, `✓ Seeded codex auth for profile "${name}"`) +
      paint(c.dim, ` in ${dir} — codex will refresh it from its refresh_token.\n`)
  );
}

// Interactive "sign in now?" offered from `cldz --config` after creating/editing
// an isolated codex profile. Tokens go into codex's auth file, never cldz config.
async function offerCodexSignIn(name, stored) {
  if (agentOf(stored) !== 'codex' || !isIsolated(stored)) return;
  let method;
  try {
    method = await tty.select(`Sign in to Codex for "${name}" now?`, [
      { name: 'Sign in with codex (opens codex login)', value: 'oauth' },
      { name: 'Paste an access token', value: 'token' },
      { name: 'Paste the full auth.json (one line)', value: 'authjson' },
      { name: `Later — run: cldz --login -P ${name}`, value: 'skip' },
    ]);
  } catch (e) {
    if (e && e.code === 'CLDZ_ABORT') return;
    throw e;
  }
  if (method === 'skip') return;

  const dir = sessionDir(name, stored);
  fs.mkdirSync(dir, { recursive: true });
  const bin = process.env.CLDZ_CODEX_BIN || 'codex';
  const env = { ...process.env, CODEX_HOME: dir };
  const shell = process.platform === 'win32';

  if (method === 'authjson') {
    const raw = await tty.ask('  auth.json');
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.tokens || !parsed.tokens.access_token) throw new Error('missing tokens.access_token');
      fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
      process.stdout.write(paint(c.green, `  ✓ Seeded codex auth for "${name}".\n`));
    } catch (e) {
      process.stdout.write(paint(c.red, `  Not valid auth.json: ${e.message}\n`));
    }
    return;
  }

  let token;
  if (method === 'token') token = await tty.askSecret('  Access token');
  tty.close(); // release stdin for the codex child
  let res;
  if (method === 'oauth') {
    res = spawnSync(bin, ['login'], { stdio: 'inherit', env, shell });
  } else {
    if (!token) return;
    res = spawnSync(bin, ['login', '--with-access-token'], { input: token + '\n', stdio: ['pipe', 'inherit', 'inherit'], env, shell });
  }
  if (res && res.error) {
    process.stdout.write(paint(c.red, `  codex login failed: ${res.error.message}\n`));
  }
}

async function login({ profile: requested, mode, authSrc }) {
  const data = config.load();
  const name = await determineProfile(data, requested);
  const stored = data.profiles[name];
  const agent = agentOf(stored);
  const agDef = agentDef(agent);
  const dir = isIsolated(stored) ? sessionDir(name, stored) : null;

  if (mode === 'auth-json') {
    if (agent !== 'codex') throw new Error('--auth-json applies to codex profiles');
    return seedCodexAuth(name, dir, authSrc);
  }
  if ((mode === 'access-token' || mode === 'api-key') && agent !== 'codex') {
    throw new Error('--with-access-token / --with-api-key are codex-only; for claude use an oauth-token profile');
  }

  const extraEnv = {};
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    extraEnv[agDef.configDirEnv] = dir;
  }
  const label = mode ? `${mode} ` : '';
  process.stderr.write(
    paint(c.dim, `cldz › ${label}login to ${agDef.label} for profile "${name}" ${dir ? 'in ' + dir : '(shared login)'}\n`)
  );
  tty.close();
  const bin = process.env[agDef.binEnv] || agDef.bin;
  let args = [];
  if (agent === 'codex') {
    if (mode === 'access-token') args = ['login', '--with-access-token'];
    else if (mode === 'api-key') args = ['login', '--with-api-key'];
    else args = ['login'];
  }
  // stdio inherited: codex reads the piped/pasted token from stdin — cldz never sees it.
  const child = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv }, shell: process.platform === 'win32' });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`cldz: could not find "${bin}". Install ${agDef.label} first:\n  ${agDef.installHint}`);
      process.exit(127);
    }
    console.error(`cldz: login failed — ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code == null ? 0 : code);
  });
}

// Entry point for the "run" path.
async function run({ profile: requested, agent: agentOverride, claudeArgs, quiet, dryRun }) {
  const data = config.load();
  if (agentOverride && !AGENTS[agentOverride]) {
    throw new Error(`unknown agent "${agentOverride}" — use "claude" or "codex"`);
  }

  let name;
  let stored;
  let resolved;
  let sources;
  const adhoc = Boolean(agentOverride) && !requested;
  if (adhoc) {
    // `cldz --agent codex|claude ...` (no -P) runs the agent on its ambient login.
    stored = { type: agentOverride === 'codex' ? 'codexSubscription' : 'subscription' };
    name = `${agentOverride} (ad-hoc)`;
    resolved = { type: stored.type };
    sources = {};
  } else {
    name = await determineProfile(data, requested);
    stored = data.profiles[name];
    ({ resolved, sources } = await resolveProfile(data, name));
  }

  // `-P <name> --agent X` overrides the profile's default agent.
  const agent = !adhoc && agentOverride ? agentOverride : agentOf(stored);

  // Unified API profiles have their own launch path (provider × agent matrix).
  if (stored.type === 'api') {
    return launchApiProfile({ name, stored, agent, claudeArgs, data, quiet, dryRun });
  }

  const extraEnv = buildEnv(resolved);
  const isolatedDir = adhoc
    ? null
    : applyIsolation(extraEnv, name, stored, data.shareHistory === true, agent);

  // Warn if a codex profile's stored access token has expired (codex will try to
  // refresh it, but a stale token is a common cause of auth failures).
  if (agent === 'codex') {
    const info = codexTokenInfo();
    if (info.present && info.hasToken && info.expired) {
      process.stderr.write(
        paint(c.yellow, 'cldz: your Codex access token looks expired — ') +
          paint(c.dim, 'codex will try to refresh it; if auth fails, re-login with `codex`.\n')
      );
    }
  }

  // Per-profile default args come first so user-supplied args can override them.
  const defaultArgs = Array.isArray(stored.args) ? stored.args : [];
  let finalArgs = [...defaultArgs, ...claudeArgs];

  // Auto-add --dangerously-skip-permissions when enabled (claude only; don't dup).
  const skipping =
    agent === 'claude' && data.skipPermissions === true && !finalArgs.includes(SKIP_PERMS_FLAG);
  if (skipping) finalArgs = [SKIP_PERMS_FLAG, ...finalArgs];

  if (!quiet && process.stdout.isTTY) {
    const def = typeDef(resolved.type);
    const agentLabel = agentDef(agent).label;
    const via = Object.values(sources).includes('env') ? paint(c.dim, ' (env override)') : '';
    const shared = isolatedDir && data.shareHistory === true ? ' + shared history' : '';
    const iso = isolatedDir ? paint(c.dim, ' · isolated session' + shared) : '';
    const skip = skipping ? paint(c.yellow, ' · skip-permissions') : '';
    process.stderr.write(
      paint(c.dim, `cldz › ${agentLabel} · profile "${name}" · ${def.label}${via}${iso}`) + skip + '\n'
    );
  }

  if (dryRun) {
    const envKeys = Object.keys(extraEnv);
    const envStr = envKeys.length
      ? envKeys.map((k) => `${k}=${/TOKEN|KEY/.test(k) ? maskValue(extraEnv[k]) : extraEnv[k]}`).join(' ')
      : '(none)';
    const bin = process.env[agentDef(agent).binEnv] || agentDef(agent).bin;
    process.stdout.write(
      `agent:      ${agentDef(agent).label}\n` +
        `profile:    ${name} (${resolved.type})\n` +
        `command:    ${bin} ${finalArgs.join(' ')}\n` +
        `config dir: ${isolatedDir || '(ambient login)'}\n` +
        `env:        ${envStr}\n`
    );
    return;
  }

  launchAgent(agent, finalArgs, extraEnv);
}

module.exports = {
  run,
  login,
  offerCodexSignIn,
  resolveProfile,
  determineProfile,
  launchClaude,
  launchAgent,
  sessionDir,
  applyIsolation,
  linkSharedHistory,
  isIsolated,
  profileReadiness,
};
