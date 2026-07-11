# cldz

A one-command launcher for [Claude Code](https://claude.com/claude-code). Pick an
authentication method **once** — API key, OAuth token, a custom gateway, Amazon
Bedrock, or Google Vertex AI — then just run `cldz`. It sets the right
environment variables and hands off to `claude`, passing through any arguments.

```bash
npx cldzz        # first run walks you through setup, then launches Claude Code
```

On first run, cldz **detects credentials you already have** — `$ANTHROPIC_API_KEY`,
`$CLAUDE_CODE_OAUTH_TOKEN`, `$OPENAI_API_KEY`, and existing `~/.claude` / `~/.codex`
logins — and offers to create matching profiles for you.

Or install it globally:

```bash
npm install -g cldzz
cldz             # or: cldzz  (both commands do the same thing)
```

> The npm package is **`cldzz`**. Installing it gives you two equivalent commands: **`cldz`** and **`cldzz`**.

## Why

Running Claude Code with different credentials normally means remembering and
exporting the right environment variables every time:

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # or
export CLAUDE_CODE_OAUTH_TOKEN=...         # or
export CLAUDE_CODE_USE_BEDROCK=1 AWS_REGION=us-east-1
claude
```

`cldz` remembers your choices in `~/.cldz/config.json` and does that for you.

## Agents

Each profile launches one **agent** CLI:

- **Claude Code** (default) — `claude`
- **Codex** — `codex` (isolation relocates `CODEX_HOME`; binary override `CLDZ_CODEX_BIN`)

So you can keep, say, a Claude subscription profile, a Claude API-key profile, and
a Codex/ChatGPT subscription profile side by side and switch with `cldz -P <name>`.

## Auth methods

| Method | Agent | Env vars it sets |
| --- | --- | --- |
| **Claude subscription** (default login) | Claude | *(none — uses your `~/.claude` login)* |
| **API key** | Claude | `ANTHROPIC_API_KEY` |
| **OAuth token** (Pro / Max, from `claude setup-token`) | Claude | `CLAUDE_CODE_OAUTH_TOKEN` |
| **Custom gateway / proxy** | Claude | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` |
| **Amazon Bedrock** | Claude | `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, `AWS_PROFILE` |
| **Google Vertex AI** | Claude | `CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION` |
| **Codex / ChatGPT subscription** (default login) | Codex | *(none — uses your `~/.codex` login)* |
| **OpenAI API key** | Codex | `OPENAI_API_KEY` |

The **subscription** types use your existing login (nothing injected, not
isolated). Everything else isolates per profile by default.

## Usage

```bash
cldz                         # launch with your default profile
cldz -P work                 # launch with the "work" profile
cldz -P work "fix the bug"   # extra args pass straight to claude
cldz --agent codex "..."          # run codex ad-hoc on its login (no profile)
cldz --dangerously-skip-permissions   # any claude flag passes through
cldz -- --help               # force everything after -- through to claude
```

## Settings

`cldz --config` also has two global toggles:

- **Shared history** — see [Session isolation](#session-isolation) below.
- **Skip permissions** — when on, cldz always launches `claude` with
  `--dangerously-skip-permissions` (claude runs tools without asking for
  approval). You confirm once when enabling it; it's off by default. You can still
  pass the flag manually per-run — cldz won't duplicate it.

## Managing profiles

```bash
cldz --config                # interactive: add / edit / delete / rename / set-default
cldz --list                  # list saved profiles
cldz --set-default work       # set the default profile
cldz --remove old             # delete a profile
cldz --env work               # show the env vars a profile sets (secrets masked)
cldz --print-env work         # raw exports for: eval "$(cldz --print-env work)"
cldz --current                # show the active profile + settings (alias --whoami)
cldz --use work               # set the default profile
cldz --list --json            # machine-readable profile list
cldz --doctor                 # check your setup (per-profile credential status)
cldz --dry-run -P work        # print what would launch, without launching
cldz --completion zsh         # shell completion: eval "$(cldz --completion zsh)"
```

Each profile can also carry **default args** always passed to the agent (set in
the wizard, e.g. `--model opus`); args you pass on the command line are appended
and take precedence.

The `--config` menu lets you add multiple named profiles, edit them, delete them,
rename them, and choose which one is the default.

## Credential storage

- When you opt in during setup, secrets are saved to `~/.cldz/config.json`
  (written with `0600` permissions). On Windows this is `%USERPROFILE%\.cldz\config.json`.
- If you'd rather **not** store a secret, decline the "save the secret?" prompt.
  `cldz` will then read it from the environment each run.
- **A matching environment variable always overrides the saved value at run time.**
  So you can keep a profile for its type/region settings and inject the secret from
  your shell or a secrets manager:

  ```bash
  ANTHROPIC_API_KEY=sk-ant-xxxx cldz -P work
  ```

## Session isolation

By default, each profile launches `claude` with its **own** `CLAUDE_CONFIG_DIR`
at `~/.cldz/sessions/<profile>/`. This matters:

- **The profile's credential is guaranteed to be the one used.** If you're already
  logged into Claude Code normally, that stored login would otherwise take
  precedence over an injected token — isolation prevents that.
- Each profile gets its own separate session, history, and settings. Your main
  `~/.claude` login is never touched.

To avoid a fresh profile dropping you into Claude Code's first-run onboarding
(the "Select login method" screen), cldz seeds the profile's dir with the
onboarding-complete flag, so it launches straight in — authenticated by the
profile's own credential. You may still see Claude's normal per-folder "trust
this folder?" prompt the first time you use a directory.

You can turn isolation off for a profile in `cldz --config` (it will then share
your main `~/.claude`), or set `CLAUDE_CONFIG_DIR` yourself to override where it
points.

### Shared history

Because each isolated profile has its own dir, by default `/history` and
`--resume` only show that profile's own conversations — not the chats you started
with plain `claude` or under a different profile.

Turn on **Shared history** in `cldz --config` (the "Shared history: turn ON"
option) to fix that. It links each profile's conversation history
(`projects/`, `history.jsonl`, `todos/`, `shell-snapshots/`) back to your main
`~/.claude`, so **every profile — and plain `claude` — shares one history** while
credentials stay isolated. Existing profiles are linked immediately (their
current sessions are merged into `~/.claude`). On Windows this uses directory
junctions (no admin needed).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CLDZ_HOME` | Override the config directory (default `~/.cldz`) |
| `CLDZ_CLAUDE_BIN` | Path to the `claude` binary (default `claude`) |
| `CLDZ_PROFILE` | Default profile name to use |
| `CLAUDE_CONFIG_DIR` | If set, cldz respects it instead of the per-profile isolated dir |
| `CLDZ_NO_ISOLATION` | If set (=1), disables per-profile isolation for the run (use ambient login) |
| `CLDZ_CODEX_BIN` | Path to the `codex` binary (default `codex`) |

## Running Claude Code on non-Anthropic models (via a proxy)

Claude Code speaks the Anthropic API, so to run it on OpenAI (or other) models you
put an **Anthropic-compatible translation proxy** in front and point a `gateway`
profile at it. cldz supports this out of the box — no special mode:

```bash
# 1. Run a proxy that exposes an Anthropic /v1/messages endpoint backed by OpenAI.
#    e.g. Switchyard (NVIDIA-NeMo/Switchyard): pip install "nemo-switchyard[cli,server]"
#    Configure it with your OpenAI API key and start it on a local port.

# 2. Point a cldz gateway profile at the proxy:
cldz --add openai --type gateway \
  --set baseUrl=http://localhost:4000 \
  --set authToken=$OPENAI_API_KEY \
  --args "--model gpt-4o"
cldz -P openai        # Claude Code, now talking to OpenAI models through the proxy
```

Any Anthropic-compatible proxy works the same way (e.g.
[musistudio/claude-code-router](https://github.com/musistudio/claude-code-router),
[Switchyard](https://github.com/NVIDIA-NeMo/Switchyard)). Use `cldz --dry-run -P openai`
to see exactly what will launch.

## Notes

- **Can I run Claude Code on my ChatGPT/Codex *subscription*?** cldz does not do this.
  There are community proxies that route a ChatGPT/Codex subscription into other
  clients, but using a subscription outside OpenAI's official apps is against
  OpenAI's terms of service, so cldz won't automate it. For non-Anthropic models,
  use an **OpenAI API key** (billed per token) with the proxy recipe above.
- cldz lets you run **Codex on your Codex subscription** and **Claude Code on your
  Claude subscription/keys/gateway** side by side — switch with `cldz -P <name>`.

## Requirements

- Node.js >= 18
- [Claude Code](https://claude.com/claude-code) installed (`npm i -g @anthropic-ai/claude-code`)
- For Codex profiles: the Codex CLI installed

## Platform support

- **macOS & Linux** — developed and tested here.
- **Windows** — written to be cross-platform (config lands at
  `%USERPROFILE%\.cldz\config.json`, launches via the `claude` shim) and covered
  by a CI smoke test on `windows-latest`. **However, it has not been extensively
  tested on Windows** — please [report any issues](https://github.com/iamthehimansh/cldz/issues).
  Two Windows caveats to be aware of:
  - Passthrough arguments containing spaces or shell metacharacters may need extra
    quoting (Claude Code is launched through the shell on Windows).
  - The `0600` permission on `config.json` is a no-op on Windows; the file relies
    on your user profile's ACL. Prefer injecting sensitive keys via environment
    variables rather than storing them if that matters to you.

## Support & Contributing

Questions, bug reports, and contributions are welcome.

- **Support / bugs:** email [iamthehimansh@gmail.com](mailto:iamthehimansh@gmail.com)
- **Contributing:** PRs and issues are welcome. Please include steps to reproduce
  for bugs, and keep the CLI dependency-free (it intentionally ships with zero
  runtime dependencies). Run the CLI locally with `node bin/cldz.js` while developing.

## License

MIT © [iamthehimansh](mailto:iamthehimansh@gmail.com)

MIT
