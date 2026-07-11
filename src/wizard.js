'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AUTH_TYPES, TYPE_ORDER, typeDef } = require('./auth.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

// Detect credentials already present on the machine so first-run can offer to
// create matching profiles. Env-based ones store NO secret (read from env each
// run); login-based ones just reference the existing agent login.
function detectCredentials() {
  const found = [];
  const home = os.homedir();
  if (process.env.ANTHROPIC_API_KEY) {
    found.push({ name: 'apikey', label: 'Anthropic API key (from $ANTHROPIC_API_KEY)', profile: { type: 'apiKey' } });
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    found.push({ name: 'oauth', label: 'Claude OAuth token (from $CLAUDE_CODE_OAUTH_TOKEN)', profile: { type: 'oauth' } });
  }
  if (process.env.OPENAI_API_KEY) {
    found.push({ name: 'openai', label: 'OpenAI API key (from $OPENAI_API_KEY)', profile: { type: 'codexApiKey' } });
  }
  try {
    if (fs.existsSync(path.join(home, '.claude.json')) || fs.existsSync(path.join(home, '.claude'))) {
      found.push({ name: 'claude', label: 'Your existing Claude login (~/.claude)', profile: { type: 'subscription' } });
    }
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(path.join(home, '.codex', 'auth.json'))) {
      found.push({ name: 'codex', label: 'Your existing Codex login (~/.codex)', profile: { type: 'codexSubscription' } });
    }
  } catch {
    /* ignore */
  }
  return found;
}

// First-run offer to import detected credentials as profiles. Mutates `config`.
// Returns the name of the first imported profile (also set as default), or null.
async function offerImport(config) {
  const found = detectCredentials();
  if (!found.length) return null;
  process.stdout.write(paint(c.bold, 'Found credentials already on this machine:') + '\n');
  let firstName = null;
  for (const item of found) {
    const ok = await tty.confirm(`  Create a profile for ${item.label}?`, { defaultValue: true });
    if (!ok) continue;
    let name = item.name;
    if (config.profiles[name]) {
      let i = 2;
      while (config.profiles[`${name}${i}`]) i++;
      name = `${name}${i}`;
    }
    config.profiles[name] = item.profile;
    if (!firstName) firstName = name;
  }
  if (firstName && !config.defaultProfile) config.defaultProfile = firstName;
  return firstName;
}

function suggestName(config, type) {
  const base = type === 'apiKey' ? 'apikey' : type;
  if (!config.profiles[base]) return base;
  let i = 2;
  while (config.profiles[`${base}${i}`]) i++;
  return `${base}${i}`;
}

async function pickType(current) {
  const choices = TYPE_ORDER.map((type) => ({
    name: AUTH_TYPES[type].label + (type === current ? paint(c.dim, '  (current)') : ''),
    value: type,
    hint: AUTH_TYPES[type].hint,
  }));
  return tty.select('Which authentication method?', choices);
}

// Prompt for every field of a type. `existing` supplies defaults when editing.
// Returns { values, hasSecret } where values are the entered field values.
async function promptFields(type, existing = {}) {
  const def = typeDef(type);
  if (def.note) process.stdout.write(paint(c.dim, def.note) + '\n');

  const values = {};
  let hasSecret = false;

  for (const field of def.fields) {
    const envVal = process.env[field.env];
    if (field.secret) {
      hasSecret = true;
      if (envVal) {
        process.stdout.write(
          paint(c.green, '✓') + ` ${field.label} detected in ${paint(c.dim, '$' + field.env)}\n`
        );
        const useEnv = await tty.confirm('  Use the value from the environment?', { defaultValue: true });
        if (useEnv) {
          // Leave unset so it is read from env at run time (not stored).
          values[field.key] = undefined;
          continue;
        }
      }
      const hadStored = existing[field.key] ? paint(c.dim, ' (press Enter to keep saved value)') : '';
      const entered = await tty.askSecret(`  ${field.label}${hadStored}`);
      if (entered) values[field.key] = entered;
      else if (existing[field.key]) values[field.key] = existing[field.key];
      else if (!field.optional) throw new Error(`${field.label} is required`);
    } else {
      const def2 = existing[field.key] || envVal || field.default || '';
      const entered = await tty.ask(`  ${field.label}`, { defaultValue: def2 });
      if (entered) values[field.key] = entered;
      else if (!field.optional) throw new Error(`${field.label} is required`);
    }
  }

  return { values, hasSecret };
}

// Create or edit a profile interactively and persist it.
// opts: { name?, type?, editing? }  -> returns the saved profile name.
async function configureProfile(config, opts = {}) {
  const editing = Boolean(opts.name && config.profiles[opts.name]);
  const existing = editing ? config.profiles[opts.name] : {};

  const type = opts.type || (await pickType(existing.type));
  const { values, hasSecret } = await promptFields(type, existing);

  const profile = { type };
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) profile[k] = v;
  }

  // Decide whether to persist any secret in plaintext.
  const def = typeDef(type);
  const secretFields = def.fields.filter((f) => f.secret);
  const enteredSecret = secretFields.some((f) => values[f.key] !== undefined);

  if (enteredSecret) {
    const store = await tty.confirm(
      'Save the secret in ~/.cldz/config.json (plaintext)?',
      { defaultValue: true }
    );
    if (!store) {
      for (const f of secretFields) delete profile[f.key];
      process.stdout.write(
        paint(c.dim, `  Secret not saved — set $${secretFields.map((f) => f.env).join(' / $')} before running.`) + '\n'
      );
    }
  }

  // Isolation: keep this profile's session (and its credential) separate from the
  // agent's main login. Subscription-style types always share the ambient login
  // (there's nothing to inject), so we don't ask.
  if (def.defaultIsolate === false) {
    profile.isolate = false;
    process.stdout.write(paint(c.dim, '  Uses your existing login (shared, not isolated).\n'));
  } else {
    const isolate = await tty.confirm(
      'Keep this profile isolated from your main login (recommended)?',
      { defaultValue: existing.isolate !== false }
    );
    if (isolate) delete profile.isolate;
    else profile.isolate = false;
  }

  // Optional default args always passed to the agent (e.g. "--model opus").
  const argsStr = await tty.ask('Default args to always pass (optional, e.g. --model opus)', {
    defaultValue: Array.isArray(existing.args) ? existing.args.join(' ') : '',
  });
  if (argsStr && argsStr.trim()) profile.args = argsStr.trim().split(/\s+/);
  else delete profile.args;

  let name = opts.name;
  if (!name) {
    const suggested = suggestName(config, type);
    name = await tty.ask('Profile name', { defaultValue: suggested });
  }
  if (!name) throw new Error('a profile name is required');

  config.profiles[name] = profile;

  // Default selection.
  const onlyProfile = Object.keys(config.profiles).length === 1;
  if (onlyProfile) {
    config.defaultProfile = name;
  } else if (config.defaultProfile !== name) {
    const makeDefault = await tty.confirm(`Make "${name}" the default profile?`, {
      defaultValue: !editing,
    });
    if (makeDefault) config.defaultProfile = name;
  }

  return name;
}

module.exports = { configureProfile, pickType, promptFields, suggestName, detectCredentials, offerImport };
