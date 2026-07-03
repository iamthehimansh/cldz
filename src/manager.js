'use strict';

const config = require('./config.js');
const { typeDef, buildEnv } = require('./auth.js');
const { sessionDir } = require('./run.js');
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
    const iso = p.isolate === false ? '  ' + paint(c.yellow, '(shared login)') : '';
    process.stdout.write(`  ${paint(c.bold, name)}  ${paint(c.dim, def.label)}${star}${iso}\n`);
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
    process.stdout.write('\n');

    const action = await tty.select('What would you like to do?', [
      { name: 'Add a profile', value: 'add' },
      { name: 'Edit a profile', value: 'edit' },
      { name: 'Delete a profile', value: 'delete' },
      { name: 'Set default profile', value: 'default' },
      { name: 'Rename a profile', value: 'rename' },
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
function listProfiles() {
  const data = config.load();
  process.stdout.write(paint(c.bold, 'Profiles') + '  ' + paint(c.dim, config.configPath()) + '\n');
  printProfiles(data);
}

function showEnv(profileName) {
  const data = config.load();
  const name = profileName || data.defaultProfile || config.profileNames(data)[0];
  if (!name || !data.profiles[name]) throw new Error('no profile configured. Run: cldz --config');
  const p = data.profiles[name];
  const env = buildEnv({ ...p });
  if (p.isolate !== false) env.CLAUDE_CONFIG_DIR = sessionDir(name, p);
  process.stdout.write(paint(c.dim, `# profile "${name}"\n`));
  for (const [k, v] of Object.entries(env)) {
    const secret = /TOKEN|KEY/.test(k);
    process.stdout.write(`export ${k}=${secret ? mask(v) : v}\n`);
  }
}

module.exports = { manage, listProfiles, showEnv, chooseProfile };
