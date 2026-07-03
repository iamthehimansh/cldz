'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { typeDef, buildEnv } = require('./auth.js');
const config = require('./config.js');
const { configDir } = require('./paths.js');
const wizard = require('./wizard.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

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

// Conversation state Claude Code keeps inside its config dir. When "share
// history" is on, these are symlinked back to the main ~/.claude so an isolated
// profile sees the same /history and resumable sessions as plain `claude` and
// every other profile — while credentials/config stay isolated.
const SHARED_ENTRIES = [
  { name: 'projects', file: false }, // session transcripts (--resume / history)
  { name: 'history.jsonl', file: true }, // prompt history
  { name: 'todos', file: false },
  { name: 'shell-snapshots', file: false },
];

function mainClaudeDir() {
  return path.join(os.homedir(), '.claude');
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

// Point an isolated dir's history entries at the shared ~/.claude ones. Safe to
// call repeatedly: already-linked entries are skipped, and an entry Claude
// already populated is migrated into the shared store before being linked.
function linkSharedHistory(dir) {
  const mainDir = mainClaudeDir();
  for (const { name, file } of SHARED_ENTRIES) {
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

// Unless the profile opts out (isolate: false) or the user already set
// CLAUDE_CONFIG_DIR themselves, point claude at a per-profile config dir so the
// profile's credential is the one actually used — a stored login in ~/.claude
// otherwise takes precedence over an injected token. Returns the dir, or null.
function applyIsolation(extraEnv, name, stored, shareHistory) {
  if (stored.isolate === false) return null;
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR; // env override wins
  const dir = sessionDir(name, stored);
  fs.mkdirSync(dir, { recursive: true });
  seedOnboarding(dir);
  if (shareHistory) linkSharedHistory(dir);
  extraEnv.CLAUDE_CONFIG_DIR = dir;
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

function launchClaude(claudeArgs, extraEnv) {
  // Release stdin (any open prompt interface) before claude inherits it.
  tty.close();
  const bin = process.env.CLDZ_CLAUDE_BIN || 'claude';
  const env = { ...process.env, ...extraEnv };
  const child = spawn(bin, claudeArgs, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(
        `cldz: could not find "${bin}". Install Claude Code first:\n` +
          '  npm install -g @anthropic-ai/claude-code'
      );
      process.exit(127);
    }
    console.error('cldz: failed to launch claude — ' + err.message);
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

// Entry point for the "run" path.
async function run({ profile: requested, claudeArgs, quiet }) {
  const data = config.load();
  const name = await determineProfile(data, requested);
  const { resolved, sources } = await resolveProfile(data, name);
  const extraEnv = buildEnv(resolved);
  const isolatedDir = applyIsolation(extraEnv, name, data.profiles[name], data.shareHistory === true);

  if (!quiet && process.stdout.isTTY) {
    const def = typeDef(resolved.type);
    const via = Object.values(sources).includes('env') ? paint(c.dim, ' (env override)') : '';
    const shared = isolatedDir && data.shareHistory === true ? ' + shared history' : '';
    const iso = isolatedDir ? paint(c.dim, ' · isolated session' + shared) : '';
    process.stderr.write(
      paint(c.dim, `cldz › profile "${name}" · ${def.label}${via}${iso}\n`)
    );
  }

  launchClaude(claudeArgs, extraEnv);
}

module.exports = {
  run,
  resolveProfile,
  determineProfile,
  launchClaude,
  sessionDir,
  applyIsolation,
  linkSharedHistory,
};
