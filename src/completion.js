'use strict';

// Flags offered by completion (kept in sync with the CLI).
const FLAGS = [
  '--config', '--list', '--current', '--whoami', '--use', '--set-default',
  '--add', '--edit', '--rename', '--remove', '--env', '--print-env',
  '--doctor', '--agent', '--profile', '--dry-run', '--completion',
  '--version', '--help', '--json', '--all', '--default', '--type', '--set', '--unset', '--args',
];
const TYPES = ['subscription', 'apiKey', 'oauth', 'gateway', 'bedrock', 'vertex', 'codexSubscription', 'codexApiKey'];
// Flags whose value is a profile name.
const PROFILE_FLAGS = ['-P', '--profile', '--use', '--set-default', '--remove', '--delete', '--edit', '--rename', '--env', '--print-env'];

function bashScript() {
  return `# cldz bash completion — add to ~/.bashrc:  eval "$(cldz --completion bash)"
_cldz() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    ${PROFILE_FLAGS.join('|')})
      COMPREPLY=( $(compgen -W "$(cldz --profile-names 2>/dev/null)" -- "$cur") ); return;;
    --agent) COMPREPLY=( $(compgen -W "claude codex" -- "$cur") ); return;;
    --completion) COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") ); return;;
    --type) COMPREPLY=( $(compgen -W "${TYPES.join(' ')}" -- "$cur") ); return;;
  esac
  COMPREPLY=( $(compgen -W "${FLAGS.join(' ')}" -- "$cur") )
}
complete -F _cldz cldz cldzz
`;
}

function zshScript() {
  // Reuse the bash function via bashcompinit for simplicity and parity.
  return `# cldz zsh completion — add to ~/.zshrc:  eval "$(cldz --completion zsh)"
autoload -U +X bashcompinit 2>/dev/null && bashcompinit 2>/dev/null
${bashScript()}`;
}

function fishScript() {
  const lines = [
    '# cldz fish completion — save to ~/.config/fish/completions/cldz.fish:  cldz --completion fish > ~/.config/fish/completions/cldz.fish',
    'complete -c cldz -f',
    'complete -c cldzz -f',
  ];
  for (const f of FLAGS) {
    const long = f.replace(/^--/, '');
    lines.push(`complete -c cldz -l ${long}`);
  }
  lines.push(`complete -c cldz -l agent -a "claude codex"`);
  lines.push(`complete -c cldz -l type -a "${TYPES.join(' ')}"`);
  lines.push(`complete -c cldz -l completion -a "bash zsh fish"`);
  // Profile-name values for -P/--profile.
  lines.push(`complete -c cldz -s P -a "(cldz --profile-names)"`);
  lines.push(`complete -c cldz -l profile -a "(cldz --profile-names)"`);
  return lines.join('\n') + '\n';
}

function printScript(shell) {
  switch (shell) {
    case 'bash':
      return bashScript();
    case 'zsh':
      return zshScript();
    case 'fish':
      return fishScript();
    default:
      throw new Error('usage: cldz --completion <bash|zsh|fish>');
  }
}

module.exports = { printScript, FLAGS, TYPES };
