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
- [ ] "Codex with Codex subscription" (trivial: launch codex) — covered by Phase 1
- [ ] "Claude Code with Codex/ChatGPT subscription": needs an Anthropic<->OpenAI
      translation proxy using access_token + chatgpt-account-id header.
      Research feasibility; build a minimal local proxy ONLY if it verifiably works.
      Token source: ~/.codex/auth.json .tokens.access_token / .account_id / .refresh_token
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

## Version log
- 0.1.3 — skip-permissions setting (published)
- 0.2.0 — target: multi-agent + subscription profiles
