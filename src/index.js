'use strict';

const { execFileSync } = require('node:child_process');
const config = require('./config.js');
const manager = require('./manager.js');
const { run } = require('./run.js');
const tty = require('./tty.js');
const { paint, colors: c } = tty;

const pkg = require('../package.json');

function printVersion() {
  process.stdout.write(`cldz ${pkg.version}\n`);
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
  cldz -- <claude args>           Force everything through to claude (e.g. -- --help)

${b('MANAGEMENT')}
  cldz --config                   Interactive: add / edit / delete / set-default
  cldz --list                     List saved profiles
  cldz --set-default <name>       Set the default profile
  cldz --remove <name>            Delete a profile
  cldz --env [name]               Print the env vars a profile sets (secrets masked)
  cldz --doctor                   Check your setup
  cldz --help                     Show this help
  cldz --version                  Show version

${b('ISOLATION')}
  By default each profile runs claude with its own CLAUDE_CONFIG_DIR
  (~/.cldz/sessions/<profile>/), so the profile's credential is the one used and
  your main ~/.claude login is untouched. Opt out per profile via ${b('cldz --config')}.

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

  const bin = process.env.CLDZ_CLAUDE_BIN || 'claude';
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    process.stdout.write(ok(`claude found: ${out.trim()}`) + '\n');
  } catch {
    process.stdout.write(
      warn(`could not run "${bin} --version". Install it: npm i -g @anthropic-ai/claude-code`) + '\n'
    );
  }

  const data = config.load();
  const names = config.profileNames(data);
  if (!names.length) {
    process.stdout.write(warn('no profiles configured yet — run: cldz --config') + '\n');
  } else {
    process.stdout.write(ok(`${names.length} profile(s): ${names.join(', ')}`) + '\n');
    process.stdout.write(ok(`default profile: ${data.defaultProfile || '(none)'}`) + '\n');
  }
  process.stdout.write(paint(c.dim, `config: ${config.configPath()}\n`));
}

// Parse argv into { command, profile, claudeArgs, rest }.
function parse(argv) {
  // Explicit force-passthrough: `cldz -- <claude args>`
  if (argv[0] === '--') {
    return { command: 'run', claudeArgs: argv.slice(1) };
  }

  const first = argv[0];

  // Strip a `--profile` / `-P` selector wherever it appears before `--`.
  let profile = process.env.CLDZ_PROFILE || undefined;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      // Everything after is passthrough; keep the marker so we can strip it later.
      rest.push(...argv.slice(i));
      break;
    }
    if (a === '--profile' || a === '-P') {
      profile = argv[++i];
      continue;
    }
    if (a.startsWith('--profile=')) {
      profile = a.slice('--profile='.length);
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
      return { command: 'list' };
    case '--env':
      return { command: 'env', profile: argv[1] };
    case '--doctor':
      return { command: 'doctor' };
    case '--set-default':
      return { command: 'set-default', name: argv[1] };
    case '--remove':
    case '--delete':
      return { command: 'remove', name: argv[1] };
    case '--help':
    case '-h':
      return { command: 'help' };
    case '--version':
    case '-V':
      return { command: 'version' };
    default:
      break;
  }

  // Run path: strip a leading `--` passthrough marker if present.
  let claudeArgs = rest;
  const dd = claudeArgs.indexOf('--');
  if (dd !== -1) claudeArgs = [...claudeArgs.slice(0, dd), ...claudeArgs.slice(dd + 1)];
  return { command: 'run', profile, claudeArgs };
}

async function main(argv) {
  const parsed = parse(argv);

  switch (parsed.command) {
    case 'help':
      return printHelp();
    case 'version':
      return printVersion();
    case 'doctor':
      return doctor();
    case 'config':
      return manager.manage();
    case 'list':
      return manager.listProfiles();
    case 'env':
      return manager.showEnv(parsed.profile);
    case 'set-default': {
      if (!parsed.name) throw new Error('usage: cldz --set-default <name>');
      const data = config.load();
      if (!data.profiles[parsed.name]) throw new Error(`profile "${parsed.name}" not found`);
      config.setDefault(data, parsed.name);
      config.save(data);
      process.stdout.write(paint(c.green, `✓ Default profile is now "${parsed.name}".\n`));
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
      return run({ profile: parsed.profile, claudeArgs: parsed.claudeArgs || [] });
  }
}

module.exports = { main, parse };
