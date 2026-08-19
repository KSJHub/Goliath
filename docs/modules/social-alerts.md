# Social Studio

Social Studio is Goliath's zero-credential creator monitoring and Discord notification platform.

Server administrators only enter public creator information: a username, handle, channel ID, channel name, or public profile URL. Provider credentials are owned and managed centrally by Goliath and are never requested from server administrators or creators.

## Canonical structure

Social Studio's canonical backend implementation lives under `src/modules/social/`.

- `social.js` — canonical module entry and public runtime contract
- `socialRoute.js` — canonical Social Studio API route
- colocated Social runtime files — storage, providers, polling, creators, simulation, delivery, queue, history, diagnostics, health, repair, export, and reset
- `src/dashboard/js/pages/modules/Social.jsx` — dashboard management surface

The storage key remains `social`. Runtime helpers may remain separated where they own a distinct responsibility, but duplicate module roots, compatibility wrappers, duplicate Creator Hub routes, and parallel provider implementations are not permitted.

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

## Creator profiles

Creator profiles group multiple platform accounts under one creator. Profiles support:

- Display names
- Notes
- Tags
- Groups
- Shared defaults
- Enabled state
- Account linking and unlinking
- Safe profile rebuilding
- Provider-free simulation

Discord access is available through `/socialhub`, which opens the canonical Social Studio panel for members with Manage Server permission.

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

## History API

Operational and provider-incident history is available through:

```text
GET /api/social/:guildId/history
```

Supported query filters are:

- `limit` — maximum records returned, clamped between 1 and 500
- `status` — sent, failed, skipped, suppressed, queued, retried, or test
- `eventType` — exact event type, including `provider_incident`
- `accountId` — exact Social account ID
- `platform` — platform identifier such as `twitch`
- `alertType` — live, upload, short, or post

Example provider-incident request:

```text
GET /api/social/123456789/history?eventType=provider_incident&status=failed&limit=25
```

The response includes the filtered `history` records and an unfiltered guild-level `summary`. The summary reports normal delivery totals together with provider-incident retention usage:

```json
{
  "providerIncidents": 37,
  "incidentCapacity": {
    "used": 37,
    "limit": 100,
    "remaining": 63,
    "saturated": false
  }
}
```

History retains at most 500 total records. Provider incidents are independently capped at 100 records so repeated provider failures cannot crowd operational delivery history out of storage. Records remain newest-first.

## Flagship management surfaces

Discord and dashboard management include:

- Overview
- Account library
- Creator profiles
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

`npm run doctor` runs the main repository Doctor and the Social Studio checks.

The Social Studio Doctor contract validates:

- The canonical backend module lives at `src/modules/social/`
- No duplicate Social Studio module root exists
- No duplicate Creator Hub panel or route remains
- No compatibility wrapper or nested duplicate provider implementation remains
- The canonical module entry and route import successfully
- The dashboard surface and module registry remain connected
- The storage key remains `social`
- Documentation matches the deployed architecture

## Completion state

The supported zero-credential production scope is:

```text
Twitch   ✅
YouTube  ✅
Kick     ✅
X        ✅
```

TikTok and Instagram are intentionally excluded because their official access model does not satisfy Goliath's zero-credential creator-monitoring rule. Their exclusion does not reduce Social Studio v1 maturity.

Live provider acceptance still depends on Goliath's global credentials being configured correctly in each deployment. Missing owner credentials are reported through Provider Centre, health, diagnostics, and Doctor-facing operational checks rather than being requested from guild administrators.