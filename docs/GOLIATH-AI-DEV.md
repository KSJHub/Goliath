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

## Discord category/channel layout blueprints
This stage adds a **non-executable, developer-only** layout planning workflow usable before any AI model is installed.

1. Choose the intended `ENVIRONMENT — Server` in Owner → Goliath AI.
2. Run **Scan permissions** to capture a fresh inventory.
3. Open **Server Layout Blueprint** and press **Load current layout**. The current category/channel structure is returned as editable JSON, retaining channel IDs for safe identification.
4. Use the guided **Add a new category** control to add a category and lines of channels (`general | text`, `voice-lounge | voice`), or edit the JSON manually. Use `text`, `voice`, `forum`, `announcement`, or `stage`.
5. Press **Preview layout changes**. The backend reads fresh guild data and proposes `create_category`, `create_channel`, `rename_category`, and `edit_channel` operations with explicit `environment`, `guild ID`, and before/after values.
6. Use **Export JSON blueprint** to preserve the design locally. Exporting does not upload or write it to Discord.

**Preservation rules:** Nothing is deleted or executed. Existing IDs can be used to rename/reparent identifiable objects; absent IDs use exact matching within the correct category. Unlisted existing channels are left untouched. Reparenting can change effective access and must receive manual permission review. Permissions, roles, messages, and channel history are not modified. The future execution engine must not treat this design preview as an authorisation.

**Input validation:** Maximum 40 categories, 300 channels, 350 planned operations. Duplicate Discord IDs, unsupported types, malformed names, missing current IDs and ambiguous current name matches fail closed. No arbitrary Discord API method or action string is accepted from the browser.

**Validation:** The pure planner has a standalone contract test at `npm run test:goliath-ai-blueprint` covering unchanged layouts, proposed rename/create operations, preservation, invalid types and duplicate IDs. This test does not require a bot token, VPS or Discord access.

**Known limitations:** The starter layout includes channels inside existing categories, not uncategorised channels; uncategorised channels remain untouched by default. The builder is a blueprint editor, not yet a drag-and-drop channel designer. Long-term server-side plan storage and approved execution still require a separate safety review.

## AI-generated category drafts (disabled until local model is installed)
The **Ask Goliath AI to draft new categories** text area uses `POST /api/owner/ai/blueprint/ai-draft`. This is available only to the two configured owner accounts and only when `GOLIATH_AI_ENABLED=true` in DEV. It sends a short plain-English design request to the loopback model, and asks for a narrow JSON shape containing **new categories and channels only**.

Server-side validation rechecks the model output using `parseBlueprint()`; no model-generated Discord IDs, API calls, permissions, deletions, or existing-guild mutations are accepted. Output is limited to eight categories and forty channels, and existing category names are skipped when suggestions are added to the editable client-side blueprint. The owner must then explicitly preview the proposed changes against fresh live guild data. If the small model returns invalid JSON, the interface displays an error and offers the manual builder.

**No server-side execution exists.** A successful AI draft or preview is not approval to modify an actual public guild. Chat requests and draft generation share a single in-process concurrency guard. Model use is subject to the existing local inference service's resource restrictions and failure behavior.

## Testing and deployment status
`npm run test:goliath-ai-blueprint` is included in the existing `npm run doctor` validation chain, so subsequent normal DEV builds should run the pure, no-token blueprint contract checks. This repository change itself does not prove that GitHub Actions or the live DEV deployment succeeded. The React dashboard must still be built by the existing deployment workflow and inspected in a browser. BETA and PRODUCTION read-only endpoints must be promoted intentionally; the model and full Goliath AI interface remain controlled from DEV.

## Latest no-terminal development pass — readiness boundary
- Added a standalone pure blueprint planner and owner-only REST endpoints to load an existing guild structure and preview a custom layout against a fresh guild audit. Every planned operation is `executable:false`.
- Added editable layout JSON, a guided new-category builder, a guided add-channel-to-existing-category builder, and client-side JSON import/export for resumable workflows. Import/export does **not** save files on the VPS or Discord.
- Added an optional local-model-assisted **new-category draft** tool; this stays disabled until model inference is installed and enabled. All model output is validated and is never executed.
- Added audit SHA-256 fingerprints to plan responses plus `approvalRequired:true` and `backupRequiredBeforeExecution:true`, to support future stale-plan checks; fingerprints are identifiers, **not authorisation signatures**.
- Tightened validation: no more than 40 blueprint categories, 50 channels per category, 300 channels per blueprint, 350 operations, or 500 projected total Discord channels; repeated channel name/type pairs and IDs fail closed.
- Added pure planner contract checks to the existing `npm run doctor` chain. Sample tests were evaluated in an isolated JS runner; a real Node/Vite build and DEV VPS smoke test are still required.

**Still intentionally missing:** GitHub Actions deployment verification, a locally installed CPU inference model, a tested `/owner` in-Discord conversational interface (current `/owner` entry opens the dashboard), BETA/PRODUCTION promotion of the read-only endpoints, persistent drafts, and an execution/backup/approval/rollback pipeline. Never enable write actions on public guilds before those safety gates and tests are complete. DEV code commits alone do not establish live runtime readiness.

## Private saved plans and owner review (no execution)

The DEV Goliath AI Owner dashboard now supports **Save current blueprint**, **Load**, **Mark reviewed**, **Delete draft** and **Refresh drafts** after selecting and auditing a guild. These actions are intentionally *not* Discord mutations.

**Storage:** saved plans are maintained in the environment-local Goliath runtime data directory at `src/runtime/dev/data/goliath-ai-drafts.json` (resolved through `getRuntimePaths('DEV')`). This is runtime storage, not a new GitHub-tracked configuration. Writes are atomic via a temporary file and rename and restricted to the DEV process. Limit: 30 saved plans, 1 MiB total storage. Access is restricted to the same two configured bot owner accounts, and the data is shared between those two accounts.

**Security workflow:**
- `POST /api/owner/ai/drafts`: validate the owner session, environment, guild ID, blueprint and title; obtain a fresh read-only server audit, run the pure layout preview, compute a SHA-256 audit fingerprint and save a draft. If the caller supplied a preview fingerprint and the live guild changed, reject with HTTP 409. No Discord change occurs.
- `GET /api/owner/ai/drafts` and `GET /api/owner/ai/drafts/:id`: list and load private draft metadata/blueprint for the two owners.
- `POST /api/owner/ai/drafts/:id/review`: require a fresh matching guild audit and matching fingerprint; record the reviewing owner's ID and timestamp. This is a **review acknowledgement, NOT approval to execute** and never changes Discord.
- `DELETE /api/owner/ai/drafts/:id`: remove a saved draft only. Does not remove any Discord categories, channels, roles or messages.

Changing an existing draft in the editor does not overwrite stored history: save a new revision. If the guild has changed since the stored fingerprint, create and review a new preview and draft. The audit hash detects snapshot differences but is not a cryptographic signature, authorization token, or backup.

**Future write execution remains disabled.** An approved execution engine would require a fresh Discord backup and rollback verification, per-operation confirmation, bot role-hierarchy/permission checks, independent execution approval, scoped audit logs and failure recovery. Do not use this reviewed state alone to authorise a Discord write. BETA and PRODUCTION require the explicitly promoted read-only audit integration.

**Validation:** the existing `npm run test:goliath-ai-blueprint` now includes temporary-file saved-draft tests (create/load/review/stale detection/delete/DEV gate). Storage was also exercised with a mocked filesystem in the coding environment; full local Node/Vite and live DEV deployment remain unverified.

## Execution-readiness diagnostics (no Discord writes)
A saved plan now exposes `GET /api/owner/ai/drafts/:id/readiness` to the two verified developers through the DEV Owner dashboard. **Check execution readiness** retrieves a fresh audit from the draft's exact environment and guild, calculates the current blueprint difference, and provides a checklist of safeguards.

The report shows owner/guild scope, audit fingerprint freshness, whether a developer has marked the draft reviewed, bot permissions and role hierarchy (pending), verified backup (pending), per-operation approval (pending), rollback (pending), and execution engine (disabled). Every proposed operation is explicitly `executable:false`. The response **always** sets `canExecute:false`, even if all currently measurable checks pass.

This is diagnostic scaffolding only; it must not be interpreted as permission to write to DEV, BETA or PRODUCTION guilds. No execute/apply endpoint, backup execution, rollback executor or automatic Discord mutation was added. Before introducing a real execution engine, require independent reviewed plan approval tied to a fresh digest, verified immutable backup/restore, bot capabilities, safe dry-run diff, explicit operation-level owner authorisation, scoped logging, rate limiting and tested failure recovery.

The standard blueprint contract suite now tests blocked readiness, stale fingerprints, wrong guild targets and non-executable operation flags. A full CI/Vite build and live environment verification remain outstanding.

## Existing Backup Center integration (read-only)
Saved-plan execution-readiness reports now query Goliath's **existing Owner Backup Center** via the local, internal-token-protected endpoint `/api/owner/backups/local` on the matching bot environment. This does not create backups, request restores, or run Discord operations.

The DEV controller filters the returned recent backup entries by both `environment` and `guildId`, then shows limited metadata: backup ID, creation date, backup type, roles/channels counts, whether integrity metadata exists, whether the existing backup scanner reported valid, and blocker count. The Backup Center returns only a recent subset; absence of a matching entry **does not** prove that no historical backup exists.

**Important:** A file listed as valid or with integrity metadata has *not* been proven restorable for the selected plan. The readiness report always leaves `backup` as **pending**, `canExecute:false`, and `executable:false`; neither existing backups nor reviewed drafts enable execution. If the target runtime or authenticated internal owner endpoint cannot be contacted, backup evidence is `unavailable` and no optimistic assumption is made. No runtime backup folder paths or internal token values are surfaced in the AI panel.

Future promotion requires a backup created immediately before execution, independently revalidated by the existing restore subsystem, a tested rollback plan, fresh digest, exact operation approvals and an execution audit. BETA/PRODUCTION remain untouched until separately promoted and tested.

The blueprint contract test suite also verifies that even a backup candidate carrying positive integrity metadata never unlocks Discord writes.

## Operation-level developer acknowledgements and review history (DEV only)
A separate owner review ledger now records scoped, temporary **review acknowledgements**, not execution approvals. The REST endpoints are `GET /api/owner/ai/drafts/:id/operation-reviews` and `POST /api/owner/ai/drafts/:id/operation-reviews` (body: integer `sequence` and `decision` of `acknowledged` or `rejected`).

A new review can be added only when:
- The caller is one of the two configured, authenticated developer accounts;
- The stored blueprint is marked reviewed, belongs to the requested guild/environment, and the freshly obtained audit fingerprint matches the saved fingerprint;
- The exact operation still exists at the specified one-based sequence in a fresh, non-executable blueprint preview.

The ledger stores the draft ID, DEV/BETA/PRODUCTION target environment, guild ID, exact operation hash, reviewer Discord account ID, decision, timestamp and a 30-minute expiration. Operations must have `executable:false` to be reviewable. Events are appended and not overwritten; the latest unexpired decision from a reviewer is used for display. A rejected operation remains flagged for attention. A changed operation, changed blueprint or changed audit digest invalidates a prior acknowledgement.

Storage is in DEV runtime data `src/runtime/dev/data/goliath-ai-operation-reviews.json`, capped at 300 events/512 KiB; exceeding the cap fails closed. No token, model provider, Discord write, restore request or executable operation is created. These records are NOT signed execution grants, and the readiness report deliberately keeps the `per_operation_approval` check pending and `canExecute:false`. They remain review history, not a complete tamper-evident compliance audit. A future true approval system must be designed separately with authorisation-bound signatures, immutable audit storage, expiry, operation-level confirmation and permission checks immediately before execution.

The DEV dashboard now supports **Operation reviews**, **Acknowledge review**, **Reject proposal** and **Review audit history**. The existing blueprint contract checks include stale-plan rejection, review-before-operation requirement, rejection precedence, operation binding and append-only event history. The full Vite build and live DEV deployment still require verification.

## Discord bot permission / recovery preflight (read-only)
Saved-plan readiness now checks the bot's effective channel permissions for the exact `environment + guild ID`, without performing Discord writes. The protected internal endpoint `GET /api/owner/ai/capabilities/local/:guildId` is available only to loopback callers carrying the existing verified internal owner token; the DEV owner controller queries the corresponding environment. A missing environment endpoint or unavailable bot member fails closed.

The pure `goliathCapabilityPreflight` module reports each planned category/channel operation as `blocked`, `unknown` or `permitted-in-principle`. It checks Manage Channels in the bot's guild and effective channel/category permissions where relevant, validates existing target IDs and required parents, rejects unsupported operation kinds, and warns when a move could change access. These are advisory permission estimates and **not** execution grants: Discord permission hierarchy, source/destination interactions, dynamic role changes, rate limits and API errors must be rechecked immediately before any future write.

Each operation also shows its recovery implications. Edits could require compensating changes based on before-state; compensating deletes of created channels/categories can themselves destroy messages or configuration. **No tested rollback exists**, and all reports retain `rollbackVerified:false`, `executable:false`, `canExecute:false`. The owner dashboard exposes these findings through the saved plan's **Check execution readiness** panel.

New contract tests cover missing permissions, wrong-environment snapshots, unknown channel permissions, unsupported destructive operations, and unchanged no-execution guarantees. The full Vite build, VPS deployment and BETA/PRODUCTION audit endpoint promotion still remain outstanding.

## Read-only rollback planning after green DEV build
The saved-plan `/drafts/:id/readiness` response now includes `recoveryPlan`, generated from the saved draft, its exact target environment/guild, current audited digest and proposed operations. The Owner AI readiness screen displays each operation's original fields, proposed changes, recovery type and non-reversible side effects.

- Rename/edit proposals identify the original fields a future compensating edit would need.
- Create proposals never suggest automatic deletion as a harmless undo: messages, children and later configuration may have been added after creation.
- New-category channel references by name are flagged because a future executor would need the generated Discord category ID.
- Channel reparenting warns about inherited permissions and visibility.
- Unknown operation kinds get no recovery definition.
- Stale snapshots remain identified and are not authorisation to take action.

This is **not a backup or rollback implementation**. The response always sets `canRollback:false`, `rollbackTested:false`, and `executable:false`. Existing bot capability, backup and operation-review safeguards remain in place; all Discord write endpoints are still absent. Recovery contracts are included in the canonical `scripts/goliath.js goliath-ai-blueprint` checks. No separate scripts or test folders were added.
