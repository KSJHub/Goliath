# Invite Studio

Invite Studio creates Discord-style invite links with optional roles, tracks which invite a member used, maintains inviter totals, applies leave corrections and grants reward roles.

## Status

Invite Studio is a complete module and is ready for live development-guild testing.

Campaigns, QR codes and reusable templates are optional future enhancements. They are not required for the core Invite Studio acceptance contract.

## Administration surface

Invite Studio has no standalone slash command.

Open the existing Goliath Admin Hub, select **Modules**, then select **Invite Studio**. All Discord-side administration is contained inside that central panel.

The module is also available from the dashboard route:

```text
/invites
```

## Admin Hub panel

The central Modules panel exposes an **Invite Studio** button. Its workspace provides:

- Enable or disable Invite Studio
- Create invite links
- Select the invite channel
- Choose expiry
- Choose maximum uses
- Select optional roles
- Toggle Discord temporary membership
- Generate the invite
- List active Invite Studio links
- Delete links
- Synchronize invite counters
- Run health checks
- Run repair
- Return to the main Modules panel

No `/invites` command or standalone Invite Studio panel is used.

## Dashboard workspace

The dashboard is organized into six sections:

```text
Invite Links
Analytics
Rewards
Join History
Health
Settings
```

**Invite Links** is the default landing section. It contains the invite creator and active-link table.

The active-link table shows:

- Invite code
- Channel
- Current and maximum uses
- Expiry
- Assigned roles
- Temporary-membership state
- Copy action
- Delete action

Analytics provides overall joins, tracked and unknown attribution, departures, fake-account flags, failures and the inviter leaderboard.

Rewards contains inviter milestone roles and manual bonus adjustments.

Join History shows recent Invite Studio lifecycle records, including member, invite, inviter and granted-role context where available.

Health exposes health state, issues, warnings, repair, refresh and export.

Settings contains tracking behaviour, managed-invite configuration, log-channel configuration and the reset control.

## Invite roles

Each Invite Studio link can store up to 25 role IDs. Discord role-select components expose up to 10 roles in one panel interaction.

When a member joins:

1. Invite Studio detects which invite code increased.
2. It loads the configuration for that exact code.
3. It validates the configured roles.
4. It grants every assignable role to the new member.
5. It records successful and failed grants in history and analytics.

Goliath refuses role-bearing invite creation when a selected role is missing, managed by Discord or positioned at or above Goliath's highest role.

Roles selected for one invite are never applied to members joining through another invite.

## Temporary membership

The temporary-membership option is passed directly to Discord when the invite is created. Discord may make a temporary member permanent once a role is assigned; this matches Discord's native behaviour.

## Storage

All data is stored in the canonical guild document:

```text
guild.modules.invites
```

Invite-specific configuration is stored under:

```text
guild.modules.invites.inviteLinks[inviteCode]
```

## Attribution

Invite Studio caches invite-use counters. When a member joins, it fetches the latest counters and identifies the invite whose use count increased.

Attribution is recorded as:

- `invite` — a public guild invite with a known inviter
- `unknown` — no reliable public invite delta was available

Deleted, expired, vanity or otherwise unavailable invite data is recorded honestly as unknown rather than inventing an inviter.

## Reward roles

Reward roles are separate from invite roles:

- Invite roles go to the member joining through a configured link.
- Reward roles go to the inviter after reaching a configured referral threshold.

## API

Base route:

```text
/api/invites
```

Key invite-link endpoints:

```text
GET    /:guildId/links
POST   /:guildId/links
DELETE /:guildId/links/:code
```

Create-link body:

```json
{
  "channelId": "123456789012345678",
  "maxAge": 2592000,
  "maxUses": 0,
  "roleIds": ["123456789012345679"],
  "temporary": false
}
```

## Automated acceptance

Run the focused Invite Studio checks:

```powershell
npm run test:invites
```

The standard project Doctor also runs the Invite Studio smoke test:

```powershell
npm run doctor
```

The checks verify the runtime lifecycle, API, central Admin Hub integration, dashboard workspace, event coverage, health, export, reset, documentation and the permanent removal of the standalone `/invites` command.

## Live Discord test procedure

1. Start Goliath in development mode.
2. Open `/admin`, select **Modules**, then **Invite Studio**.
3. Enable Invite Studio and run **Health**. Resolve any permission or role-hierarchy issue.
4. Create a single-use invite for a test channel and select a low test role below Goliath's highest role.
5. Copy the generated invite and join from a separate Discord test account.
6. Confirm the selected role is assigned to the joining account.
7. Confirm the join appears in **Join History** with the correct invite code and inviter.
8. Confirm Analytics and the inviter leaderboard increase.
9. Leave with the test account and confirm active credit decreases when **Remove active credit on leave** is enabled.
10. Test expiry, maximum uses, temporary membership and deletion separately.
11. Run **Sync**, **Health**, **Repair** and **Export**.
12. Run `npm run test:invites` again after the live test.

Discord invite creation, member joins and role assignment require a real development guild and cannot be fully simulated by an offline unit test.