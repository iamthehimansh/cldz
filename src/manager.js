'use strict';

const fs = require('node:fs');
const config = require('./config.js');
const { typeDef, buildEnv, agentOf } = require('./auth.js');
const { agentDef } = require('./agents.js');
const { sessionDir, linkSharedHistory, isIsolated } = require('./run.js');
const wizard = require('./wizard.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

function maskSecrets(profile) {
  const def = typeDef(profile.type);
  const parts = [];
  for (const field of def.fields) {
    const val = profile[field.key];
    if (val === undefined || val === '') continue;
    parts.push(`${field.key}=${field.secret ? mask(val) : val}`);
  }
  return parts.join('  ');
}

function mask(val) {
  const s = String(val);
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

function printProfiles(data) {
  const names = config.profileNames(data);
  if (!names.length) {
    process.stdout.write(paint(c.dim, '  (no profiles yet)\n'));
    return;
  }
  for (const name of names) {
    const p = data.profiles[name];
    const isDefault = data.defaultProfile === name;
    const star = isDefault ? paint(c.green, ' ★ default') : '';
    const def = typeDef(p.type);
    const agentTag = paint(c.cyan, `[${agentDef(agentOf(p)).label}]`);
    const iso = !isIsolated(p) ? '  ' + paint(c.yellow, '(shared login)') : '';
    process.stdout.write(`  ${paint(c.bold, name)}  ${agentTag} ${paint(c.dim, def.label)}${star}${iso}\n`);
    const detail = maskSecrets(p);
    if (detail) process.stdout.write(paint(c.dim, `      ${detail}\n`));
  }
}

async function chooseProfile(data, message) {
  const names = config.profileNames(data);
  if (!names.length) return null;
  return tty.select(
    message,
    names.map((n) => ({
      name: n + (data.defaultProfile === n ? ' ★' : ''),
      value: n,
      hint: data.profiles[n].type,
    }))
  );
}

// Interactive config management loop (cldz --config).
async function manage() {
  const data = config.load();
  process.stdout.write('\n' + paint(c.bold, 'cldz configuration') + '  ' + paint(c.dim, config.configPath()) + '\n\n');

  for (;;) {
    printProfiles(data);
    const shareState = data.shareHistory === true ? paint(c.green, 'on') : paint(c.dim, 'off');
    const skipState = data.skipPermissions === true ? paint(c.yellow, 'on') : paint(c.dim, 'off');
    process.stdout.write(
      '\n' +
        paint(c.dim, 'Shared history (incl. your main ~/.claude): ') + shareState + '\n' +
        paint(c.dim, 'Skip permissions (--dangerously-skip-permissions): ') + skipState + '\n\n'
    );

    const action = await tty.select('What would you like to do?', [
      { name: 'Add a profile', value: 'add' },
      { name: 'Edit a profile', value: 'edit' },
      { name: 'Delete a profile', value: 'delete' },
      { name: 'Set default profile', value: 'default' },
      { name: 'Rename a profile', value: 'rename' },
      { name: `Shared history: turn ${data.shareHistory === true ? 'OFF' : 'ON'}`, value: 'sharehistory' },
      { name: `Skip permissions: turn ${data.skipPermissions === true ? 'OFF' : 'ON'}`, value: 'skipperms' },
      { name: 'Save & exit', value: 'exit' },
    ]).catch((e) => {
      if (e.code === 'CLDZ_ABORT') return 'exit';
      throw e;
    });

    process.stdout.write('\n');

    if (action === 'exit') break;

    try {
      if (action === 'add') {
        const name = await wizard.configureProfile(data, {});
        config.save(data);
        process.stdout.write(paint(c.green, `✓ Added "${name}".\n\n`));
      } else if (action === 'edit') {
        const name = await chooseProfile(data, 'Edit which profile?');
        if (name) {
          await wizard.configureProfile(data, { name });
          config.save(data);
          process.stdout.write(paint(c.green, `✓ Updated "${name}".\n\n`));
        }
      } else if (action === 'delete') {
        const name = await chooseProfile(data, 'Delete which profile?');
        if (name) {
          const yes = await tty.confirm(`Delete "${name}"?`, { defaultValue: false });
          if (yes) {
            config.removeProfile(data, name);
            config.save(data);
            process.stdout.write(paint(c.green, `✓ Deleted "${name}".\n\n`));
          }
        }
      } else if (action === 'default') {
        const name = await chooseProfile(data, 'Set which profile as default?');
        if (name) {
          config.setDefault(data, name);
          config.save(data);
          process.stdout.write(paint(c.green, `✓ Default is now "${name}".\n\n`));
        }
      } else if (action === 'rename') {
        const name = await chooseProfile(data, 'Rename which profile?');
        if (name) {
          const next = await tty.ask('New name', { defaultValue: name });
          if (next && next !== name) {
            if (data.profiles[next]) throw new Error(`"${next}" already exists`);
            data.profiles[next] = data.profiles[name];
            if (data.defaultProfile === name) data.defaultProfile = next;
            delete data.profiles[name];
            config.save(data);
            process.stdout.write(paint(c.green, `✓ Renamed to "${next}".\n\n`));
          }
        }
      } else if (action === 'sharehistory') {
        data.shareHistory = data.shareHistory !== true;
        config.save(data);
        if (data.shareHistory) {
          // Link existing isolated profiles now so history shows up immediately.
          let linked = 0;
          for (const [pname, p] of Object.entries(data.profiles)) {
            if (!isIsolated(p)) continue;
            try {
              linkSharedHistory(sessionDir(pname, p), agentOf(p));
              linked++;
            } catch {
              /* ignore */
            }
          }
          process.stdout.write(
            paint(c.green, `✓ Shared history ON`) +
              paint(c.dim, ` — all profiles now share /history and resumable sessions with your main ~/.claude (${linked} profile(s) linked).\n\n`)
          );
        } else {
          process.stdout.write(
            paint(c.green, '✓ Shared history OFF') +
              paint(c.dim, ' — new launches keep separate history per profile. Already-linked dirs stay linked until the profile is recreated.\n\n')
          );
        }
      } else if (action === 'skipperms') {
        if (data.skipPermissions === true) {
          data.skipPermissions = false;
          config.save(data);
          process.stdout.write(paint(c.green, '✓ Skip permissions OFF.\n\n'));
        } else {
          process.stdout.write(
            paint(c.yellow, '⚠ --dangerously-skip-permissions lets claude run tools without asking for approval.\n') +
              paint(c.dim, '  Only enable this if you trust what you run.\n')
          );
          const ok = await tty.confirm('Enable skip-permissions for every launch?', { defaultValue: false });
          if (ok) {
            data.skipPermissions = true;
            config.save(data);
            process.stdout.write(paint(c.green, '✓ Skip permissions ON — cldz will pass --dangerously-skip-permissions to claude.\n\n'));
          } else {
            process.stdout.write(paint(c.dim, '(unchanged)\n\n'));
          }
        }
      }
    } catch (err) {
      if (err.code === 'CLDZ_ABORT') {
        process.stdout.write(paint(c.dim, '(cancelled)\n\n'));
      } else {
        process.stdout.write(paint(c.red, `✗ ${err.message}\n\n`));
      }
    }
  }

  process.stdout.write(paint(c.dim, 'Saved. Run `cldz` to launch Claude Code.\n'));
}

// Non-interactive helpers used by subcommands.
function listProfiles({ json } = {}) {
  const data = config.load();
  if (json) {
    const out = {
      configPath: config.configPath(),
      defaultProfile: data.defaultProfile || null,
      shareHistory: data.shareHistory === true,
      skipPermissions: data.skipPermissions === true,
      profiles: config.profileNames(data).map((name) => {
        const p = data.profiles[name];
        return {
          name,
          agent: agentOf(p),
          type: p.type,
          isolated: isIsolated(p),
          default: data.defaultProfile === name,
        };
      }),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  process.stdout.write(paint(c.bold, 'Profiles') + '  ' + paint(c.dim, config.configPath()) + '\n');
  printProfiles(data);
}

// Show the active/default profile and current global settings.
function showCurrent({ json } = {}) {
  const data = config.load();
  const name = data.defaultProfile || config.profileNames(data)[0];
  if (!name || !data.profiles[name]) {
    if (json) {
      process.stdout.write(JSON.stringify({ profile: null }, null, 2) + '\n');
      return;
    }
    process.stdout.write(paint(c.dim, 'No profile configured yet — run: cldz --config\n'));
    return;
  }
  const p = data.profiles[name];
  const def = typeDef(p.type);
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          profile: name,
          agent: agentOf(p),
          type: p.type,
          isolated: isIsolated(p),
          shareHistory: data.shareHistory === true,
          skipPermissions: data.skipPermissions === true,
        },
        null,
        2
      ) + '\n'
    );
    return;
  }
  process.stdout.write(
    paint(c.bold, name) +
      '  ' + paint(c.cyan, `[${agentDef(agentOf(p)).label}]`) +
      '  ' + paint(c.dim, def.label) +
      (isIsolated(p) ? paint(c.dim, ' · isolated') : paint(c.yellow, ' · shared login')) +
      '\n'
  );
  process.stdout.write(
    paint(c.dim, `shared history: ${data.shareHistory === true ? 'on' : 'off'} · ` +
      `skip permissions: ${data.skipPermissions === true ? 'on' : 'off'}\n`)
  );
}

function showEnv(profileName) {
  const data = config.load();
  const name = profileName || data.defaultProfile || config.profileNames(data)[0];
  if (!name || !data.profiles[name]) throw new Error('no profile configured. Run: cldz --config');
  const p = data.profiles[name];
  const env = buildEnv({ ...p });
  if (isIsolated(p)) env[agentDef(agentOf(p)).configDirEnv] = sessionDir(name, p);
  process.stdout.write(paint(c.dim, `# profile "${name}" (${agentDef(agentOf(p)).label})\n`));
  for (const [k, v] of Object.entries(env)) {
    const secret = /TOKEN|KEY/.test(k);
    process.stdout.write(`export ${k}=${secret ? mask(v) : v}\n`);
  }
}

function shellQuote(v) {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

// Raw, unmasked `export VAR=...` lines for `eval "$(cldz --print-env <name>)"`.
// Exposes secrets in plaintext by design (that's the point of eval).
function printEnvRaw(profileName) {
  const data = config.load();
  const name = profileName || data.defaultProfile || config.profileNames(data)[0];
  if (!name || !data.profiles[name]) throw new Error('no profile configured. Run: cldz --config');
  const p = data.profiles[name];
  const env = buildEnv({ ...p });
  if (isIsolated(p)) env[agentDef(agentOf(p)).configDirEnv] = sessionDir(name, p);
  for (const [k, v] of Object.entries(env)) {
    process.stdout.write(`export ${k}=${shellQuote(v)}\n`);
  }
}

// Build an exportable snapshot. Secrets are omitted unless withSecrets.
function buildExport(data, withSecrets) {
  const out = {
    version: config.CONFIG_VERSION,
    defaultProfile: data.defaultProfile || null,
    shareHistory: data.shareHistory === true,
    skipPermissions: data.skipPermissions === true,
    profiles: {},
  };
  for (const [name, p] of Object.entries(data.profiles)) {
    const secretKeys = new Set(typeDef(p.type).fields.filter((f) => f.secret).map((f) => f.key));
    const clean = {};
    for (const [k, v] of Object.entries(p)) {
      if (secretKeys.has(k) && !withSecrets) continue;
      clean[k] = v;
    }
    out.profiles[name] = clean;
  }
  return out;
}

function exportConfig({ file, withSecrets } = {}) {
  const data = config.load();
  const json = JSON.stringify(buildExport(data, withSecrets), null, 2) + '\n';
  if (!file) {
    process.stdout.write(json);
    return;
  }
  fs.writeFileSync(file, json, { mode: 0o600 });
  const n = config.profileNames(data).length;
  process.stdout.write(
    paint(c.green, `✓ Exported ${n} profile(s) to ${file}`) +
      (withSecrets ? paint(c.yellow, ' (includes secrets — keep it safe!)') : paint(c.dim, ' (secrets omitted)')) +
      '\n'
  );
}

// Merge profiles from a file. Existing profiles are skipped unless force.
// Global settings: shareHistory is restored; skipPermissions is NOT auto-enabled
// via import (safety — it must be turned on explicitly).
function importConfig({ file, force } = {}) {
  if (!file) throw new Error('usage: cldz --import <file> [--force]');
  let incoming;
  try {
    incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read import file "${file}": ${e.message}`);
  }
  if (!incoming || typeof incoming !== 'object' || !incoming.profiles || typeof incoming.profiles !== 'object') {
    throw new Error('import file has no "profiles" object');
  }
  const data = config.load();
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  for (const [name, p] of Object.entries(incoming.profiles)) {
    if (data.profiles[name] && !force) {
      skipped++;
      continue;
    }
    if (data.profiles[name]) replaced++;
    else added++;
    data.profiles[name] = p;
  }
  if (!data.defaultProfile && incoming.defaultProfile && data.profiles[incoming.defaultProfile]) {
    data.defaultProfile = incoming.defaultProfile;
  }
  if (typeof incoming.shareHistory === 'boolean') data.shareHistory = incoming.shareHistory;
  config.save(data);
  process.stdout.write(
    paint(c.green, `✓ Imported: ${added} added, ${replaced} replaced, ${skipped} skipped`) +
      (skipped ? paint(c.dim, ' (use --force to overwrite existing)') : '') +
      '\n'
  );
}

module.exports = { manage, listProfiles, showCurrent, showEnv, printEnvRaw, exportConfig, importConfig, chooseProfile };
