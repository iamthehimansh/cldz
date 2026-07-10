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

### Phase 2 — shared history across everything
- [ ] Link all claude profiles + main ~/.claude (done) — verify explicitly
- [ ] Codex history sharing when isolated (link to ~/.codex)

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
  - NEXT ACTION for iteration: read Switchyard README/docs deeper (WebFetch the docs/
    examples pages) to answer Q1/Q2, then prototype profiles.yaml + a manual curl test
    against the ChatGPT backend before wiring into cldz.
- [ ] Refresh-token handling (access_token is short-lived, rotates)

### Phase 4 — polish & feature brainstorm (add tests for each)
- [ ] `cldz doctor` checks both claude and codex
- [ ] `cldz --agent codex ...` shortcut
- [ ] profile status/current command
- [ ] `cldz --print-env`/shell eval mode
- [ ] import existing auth (detect ANTHROPIC_API_KEY / ~/.codex) on first run
- [ ] more (see FEATURES section, expand each iteration)

## Feature brainstorm (backlog — refine & implement top items)
- Detect & offer to import creds already in env or ~/.codex/~/.claude on first run.
- `cldz ls --json` for scripting.
- Per-profile default model / args (e.g. always `--model opus`).
- `cldz whoami` — show which account/profile a token maps to.
- Quick switch: `cldz use <profile>` sets default.
- Health: warn when a stored codex access_token is expired (check exp in JWT).

## ⚠️ NOTES FOR USER (when you return)
- **npm token expired** (401 on whoami as of 2026-07-10). Everything is committed &
  pushed to GitHub, but **npm publishing is paused** — versions 0.2.0+ are NOT on
  npm yet. Give me a fresh granular token (publish + bypass-2FA) and I'll publish
  the backlog of versions. GitHub `main` is the source of truth meanwhile.
- Still pending your OTP: unpublish `cldz-cli`.

## Version log
- 0.1.3 — skip-permissions setting (published ✅)
- 0.2.0 — multi-agent (claude+codex) + subscription profiles (pushed to git; NOT on npm — token expired)

## Autonomous-iteration note
- Do NOT retry `npm publish` — token is dead until the user rotates it. Keep
  committing + pushing to GitHub; CI runs there. Skip the publish step.
