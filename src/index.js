'use strict';

const { execFileSync } = require('node:child_process');
const config = require('./config.js');
const manager = require('./manager.js');
const { run, login } = require('./run.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

const pkg = require('../package.json');

function printVersion(all) {
  process.stdout.write(`cldz ${pkg.version}\n`);
  if (!all) return;
  const { AGENTS } = require('./agents.js');
  for (const def of Object.values(AGENTS)) {
    const bin = process.env[def.binEnv] || def.bin;
    let ver = 'not found';
    try {
      ver = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* not installed */
    }
    process.stdout.write(`${def.label}: ${ver}\n`);
  }
}

function printHelp() {
  const b = (s) => paint(c.bold, s);
  process.stdout.write(`
${b('cldz')} — a one-command launcher for Claude Code.

Pick an auth method once (API key / OAuth / gateway / Bedrock / Vertex),
then just run ${b('cldz')}. Any extra arguments are passed straight to ${b('claude')}.

${b('USAGE')}
  cldz [claude args...]           Launch Claude Code with your default profile
  cldz -P <name> [claude args]    Launch using a specific profile
  cldz --agent codex [args]       Launch an agent ad-hoc on its ambient login (claude|codex)
  cldz --login -P <name>          Sign in to a profile's account (native login in its own dir)
  cldz --dry-run [-P name]        Print what would launch (agent, command, env) without running
  cldz -- <claude args>           Force everything through to claude (e.g. -- --help)

${b('MANAGEMENT')}
  cldz --config                   Interactive: add / edit / delete / set-default
  cldz --list [--json]            List saved profiles (--json for scripting)
  cldz --current                  Show the active profile + settings (alias --whoami)
  cldz --use <name>               Set the default profile (alias --set-default)
  cldz --add <name> --type <t>    Create a profile non-interactively
                                    [--set k=v] [--args "…"] [--default]
  cldz --add <name> --type api --provider anthropic|openai --agent claude|codex [--model M]
                                  Unified API profile: run either agent on either provider's API
                                    (cldz auto-proxies via Switchyard when they differ)
  cldz --edit <name> [...]        Update a profile [--type][--set k=v][--unset k][--args][--default]
  cldz --rename <old> <new>       Rename a profile
  cldz --remove <name>            Delete a profile
  cldz --env [name]               Print the env vars a profile sets (secrets masked)
  cldz --print-env [name]         Raw exports for eval "$(cldz --print-env)" (unmasked)
  cldz --doctor                   Check your setup
  cldz --path                     Print the config file path
  cldz --export [file]            Back up config (secrets omitted; --with-secrets to include)
  cldz --import <file> [--force]  Restore/merge profiles from a backup
  cldz --completion bash|zsh|fish Print a shell-completion script
  cldz --help                     Show this help
  cldz --version [--all]          Show version (--all: also claude + codex)

${b('ISOLATION')}
  By default each profile runs claude with its own CLAUDE_CONFIG_DIR
  (~/.cldz/sessions/<profile>/), so the profile's credential is the one used and
  your main ~/.claude login is untouched. Opt out per profile via ${b('cldz --config')}.
  Enable "Shared history" there to make /history and --resume span all profiles
  and your main ~/.claude. Enable "Skip permissions" to always launch claude with
  --dangerously-skip-permissions.

${b('ENVIRONMENT')}
  A matching env var always overrides the saved value at run time, e.g.
  ${paint(c.dim, 'ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_BASE_URL,')}
  ${paint(c.dim, 'ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX')}

  CLDZ_HOME         Override config dir (default: ~/.cldz)
  CLDZ_CLAUDE_BIN   Path to the claude binary (default: claude)
  CLDZ_PROFILE      Default profile name to use

Config is stored at ${paint(c.dim, config.configPath())}
`);
}

function doctor() {
  const ok = (s) => paint(c.green, '✓ ') + s;
  const warn = (s) => paint(c.yellow, '! ') + s;

  process.stdout.write(paint(c.bold, 'cldz doctor\n\n'));
  process.stdout.write(ok(`node ${process.version}`) + '\n');

  const { AGENTS } = require('./agents.js');
  for (const [key, def] of Object.entries(AGENTS)) {
    const bin = process.env[def.binEnv] || def.bin;
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      process.stdout.write(ok(`${def.label} found: ${out.trim()}`) + '\n');
    } catch {
      process.stdout.write(warn(`${def.label} (${key}) not found — ${def.installHint}`) + '\n');
    }
  }

  // Switchyard (only needed for cross-provider `api` profiles).
  {
    const sw = process.env.CLDZ_SWITCHYARD_BIN || 'switchyard';
    try {
      execFileSync(sw, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      process.stdout.write(ok('Switchyard found (enables cross-provider api profiles)') + '\n');
    } catch {
      process.stdout.write(
        paint(c.dim, '· Switchyard not installed — only needed to run an agent on the "other" provider\'s API.\n' +
          '  Install if needed: pip install "nemo-switchyard[cli,server]"\n')
      );
    }
  }

  // Codex token health (if a ~/.codex login exists).
  const { codexTokenInfo } = require('./codextoken.js');
  const tok = codexTokenInfo();
  if (tok.present && tok.hasToken && tok.exp) {
    if (tok.expired) {
      process.stdout.write(warn('Codex access token is expired — re-login with `codex` if auth fails') + '\n');
    } else {
      const mins = Math.round(tok.secondsLeft / 60);
      process.stdout.write(ok(`Codex access token valid (~${mins} min left)`) + '\n');
    }
  }

  const data = config.load();
  const names = config.profileNames(data);
  if (!names.length) {
    process.stdout.write(warn('no profiles configured yet — run: cldz --config') + '\n');
  } else {
    process.stdout.write(ok(`${names.length} profile(s), default: ${data.defaultProfile || '(none)'}`) + '\n');
    const { profileReadiness } = require('./run.js');
    for (const n of names) {
      const rd = profileReadiness(data.profiles[n]);
      if (rd.ready) {
        process.stdout.write('  ' + ok(`${n}: credentials resolve`) + '\n');
      } else {
        process.stdout.write('  ' + warn(`${n}: missing ${rd.missing.join(', ')} (set it or store it in the profile)`) + '\n');
      }
    }
  }
  process.stdout.write(paint(c.dim, `config: ${config.configPath()}\n`));
}

// `cldz --add <name> --type <t> [--set k=v ...] [--args "..."] [--default]`
function parseAdd(argv) {
  const opts = { command: 'add', name: undefined, type: undefined, sets: {}, argsStr: undefined, makeDefault: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') opts.type = argv[++i];
    else if (a.startsWith('--type=')) opts.type = a.slice('--type='.length);
    else if (a === '--args') opts.argsStr = argv[++i];
    else if (a.startsWith('--args=')) opts.argsStr = a.slice('--args='.length);
    else if (a === '--set') {
      const kv = argv[++i] || '';
      const eq = kv.indexOf('=');
      if (eq > 0) opts.sets[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === '--desc') opts.sets.description = argv[++i];
    else if (a.startsWith('--desc=')) opts.sets.description = a.slice('--desc='.length);
    else if (a === '--provider') opts.sets.provider = argv[++i];
    else if (a === '--agent') opts.sets.agent = argv[++i];
    else if (a === '--model') opts.sets.model = argv[++i];
    else if (a === '--default') opts.makeDefault = true;
    else if (!a.startsWith('-') && opts.name === undefined) opts.name = a;
  }
  return opts;
}

// `cldz --edit <name> [--type t] [--set k=v] [--unset k] [--args "…"] [--default]`
function parseEdit(argv) {
  const opts = { command: 'edit', name: undefined, type: undefined, sets: {}, unsets: [], argsStr: undefined, makeDefault: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') opts.type = argv[++i];
    else if (a.startsWith('--type=')) opts.type = a.slice('--type='.length);
    else if (a === '--args') opts.argsStr = argv[++i];
    else if (a.startsWith('--args=')) opts.argsStr = a.slice('--args='.length);
    else if (a === '--set') {
      const kv = argv[++i] || '';
      const eq = kv.indexOf('=');
      if (eq > 0) opts.sets[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === '--unset') opts.unsets.push(argv[++i]);
    else if (a === '--desc') opts.sets.description = argv[++i];
    else if (a.startsWith('--desc=')) opts.sets.description = a.slice('--desc='.length);
    else if (a === '--provider') opts.sets.provider = argv[++i];
    else if (a === '--agent') opts.sets.agent = argv[++i];
    else if (a === '--model') opts.sets.model = argv[++i];
    else if (a === '--default') opts.makeDefault = true;
    else if (!a.startsWith('-') && opts.name === undefined) opts.name = a;
  }
  return opts;
}

// Parse argv into { command, profile, claudeArgs, rest }.
function parse(argv) {
  // Explicit force-passthrough: `cldz -- <claude args>`
  if (argv[0] === '--') {
    return { command: 'run', claudeArgs: argv.slice(1) };
  }

  const first = argv[0];

  // Non-interactive profile management (parsed specially).
  if (first === '--add') return parseAdd(argv);
  if (first === '--edit') return parseEdit(argv);
  if (first === '--rename') return { command: 'rename', name: argv[1], name2: argv[2] };

  // Strip `--profile`/`-P` and `--agent`/`-A` selectors wherever they appear
  // before `--`.
  let profile = process.env.CLDZ_PROFILE || undefined;
  let agent;
  let dryRun = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      // Everything after is passthrough; keep the marker so we can strip it later.
      rest.push(...argv.slice(i));
      break;
    }
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--profile' || a === '-P') {
      profile = argv[++i];
      continue;
    }
    if (a.startsWith('--profile=')) {
      profile = a.slice('--profile='.length);
      continue;
    }
    if (a === '--agent' || a === '-A') {
      agent = argv[++i];
      continue;
    }
    if (a.startsWith('--agent=')) {
      agent = a.slice('--agent='.length);
      continue;
    }
    rest.push(a);
  }

  // Recognize cldz management flags only when they lead the command.
  switch (first) {
    case '--config':
      return { command: 'config' };
    case '--list':
    case '--profiles':
      return { command: 'list', json: rest.includes('--json') };
    case '--env':
      return { command: 'env', profile: argv[1] };
    case '--print-env':
      return { command: 'print-env', profile: argv[1] };
    case '--doctor':
      return { command: 'doctor' };
    case '--completion':
      return { command: 'completion', shell: argv[1] };
    case '--profile-names':
      return { command: 'profile-names' };
    case '--path':
      return { command: 'path' };
    case '--export':
      return { command: 'export', file: argv.slice(1).find((a) => !a.startsWith('-')), withSecrets: argv.includes('--with-secrets') };
    case '--import':
      return { command: 'import', file: argv.slice(1).find((a) => !a.startsWith('-')), force: argv.includes('--force') };
    case '--set-default':
    case '--use':
      return { command: 'set-default', name: argv[1] };
    case '--login':
      return { command: 'login', profile };
    case '--current':
    case '--whoami':
      return { command: 'current', json: rest.includes('--json') };
    case '--remove':
    case '--delete':
      return { command: 'remove', name: argv[1] };
    case '--help':
    case '-h':
      return { command: 'help' };
    case '--version':
    case '-V':
      return { command: 'version', all: rest.includes('--all') };
    default:
      break;
  }

  // Run path: strip a leading `--` passthrough marker if present.
  let claudeArgs = rest;
  const dd = claudeArgs.indexOf('--');
  if (dd !== -1) claudeArgs = [...claudeArgs.slice(0, dd), ...claudeArgs.slice(dd + 1)];
  return { command: 'run', profile, agent, dryRun, claudeArgs };
}

async function main(argv) {
  const parsed = parse(argv);

  switch (parsed.command) {
    case 'help':
      return printHelp();
    case 'version':
      return printVersion(parsed.all);
    case 'doctor':
      return doctor();
    case 'completion':
      return process.stdout.write(require('./completion.js').printScript(parsed.shell));
    case 'profile-names': {
      const data = config.load();
      process.stdout.write(config.profileNames(data).join('\n') + '\n');
      return;
    }
    case 'path':
      return process.stdout.write(config.configPath() + '\n');
    case 'export':
      return manager.exportConfig({ file: parsed.file, withSecrets: parsed.withSecrets });
    case 'import':
      return manager.importConfig({ file: parsed.file, force: parsed.force });
    case 'config':
      return manager.manage();
    case 'list':
      return manager.listProfiles({ json: parsed.json });
    case 'login':
      return login({ profile: parsed.profile });
    case 'current':
      return manager.showCurrent({ json: parsed.json });
    case 'env':
      return manager.showEnv(parsed.profile);
    case 'print-env':
      return manager.printEnvRaw(parsed.profile);
    case 'set-default': {
      if (!parsed.name) throw new Error('usage: cldz --set-default <name>');
      const data = config.load();
      if (!data.profiles[parsed.name]) throw new Error(`profile "${parsed.name}" not found`);
      config.setDefault(data, parsed.name);
      config.save(data);
      process.stdout.write(paint(c.green, `✓ Default profile is now "${parsed.name}".\n`));
      return;
    }
    case 'add': {
      const { AUTH_TYPES, agentOf } = require('./auth.js');
      if (!parsed.name) throw new Error('usage: cldz --add <name> --type <type> [--set k=v] [--args "..."] [--default]');
      if (!parsed.type || !AUTH_TYPES[parsed.type]) {
        throw new Error(`--type must be one of: ${Object.keys(AUTH_TYPES).join(', ')}`);
      }
      const data = config.load();
      if (data.profiles[parsed.name]) throw new Error(`profile "${parsed.name}" already exists`);
      const profile = { type: parsed.type };
      for (const [k, v] of Object.entries(parsed.sets)) profile[k] = v;
      if (parsed.argsStr && parsed.argsStr.trim()) profile.args = parsed.argsStr.trim().split(/\s+/);
      data.profiles[parsed.name] = profile;
      if (parsed.makeDefault || config.profileNames(data).length === 1) config.setDefault(data, parsed.name);
      config.save(data);
      const { agentDef } = require('./agents.js');
      process.stdout.write(
        paint(c.green, `✓ Added "${parsed.name}"`) +
          paint(c.dim, ` [${agentDef(agentOf(profile)).label}] ${AUTH_TYPES[parsed.type].label}`) + '\n'
      );
      return;
    }
    case 'edit': {
      const { AUTH_TYPES } = require('./auth.js');
      if (!parsed.name) throw new Error('usage: cldz --edit <name> [--type t] [--set k=v] [--unset k] [--args "…"] [--default]');
      const data = config.load();
      const p = data.profiles[parsed.name];
      if (!p) throw new Error(`profile "${parsed.name}" not found`);
      if (parsed.type) {
        if (!AUTH_TYPES[parsed.type]) throw new Error(`--type must be one of: ${Object.keys(AUTH_TYPES).join(', ')}`);
        p.type = parsed.type;
      }
      for (const [k, v] of Object.entries(parsed.sets)) p[k] = v;
      for (const f of parsed.unsets) delete p[f];
      if (parsed.argsStr !== undefined) {
        if (parsed.argsStr.trim()) p.args = parsed.argsStr.trim().split(/\s+/);
        else delete p.args;
      }
      if (parsed.makeDefault) config.setDefault(data, parsed.name);
      config.save(data);
      process.stdout.write(paint(c.green, `✓ Updated "${parsed.name}".\n`));
      return;
    }
    case 'rename': {
      if (!parsed.name || !parsed.name2) throw new Error('usage: cldz --rename <old> <new>');
      const data = config.load();
      if (!data.profiles[parsed.name]) throw new Error(`profile "${parsed.name}" not found`);
      if (data.profiles[parsed.name2]) throw new Error(`profile "${parsed.name2}" already exists`);
      data.profiles[parsed.name2] = data.profiles[parsed.name];
      if (data.defaultProfile === parsed.name) data.defaultProfile = parsed.name2;
      delete data.profiles[parsed.name];
      config.save(data);
      process.stdout.write(paint(c.green, `✓ Renamed "${parsed.name}" → "${parsed.name2}".\n`));
      return;
    }
    case 'remove': {
      if (!parsed.name) throw new Error('usage: cldz --remove <name>');
      const data = config.load();
      if (!data.profiles[parsed.name]) throw new Error(`profile "${parsed.name}" not found`);
      config.removeProfile(data, parsed.name);
      config.save(data);
      process.stdout.write(paint(c.green, `✓ Removed "${parsed.name}".\n`));
      return;
    }
    case 'run':
    default:
      return run({
        profile: parsed.profile,
        agent: parsed.agent,
        dryRun: parsed.dryRun,
        claudeArgs: parsed.claudeArgs || [],
      });
  }
}

module.exports = { main, parse };
