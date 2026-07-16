# Social Studio

Social Studio is Goliath's zero-credential creator monitoring and Discord notification platform.

Server administrators only enter public creator information: a username, handle, channel ID, channel name, or public profile URL. Provider credentials are owned and managed centrally by Goliath and are never requested from server administrators or creators.

## Canonical structure

- `social.js` — canonical runtime entry
- `socialPanel.js` — Discord Social Studio
- `socialCreatorPanel.js` — Discord Creator Hub and simulator
- `socialRoute.js` — primary API route
- `socialCreatorRoute.js` — Creator Hub, diagnostics, and simulator API
- `socialManager.js` — account lifecycle and live-alert compatibility
- `socialDelivery.js` — canonical live, upload, Short, and post delivery
- `socialScheduler.js` — provider polling and dispatch
- `socialQueue.js` — restart-safe retries
- `socialHistory.js` — operational ledger
- `socialHealth.js` — health, repair, export, and reset
- `socialDiagnostics.js` — provider, account, and creator health scores
- `socialCreators.js` — unified creator profiles
- `socialSimulator.js` — provider-free notification simulation
- `providerRegistry.js` — provider readiness, policy, and dispatch
- `providers/` — provider implementations

## Zero-credential setup

Users configure:

- Platform
- Public username, handle, channel ID, or profile URL
- Display name
- Discord destination channel
- Optional mention role
- Alert types
- Optional per-type routing

Users never configure API keys, OAuth tokens, client secrets, or developer credentials.

## Supported production providers

### Twitch

Twitch live polling is production-ready when Goliath's global Twitch credentials are configured.

### YouTube

YouTube polling is production-ready when Goliath's global `YOUTUBE_API_KEY` is configured. It resolves public handles, legacy usernames, channel IDs, and public channel URLs, then classifies the latest content as live, upload, or Short.

### Kick

Kick live polling is production-ready when Goliath's global `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` are configured. Administrators only enter a public Kick username or profile URL.

### X

X public-post polling is production-ready when Goliath's global app-only credentials are configured. Administrators only enter a public X handle or profile URL. Protected accounts cannot be monitored through public app-only access.

## Intentionally unavailable providers

TikTok and Instagram are visible for product transparency but are not part of the Social Studio v1 production scope.

Their official monitored-account APIs require authorization from the creator or professional account being monitored. That conflicts with Goliath's locked rule that server administrators must not need to request credentials, OAuth approval, or private access from every creator.

These providers report:

```text
authorization_required
```

They are not reported as broken or unfinished. They may be added later only when a compliant public monitoring path exists.

## Safe baseline behaviour

The first content item discovered for a newly configured account becomes its baseline and is not announced. This prevents old uploads, existing live streams, or previous posts from creating false alerts during setup or restart recovery.

## Creator Hub

Creator Hub groups multiple platform accounts under one creator profile. Profiles support:

- Display names
- Notes
- Tags
- Groups
- Shared defaults
- Enabled state
- Account linking and unlinking
- Safe profile rebuilding
- Provider-free simulation

Discord access is available through `/socialhub` for members with Manage Server permission.

## Alert delivery

Every supported content type follows one canonical path:

1. Provider detects content.
2. Initial content is baselined safely.
3. Duplicate state is checked.
4. The configured alert type is checked.
5. Quiet hours are evaluated.
6. Per-type routing resolves the Discord channel.
7. The matching Social template is rendered.
8. Mentions and allowed mentions are applied.
9. Delivery succeeds or enters the restart-safe retry queue.
10. History and analytics are updated.

Supported routes are live, upload, short, and post, with fallback to the account's default alert channel.

## Flagship management surfaces

Discord and dashboard management include:

- Overview
- Account library
- Creator Hub
- Alert Studio
- Provider Centre
- Operations Centre
- Health and diagnostics
- Routing
- Global and per-account quiet hours
- Restart-safe delivery queue
- Retry-now, remove, process, and clear controls
- Alert and provider history
- Notification Simulator
- Export and reset

## Health scores

Accounts, creator profiles, and the module receive scores based on identifiers, destinations, provider readiness, check freshness, provider errors, and failed deliveries.

- 90–100: Excellent
- 75–89: Healthy
- 50–74: Warning
- 0–49: Critical

## Doctor

`npm run doctor` runs the main repository Doctor and `scripts/social-doctor.js`.

The Social Doctor validates:

- Canonical runtime and routes
- Discord Social Studio and Creator Hub
- Dashboard surface
- Creator profiles and simulator
- Delivery, queue, history, health, repair, and diagnostics
- Twitch, YouTube, Kick, and X production handlers
- Provider-scope policy
- Module manifest maturity
- Dashboard registry status
- Documentation

## Completion state

**Social Studio v1 is complete.**

The supported zero-credential production scope is:

```text
Twitch   ✅
YouTube  ✅
Kick     ✅
X        ✅
```

TikTok and Instagram are intentionally excluded because their official access model does not satisfy Goliath's zero-credential creator-monitoring rule. Their exclusion does not reduce Social Studio v1 maturity.

Live provider acceptance still depends on Goliath's global credentials being configured correctly in each deployment. Missing owner credentials are reported through Provider Centre, health, diagnostics, and Doctor-facing operational checks rather than being requested from guild administrators.
