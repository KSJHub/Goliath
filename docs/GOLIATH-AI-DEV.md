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
