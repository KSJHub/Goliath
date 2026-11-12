# Goliath AI — private developer chat (DEV foundation)

This feature is **not a public module**. The UI lives at `/owner/ai` within the existing Owner Control dashboard. Its server controller lives in `src/owner/dev/goliathAI.js`.

## Security and current scope
- DEV-only local inference. The chat returns HTTP 503 unless `GOLIATH_AI_ENABLED=true`.
- Both owner accounts must be configured in Goliath's existing owner ID environment variables. The AI API **fails closed** unless there are exactly two distinct configured owner IDs, and the active Discord session matches one.
- Owner API access is also enforced by the existing `requireDashboardAccess('/api/owner/ai')` middleware.
- Only JSON same-origin POST requests are accepted; no API key is embedded in the browser.
- The AI inference endpoint is hard-coded to localhost (`127.0.0.1:8081`) and does not call ChatGPT, Codex or paid model services.
- One request at a time, a 90-second deadline, small conversation/message caps.
- Read-only Discord audit is available for guilds connected to the DEV bot, and to BETA/PRODUCTION only after explicitly deploying their read-only service endpoints, even if the model is disabled. It inventories roles, channels, categories, overwrites and unsynchronised child channels; no mutations are performed.
- No command execution, Discord mutations, PC controls, external browsing, model tool calls or persisted chat history yet. The AI is expressly instructed not to claim actions it cannot perform.
- No automatic model download or process startup. DEV code deployment alone does not begin inference.

## Future VPS setup (manual, only after measuring resources)
1. Verify the two owner IDs are the expected personal Discord accounts; **do not publish the IDs, tokens or env files**.
2. Measure *peak* free memory, CPU headroom and disk capacity while all Goliath services run.
3. Choose a free, permissively licensed CPU-friendly GGUF instruct model. Verify its licence and measure quality and speed before accepting it.
4. Run a separate, memory/cpu-limited `llama.cpp` server bound to `127.0.0.1:8081`, with its OpenAI-compatible `/v1/chat/completions` API enabled; do not expose that port publicly.
5. Set `GOLIATH_AI_MODEL` to the actual loaded model identifier and `GOLIATH_AI_ENABLED=true` **only in the DEV environment**; restart DEV after the model works locally.
6. Verify that both authorised accounts can chat, and every other authenticated/unauthenticated account is denied by the backend.
7. Load-test alongside Goliath and configure independent system-level service limits, auto-restart and a manual kill switch.

## Operational notes
This is a foundation, **not** a completed autonomous AI or 24/7 guaranteed service. Reliability depends on the separately managed inference service, VPS load, uptime and configured operating-system limits. Future Discord and Windows integrations must have their own permission checks, action previews, approval gates and audit trails. Do not grant remote shell access or arbitrary command execution through AI chat.

## Discord rebuild workflow
1. In Developer/Owner Tools, open **Goliath AI** and select **Discord Server Audit**.
2. Select a server connected to the **DEV bot**, and run **Scan permissions**. If the desired KSJ server is not shown, it is not accessible to this DEV instance; do not switch environments or copy tokens to work around that.
3. Review the role/channel inventory and unsynchronised permissions before proposing a staged rebuild. No existing server changes are made by this audit.
4. Future AI-assisted edits must first show a per-item diff, request explicit owner confirmation, record backups and implement rollback.

## Global guild scope (DEV, BETA and PRODUCTION)
- Goliath AI remains **one private controller**, hosted in DEV. There is no need to run three language models.
- The owner dashboard lists guilds by `ENVIRONMENT:guildId`; newly connected guilds appear on the next inventory refresh/reopen.
- Each runtime provides its own **read-only** `/api/owner/ai/guilds/local` and `/api/owner/ai/audit/local/:guildId` endpoints once this change is deliberately promoted into that runtime.
- The DEV controller talks only to `127.0.0.1` ports 3001/3011/3021 with the existing `OWNER_INTERNAL_TOKEN`, and requires the same strong shared token on each environment. Routes reject untrusted remote requests. Do not expose the internal ports publicly.
- BETA and PRODUCTION are deliberately **not automatically updated** by a DEV commit. Promote the tested read-only feature separately when authorised; until then the UI correctly reports those environments as unavailable.
- A `/owner` button links the two configured bot-owner accounts to the developer AI dashboard. Conversation directly inside a Discord slash-command interaction is not yet implemented; the link provides entry from `/owner`.
- Do not allow guild admins, managers or other Discord server owners to reach the AI endpoints. Future actions must be gated to the two owner IDs independently of server administrator rights.
- Any future **write** action (especially across production guilds) must use explicit environment+guild targeting, a fresh permission snapshot, a human-readable diff, backup, owner approval, rate limiting, and a comprehensive audit log. The read-only endpoints here cannot change guild settings.

## Read-only permission findings (foundation)
Every environment audit now calculates deterministic review findings on its own connected guild data. Checks currently include:
- Elevated base @everyone permissions (high priority)
- Administrator roles and Manage Roles assignments (review)
- Child channel permission overwrites that differ from parent categories (review, may be intentional)
- Individual member overwrites (informational)
Findings do not establish wrongdoing or a vulnerability; the developer must review Discord's effective role hierarchy and context. The report has a 200-item display cap but returns totals, and never changes any Discord setting.

The dashboard has an explicit **Refresh servers** control so newly joined guilds can be discovered without a rebuild. This requires the corresponding environment's read-only endpoints to be present. AI chat is separate and still requires a free local model process.

## Non-executable rebuild preview
After scanning a guild, the private owner dashboard offers **Prepare proposed changes (preview only)**. The server rereads the selected `environment + guild ID` and returns a non-executable, read-only preview. This does not require the language model to be installed.
- For elevated `@everyone` permissions, the preview shows an illustrative removal of listed elevated permission bits and the precise before/after permission bitfields.
- For Administrator roles, the preview deliberately recommends manual verification rather than automatic changes.
- For channel/category overwrite mismatches, the preview shows how overwrites would differ if synchronised. It warns that intentional exceptions could be lost.
- No apply, write, delete or rollback endpoints were added. No Discord mutation functions run in this path.
- A future apply engine must be implemented separately, with per-guild permissions, fresh-state validation, lock, snapshot backup, exact diff, owner approval, execution receipts and rollback handling. Never execute this illustrative proposal without those protections.

## Private model readiness check
Use **Goliath AI → Check local AI connection** to query the private DEV health route `GET /api/owner/ai/health`. It probes `127.0.0.1:8081/v1/models` with a 2.5-second timeout. This checks for a reachable model service and a loaded model, but it does not confirm response quality. There is no automatic install, chat inference or change to the enable switch.

Possible states include `not-installed-or-offline`, `offline`, `backend-error`, `no-model`, `disabled`, and `ready`. Only the `ready` state permits the initial chat test; a successful generated response is still required to verify end-to-end operation.

**Activation is blocked until VPS operations can be performed.** The connected GitHub tool can update source but cannot execute commands or install software on the Revive Node VPS. Have an authorised operator measure available resources, start the separately limited local inference service, confirm it is bound to loopback, verify the two owner IDs and token consistency, and set `GOLIATH_AI_ENABLED=true` only when testing is safe. Do not install or start models inside the bot's PM2 process. Promotions to BETA and PRODUCTION are separate owner-approved operations.

## VPS model activation runbook (manual operator, not run by GitHub sync)

**Candidate:** official `Qwen/Qwen2.5-1.5B-Instruct-GGUF`, `Q4_K_M` (~1.12 GB GGUF), Apache-2.0. Model card: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF. This is an initial trial, **not** a guarantee of ChatGPT-class reasoning. The model itself costs no inference fees.

**Safety gates:**
1. Confirm Goliath's DEV dashboard deployment and backend build are healthy before installing anything.
2. Measure available RAM, CPU and storage at idle and under load. The prior screenshots were only a point-in-time sample.
3. Reserve memory for Goliath production, beta, DEV, and websites. Stop the test if RAM pressure, swap, OOM events or request latency rises.
4. Do **not** install the model into `/home/goliath/dev`, `src/runtime`, the Git repository or Goliath's PM2 process. Run it as a separate, constrained operating-system service after the trial.
5. Confirm an up-to-date, trusted llama.cpp installation. Examine the official install instructions before running an installer downloaded from the internet.
6. Bind **only** to `127.0.0.1:8081`. Never expose the inference port through nginx or the host firewall.

### Manual trial (interactive terminal, deliberately not persistent)

Official install option from the model card (review the official source/installer before running):

```bash
curl -LsSf https://llama.app/install.sh | sh
```

Open a fresh terminal or refresh the shell environment as instructed by the installer, and verify `llama --help` works. Start a low-concurrency test:

```bash
llama serve -hf Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8081 \
  --ctx-size 2048 --threads 2 --parallel 1 \
  --alias local-model --no-webui
```

This command is **only** an initial manual trial. It is not yet constrained by an OS memory cgroup. Monitor usage while running; stop immediately if VPS headroom becomes insufficient. Confirm the supported options using `llama serve --help` for the installed version.

From another terminal session:

```bash
curl --fail --silent http://127.0.0.1:8081/v1/models
```

The response should list `local-model`; then send a minimal **local-only** test generation:

```bash
curl --fail --silent --max-time 90 http://127.0.0.1:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"local-model","messages":[{"role":"user","content":"Reply with: Goliath AI model connected."}],"max_tokens":64}'
```

Only after the model is responsive, under acceptable CPU/RAM load, and the DEV app is verified:
- Set `GOLIATH_AI_MODEL=local-model` and `GOLIATH_AI_ENABLED=true` in the **DEV-only** environment configuration, and restart only Goliath DEV using its existing deployment procedure.
- Recheck **Goliath AI → Check local AI connection**, then test the first chat message.
- Turn the test off by setting `GOLIATH_AI_ENABLED=false` in DEV and stopping the model process. A future persistent systemd service must have memory/CPU limits and auto-restart; do not enable automatic startup until those are verified.

**Important:** The AI is deliberately hosted in DEV as one shared developer-only controller. Cross-environment audits for BETA and PRODUCTION depend on *separately* promoting the read-only endpoints; never promote this DEV code automatically to all environments. The AI cannot write to Discord or control a PC yet.

**References:** https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md and official Qwen model card above.
