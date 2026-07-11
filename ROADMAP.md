# cldz roadmap / autonomous work state

This file is the working state for autonomous iterations. Each wake-up: read this,
do the next unchecked item, test (`node test/smoke.js`), commit, update this file.

## Rules for autonomous iterations
- Commit every milestone to git (reversible). Keep changes small.
- Only `npm publish` when `node test/smoke.js` passes AND a feature milestone is complete.
- Never commit secrets. Scrub any temp `.npmrc`/tokens.
- Real API-call tests are fine but keep them minimal (1 short prompt).
- If something is experimental/unverified, mark it clearly, don't ship it as "works".

## Phases

### Phase 1 — multi-agent + subscription profiles  ✅ DONE (v0.2.0)
- [x] Investigate codex CLI + ~/.codex/auth.json
- [x] `agent` field on profiles: `claude` | `codex` (src/agents.js)
- [x] `subscription` auth type (Claude default login — no token, shared login)
- [x] Codex agent launch: `codexSubscription` (ambient ~/.codex) + `codexApiKey` (OPENAI_API_KEY)
- [x] Wizard/manager/list/env/doctor updated for agent + new types
- [x] Smoke tests for all new cases (16 checks, incl. real claude+codex launch)
- [x] Publish milestone → 0.2.0

### Phase 2 — shared history across everything  ✅ DONE
- [x] Link all claude profiles + main ~/.claude — verified (smoke #9)
- [x] Codex history sharing when isolated (link to ~/.codex) — verified (smoke #15)

### Phase 3 — cross-subscription (EXPERIMENTAL)
- [x] "Codex with Codex subscription" (launch codex) — done in Phase 1 (codexSubscription)
- Research: **Switchyard** (https://github.com/NVIDIA-NeMo/Switchyard)
  - Python proxy: `pip install "nemo-switchyard[cli,server]"`, `switchyard serve --config profiles.yaml --port 4000`.
  - Translates OpenAI <-> Anthropic Messages <-> OpenAI Responses. Serves OpenAI-compatible paths (/v1/chat/completions).
  - Config = YAML: endpoints (base_url + api key via ${ENV}), targets (model+format), profiles (routing).
  - OPEN QUESTIONS to resolve before building:
    1. Does it expose an **Anthropic-format INBOUND** endpoint so Claude Code's
       ANTHROPIC_BASE_URL can point at it? (need /v1/messages inbound -> OpenAI outbound)
    2. Can a target use the **ChatGPT/Codex backend** (JWT access_token + `chatgpt-account-id`
       header + Responses API), not just plain OpenAI api keys? Custom-header support?
    3. Token refresh: ~/.codex/auth.json access_token is short-lived; refresh via refresh_token.
  - PLAN (only ship if it verifiably works end-to-end):
    - New profile type `claudeViaCodex` (agent=claude): cldz generates profiles.yaml from
      ~/.codex/auth.json, spawns `switchyard serve` on a free port, sets
      ANTHROPIC_BASE_URL=http://localhost:PORT + ANTHROPIC_AUTH_TOKEN, launches claude,
      and tears down the proxy on exit. Requires python3 + switchyard (doctor should check).
    - Keep it OPTIONAL/experimental; cldz stays zero-dep for the core.
  - FINDING (2026-07-11, installed & inspected v via venv):
    - Switchyard HAS an Anthropic-inbound endpoint (anthropic_messages_endpoint.py) ✅ (Q1 yes).
    - `switchyard launch claude` exists (proxy + spawn claude, ollama-style) ✅.
    - BUT backends are base_url + api_key only; built-ins are anthropic.com / api.openai.com /
      openrouter. **No ChatGPT-subscription backend, no `chatgpt-account-id` header support** (Q2 NO).
    - User's ~/.codex/auth.json has **no OPENAI_API_KEY** (pure ChatGPT subscription tokens).
    - CONCLUSION: Switchyard CANNOT bridge Claude Code to the Codex/ChatGPT *subscription*.
      It only bridges to standard API-key providers (OpenAI/OpenRouter/Anthropic).
    - POLICY: routing a ChatGPT subscription into a non-ChatGPT tool also violates OpenAI ToS.
      => Do NOT ship a subscription bridge. Mark BLOCKED / won't-fix for the subscription case.
  - ACHIEVABLE (optional, needs user's own OpenRouter/OpenAI key — NOT the subscription):
    "Claude Code on OpenAI/OpenRouter models via Switchyard". Could be a future opt-in
    profile type `claudeViaProxy` that manages `switchyard launch claude`. Deferred unless
    the user asks — it needs a python dep and their API key, and isn't the subscription.
- [x] "Codex with Codex subscription" already works (Phase 1). "Claude on Codex sub" = BLOCKED (above).
- [ ] Refresh-token handling — moot for the subscription bridge (blocked).
- GitHub research (2026-07-11, user asked to search):
  - Anthropic-inbound -> ChatGPT/Codex SUBSCRIPTION backends exist:
    insightflo/chatgpt-codex-proxy (/v1/messages -> ChatGPT Codex backend),
    Securiteru/codex-openai-proxy, icebear0828/codex-proxy, Soju06/codex-lb,
    heyhuynhgiabuu/proxypal. These CAN bridge Claude Code to a ChatGPT sub, BUT
    that violates OpenAI ToS -> cldz will NOT automate/endorse it. Not blocked
    technically anymore, but a policy no-go. Documented in README Notes.
  - Claude-Code-as-backend / routers: musistudio/claude-code-router (popular),
    glidea/claude-worker-proxy. These are Anthropic-compatible proxies.
  - KEY POINT: cldz's existing `gateway` type ALREADY points Claude Code at ANY
    Anthropic-compatible proxy (Switchyard / claude-code-router / etc.) via
    ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN — verified with --dry-run. So the
    LEGIT "Claude on OpenAI models via Switchyard (OpenAI API key)" path needs NO
    new cldz code — just a gateway profile. README now has a proxy recipe.

### Phase 4 — polish & feature brainstorm (add tests for each)
- [x] `cldz doctor` checks both claude and codex (v0.2.0)
- [x] profile status/current command: `--current` / `--whoami` (v0.3.0)
- [x] `cldz --use <name>` quick default switch (v0.3.0)
- [x] `cldz --list --json` for scripting (v0.3.0)
- [x] import existing auth (detect ANTHROPIC_API_KEY / OPENAI_API_KEY / ~/.codex / ~/.claude) on first run (v0.4.0)
- [x] `cldz --print-env` shell-eval mode (raw exports, no masking) (v0.5.0)
- [x] per-profile default args/model (wizard `args` field, prepended before user args) (v0.5.0)
- [x] `cldz --agent codex|claude ...` shortcut — launch an agent ad-hoc on its ambient login (v0.6.0)
- [x] warn when a stored codex access_token is expired (decode JWT exp; shown in doctor + at launch) (v0.6.0)

**Phase 4 COMPLETE.** Next: brainstormed features (see below), each with a smoke test.

## Feature brainstorm (Phase 5 backlog — implement top items, each with a smoke test)
- [x] Non-interactive profile mgmt: `--add <name> --type <t> [--set k=v] [--args] [--default]`, `--rename`, `--rm` (v0.7.0)
- [x] `--edit <name>` non-interactive field updates (--type/--set/--unset/--args/--default) (v0.8.0)
- [x] `--current --json` (machine-readable active profile) (v0.8.0)
- [x] `--version --all` (also prints claude + codex versions) (v0.8.0)
- [x] `doctor` per-profile credential-resolves check (v0.9.0)
- [x] `cldz --dry-run` prints the launch plan (agent, command, config dir, masked env) without launching (v0.9.0)
- [x] Config schema versioning/migration — lossless migrate() + forward-compat (v0.10.0)
- [x] Shell completion: `cldz --completion bash|zsh|fish` (+ hidden --profile-names) (v0.10.0)

**Phase 5 COMPLETE.**

## Phase 6 — extras (each with a smoke test)
- [x] `cldz --export [file] [--with-secrets]` / `--import <file> [--force]` — backup/restore; secrets omitted by default (v0.11.0)
- [x] per-profile `description` — `--desc`/`--set description=`, shown in --list + --current (v0.12.0)
- [x] `CLDZ_NO_ISOLATION=1` env to force-disable isolation for a run (v0.12.0)
- [x] `cldz --path` prints the config file path (v0.12.0)

**Phase 6 COMPLETE.** cldz is feature-rich; further ticks: hardening/polish (e.g. `--completion`
for the new flags, more real-launch tests, README polish), or idle until the user returns
with an npm token. Keep tests green.
- [ ] `cldz --version --all` also prints claude + codex versions.
- [ ] `doctor` per-profile: for each profile, report whether its credential source resolves.
- [ ] `cldz --rename <old> <new>` non-interactive.
DONE from earlier backlog: import creds ✅, ls --json ✅, default args ✅, whoami ✅, use ✅, codex token expiry ✅.

## ⚠️ NOTES FOR USER (when you return)
- **npm token expired** (401 on whoami as of 2026-07-10). Everything is committed &
  pushed to GitHub, but **npm publishing is paused** — versions 0.2.0+ are NOT on
  npm yet. Give me a fresh granular token (publish + bypass-2FA) and I'll publish
  the backlog of versions. GitHub `main` is the source of truth meanwhile.
- Still pending your OTP: unpublish `cldz-cli`.

## Version log
- 0.1.3 — skip-permissions setting (published ✅)
- 0.2.0 — multi-agent (claude+codex) + subscription profiles (pushed to git; NOT on npm — token expired)
- 0.3.0 — --current/--whoami, --use, --list --json; Phase 2 verified (git only; npm paused)
- 0.4.0 — first-run credential auto-import; Phase 3 subscription bridge BLOCKED/won't-fix (git only)
- 0.5.0 — --print-env (eval mode) + per-profile default args (git only; npm paused)
- 0.6.0 — --agent ad-hoc shortcut + codex token-expiry warning; Phase 4 complete (git only; npm paused)
- 0.7.0 — non-interactive --add / --rename profile mgmt (git only; npm paused)
- 0.8.0 — --edit + --current --json + --version --all (git only; npm paused)
- 0.9.0 — doctor per-profile credential check + --dry-run (git only; npm paused)
- 0.10.0 — config migration framework + shell completion; Phase 5 complete (git only; npm paused)
- 0.11.0 — --export / --import config backup & restore (secret-safe) (git only; npm paused)
- 0.12.0 — per-profile description + CLDZ_NO_ISOLATION + --path; Phase 6 complete (git only; npm paused)
- 0.12.1 — shell completion covers newer flags (--export/--import/--path/--desc/etc.); coverage test (git only; npm paused)
- 0.12.2 — regression test: all read-only commands exit 0 on empty config (git only; npm paused)
- 0.12.3 — FIX: --config Save & exit hung on open stdin (now closes tty); regression test (git only; npm paused)

## Autonomous-iteration note
- Do NOT retry `npm publish` — token is dead until the user rotates it. Keep
  committing + pushing to GitHub; CI runs there. Skip the publish step.
