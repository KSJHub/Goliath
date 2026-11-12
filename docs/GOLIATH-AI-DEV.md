# Goliath AI — private developer chat (DEV foundation)

This feature is **not a public module**. The UI lives at `/owner/ai` within the existing Owner Control dashboard. Its server controller lives in `src/owner/dev/goliathAI.js`.

## Security and current scope
- DEV-only local inference. The chat returns HTTP 503 unless `GOLIATH_AI_ENABLED=true`.
- Both owner accounts must be configured in Goliath's existing owner ID environment variables. The AI API **fails closed** unless there are exactly two distinct configured owner IDs, and the active Discord session matches one.
- Owner API access is also enforced by the existing `requireDashboardAccess('/api/owner/ai')` middleware.
- Only JSON same-origin POST requests are accepted; no API key is embedded in the browser.
- The AI inference endpoint is hard-coded to localhost (`127.0.0.1:8081`) and does not call ChatGPT, Codex or paid model services.
- One request at a time, a 90-second deadline, small conversation/message caps.
- No command execution, Discord mutations, PC controls, external browsing, tool calls or persisted chat history yet. The AI is expressly instructed not to claim actions it cannot perform.
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
