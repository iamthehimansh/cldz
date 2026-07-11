# Running either agent on either provider (cldz)

cldz can run **Claude Code** and **Codex** against **API keys** from either
provider. This is the supported, in-scope way to mix agents and models.

> **Not covered here:** using a *subscription* (Claude Pro/Max, or ChatGPT/Codex)
> to power the *other* tool. That relies on unofficial proxies / session-token
> replay and is against the providers' terms of service, so cldz doesn't do it and
> this doc doesn't describe how. Use **API keys** (billed per token) for
> cross-provider, or each agent on its own subscription.

## 1. Codex on OpenAI (native)

```bash
cldz --add oai --type api --provider openai --agent codex --set apiKey=$OPENAI_API_KEY
cldz -P oai
```

## 2. Claude Code on OpenAI models (via Switchyard proxy, your OpenAI API key)

Claude Code speaks the Anthropic API, so an Anthropic↔OpenAI proxy sits in front.
cldz launches [Switchyard](https://github.com/NVIDIA-NeMo/Switchyard) for you and
tears it down when the agent exits.

```bash
pip install "nemo-switchyard[cli,server]"      # one-time
cldz --add oai --type api --provider openai --agent claude --set apiKey=$OPENAI_API_KEY --model gpt-4o
cldz -P oai                                    # Claude Code, talking to gpt-4o
cldz --dry-run -P oai                          # see the exact command + backend
```

Switch agents on the same key with `--agent`:

```bash
cldz -P oai --agent codex     # codex on the same OpenAI key (native, no proxy)
```

## 3. Claude Code / Codex on their own API keys

```bash
cldz --add anth --type api --provider anthropic --agent claude --set apiKey=$ANTHROPIC_API_KEY
cldz --add cx   --type codexApiKey --set openaiKey=$OPENAI_API_KEY
```

## 4. Codex sign-in (its own official token login)

For a separate/isolated Codex account, use Codex's own headless auth — cldz just
wires up the per-profile `CODEX_HOME`; the tokens go into **Codex's** auth file,
never cldz's config:

```bash
cldz --add work-codex --type codexSubscription --set isolate=true
cldz --login -P work-codex                                   # interactive `codex login`
printenv CODEX_ACCESS_TOKEN | cldz --login -P work-codex --with-access-token
cldz --login -P work-codex --auth-json /path/to/auth.json    # full auth.json (codex refreshes it)
```

## 5. Point cldz at a proxy you run yourself

cldz's `gateway` type points Claude Code at **any** Anthropic-compatible endpoint:

```bash
cldz --add gw --type gateway --set baseUrl=http://localhost:4000 --set authToken=$KEY --args "--model X"
```

What runs behind that URL is your choice and your responsibility. There are
open-source proxies in this space (e.g.
[claude-code-router](https://github.com/musistudio/claude-code-router)); read each
project's own docs and confirm your usage complies with the relevant provider's
terms before pointing anything at it. cldz stays neutral — it only sets
`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`; it never stores or replays
subscription session tokens.
