'use strict';

// The CLIs cldz can launch. Each profile targets one agent. The agent decides
// which binary to run, which env var relocates its config/session dir (for
// isolation), and where its shared home lives.
const AGENTS = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    binEnv: 'CLDZ_CLAUDE_BIN',
    configDirEnv: 'CLAUDE_CONFIG_DIR',
    homeDir: '.claude',
    seedOnboarding: true, // seed hasCompletedOnboarding in a fresh isolated dir
    // Conversation state to share back to the main home when sharing is on.
    sharedEntries: [
      { name: 'projects', file: false },
      { name: 'history.jsonl', file: true },
      { name: 'todos', file: false },
      { name: 'shell-snapshots', file: false },
    ],
    installHint: 'npm install -g @anthropic-ai/claude-code',
  },
  codex: {
    label: 'Codex',
    bin: 'codex',
    binEnv: 'CLDZ_CODEX_BIN',
    configDirEnv: 'CODEX_HOME',
    homeDir: '.codex',
    seedOnboarding: false,
    // sessions/ = rollout transcripts; session_index.jsonl = the index the
    // `codex resume` picker reads (needed so cross-profile chats actually show up);
    // history.jsonl = prompt history.
    sharedEntries: [
      { name: 'sessions', file: false },
      { name: 'session_index.jsonl', file: true },
      { name: 'history.jsonl', file: true },
    ],
    installHint: 'install the Codex CLI (see its docs)',
  },
};

const DEFAULT_AGENT = 'claude';

function agentDef(agent) {
  return AGENTS[agent || DEFAULT_AGENT] || AGENTS[DEFAULT_AGENT];
}

module.exports = { AGENTS, DEFAULT_AGENT, agentDef };
