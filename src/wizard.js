'use strict';

const { AUTH_TYPES, TYPE_ORDER, typeDef } = require('./auth.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

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

  // Isolation: keep this profile's Claude session (and its credential) separate
  // from your main ~/.claude login. Recommended so the profile's credential is
  // the one actually used.
  const isolate = await tty.confirm(
    'Keep this profile isolated from your main ~/.claude login (recommended)?',
    { defaultValue: existing.isolate !== false }
  );
  if (isolate) delete profile.isolate;
  else profile.isolate = false;

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

module.exports = { configureProfile, pickType, promptFields, suggestName };
