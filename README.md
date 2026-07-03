# cldz

A one-command launcher for [Claude Code](https://claude.com/claude-code). Pick an
authentication method **once** — API key, OAuth token, a custom gateway, Amazon
Bedrock, or Google Vertex AI — then just run `cldz`. It sets the right
environment variables and hands off to `claude`, passing through any arguments.

```bash
npx cldzz        # first run walks you through setup, then launches Claude Code
```

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

## Auth methods

| Method | Env vars it sets |
| --- | --- |
| **API key** | `ANTHROPIC_API_KEY` |
| **OAuth token** (Pro / Max, from `claude setup-token`) | `CLAUDE_CODE_OAUTH_TOKEN` |
| **Custom gateway / proxy** | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` |
| **Amazon Bedrock** | `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, `AWS_PROFILE` |
| **Google Vertex AI** | `CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION` |

## Usage

```bash
cldz                         # launch with your default profile
cldz -P work                 # launch with the "work" profile
cldz -P work "fix the bug"   # extra args pass straight to claude
cldz --dangerously-skip-permissions   # any claude flag passes through
cldz -- --help               # force everything after -- through to claude
```

## Managing profiles

```bash
cldz --config                # interactive: add / edit / delete / rename / set-default
cldz --list                  # list saved profiles
cldz --set-default work       # set the default profile
cldz --remove old             # delete a profile
cldz --env work               # show the env vars a profile sets (secrets masked)
cldz --doctor                 # check your setup
```

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

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CLDZ_HOME` | Override the config directory (default `~/.cldz`) |
| `CLDZ_CLAUDE_BIN` | Path to the `claude` binary (default `claude`) |
| `CLDZ_PROFILE` | Default profile name to use |
| `CLAUDE_CONFIG_DIR` | If set, cldz respects it instead of the per-profile isolated dir |

## Requirements

- Node.js >= 18
- [Claude Code](https://claude.com/claude-code) installed (`npm i -g @anthropic-ai/claude-code`)

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
