# Role Selector

Role Selector is Goliath's universal self-service role system inside Role Studio. Colours remain the built-in special selector, while administrators can create additional selector groups for platforms, regions, interests, games, notifications or any other community identity/category.

The canonical source of truth is the normal environment-aware guild JSON section:

```text
guild.modules.roleSelector
```

The same implementation is used in dev, beta and production. Runtime mode selects the correct guild JSON. Role Selector does not use a standalone JSON file or database.

## Migration from Colour Roles

Existing `guild.modules.colourRoles` data is migrated the first time Role Selector is loaded for that guild. The migration preserves:

- module state
- built-in palette settings
- custom HEX setting
- managed colour-role IDs
- current member colour selections
- role naming/style configuration
- divider/anchor placement
- deployment message/channel
- cleanup settings
- analytics

The old `modules.colourRoles` section is removed only after `modules.roleSelector` has been created successfully.

Old deployed Colour Roles member controls remain accepted during the migration window so admins can redeploy the new Role Selector panel without instantly breaking an existing picker.

## Canonical module files

```text
src/modules/roleStudio/roleSelector/
├── roleSelector.js
├── roleSelectorHealth.js
└── roleSelectorPanel.js
```

- `roleSelector.js` owns selector groups, option roles, Colours, member selections, role lifecycle, hierarchy, styling, usage data and cleanup.
- `roleSelectorHealth.js` owns diagnostics and repair.
- `roleSelectorPanel.js` owns Discord admin and member-facing UI.

## Selector groups

Every guild starts with one protected built-in group:

```text
🌈 Colours
```

Admins can add custom groups, for example:

```text
🎮 Gaming Platform
├── Xbox
├── PlayStation
├── PC
└── Nintendo

🌍 Region
├── England
├── Europe
├── USA
└── Other
```

Custom groups support:

- custom name
- custom emoji/icon
- custom description
- up to 25 options per Discord selector
- single-choice mode
- multiple-choice mode
- optional member clearing/removal
- on-demand Goliath-managed Discord roles
- usage statistics and members-by-option

Selection safety is group-scoped. Changing a Region selection only removes roles belonging to Region. It does not remove Colour, Platform, staff, subscriber or other unrelated roles.

## Colours

Colours remains a special selector because it requires Discord colour-role behaviour and hierarchy ordering.

Default palette:

1. Red — `#E74C3C`
2. Orange — `#E67E22`
3. Yellow — `#F1C40F`
4. Green — `#2ECC71`
5. Blue — `#3498DB`
6. Purple — `#9B59B6`
7. Pink — `#E84393`
8. Black — `#23272A`
9. White — `#F5F5F5`
10. Custom HEX — optional

Goliath stores this palette internally and only creates physical Discord roles when a colour is actually used. Custom HEX values are classified by HSL hue into the nearest rainbow family so their physical roles can be placed alongside the correct colour family.

Only one Colour selection is retained per member.

## Dynamic role lifecycle

For a Goliath-managed selector option:

1. The option exists in `modules.roleSelector` even when no Discord role exists.
2. A member selects the option.
3. Goliath checks for an existing stored role ID.
4. If no managed role exists, Goliath creates a cosmetic/self-service role on demand.
5. The member receives the role.
6. For a single-choice group, only roles from that same group are replaced.
7. For a multiple-choice group, all selected options are retained and deselected options from that group are removed.

Goliath-managed selector roles are created with no permissions, are not hoisted and are not mentionable by default.

Unused Goliath-managed roles can be cleaned after the configured grace period. The default is seven days. Maintenance runs at startup and hourly.

When a custom group is deleted, Goliath first reconciles every managed Discord role owned by that group. Successfully deleted or already-missing managed roles are cleared from the stored group immediately. Existing external roles are preserved. If any Goliath-managed role cannot be deleted because of hierarchy or a Discord failure, the group is retained and deletion is blocked until the unresolved role is fixed. This prevents orphaned Goliath-owned roles.

## Role styling and hierarchy

Default role format:

```text
🎭 | {role}
```

Supported placeholders:

```text
{icon}
{separator}
{role}
{group}
```

`{colour}` remains accepted as a migration-compatible alias for `{role}`.

The guild-style scanner is advisory. It records a suggested format but does not silently apply it. Admins explicitly choose whether to apply the suggestion.

Admins choose an existing divider/anchor and whether Goliath-managed roles sit above or below it. Only roles owned by Role Selector are included in automatic hierarchy synchronisation. Existing unrelated guild roles keep their relative order.

The anchor must exist, must not be a managed Discord role, and must sit below Goliath's highest role. Unsafe anchors stop hierarchy movement instead of causing selector roles to be clamped into an invalid layout.

Colours are ordered by rainbow family/hue. Standard custom-group roles are ordered by selector group and option order.

Discord's normal role hierarchy still controls which role colour is visually shown for a member; a higher coloured staff role can override a lower Colour selection.

## Member experience

Admins deploy one universal Role Selector message. Members first choose a category, then receive that category's selector.

Example:

```text
🎭 Choose Your Roles

🌈 Colours
🎮 Gaming Platform
🌍 Region
🎯 Interests
```

The category-specific controls are ephemeral to the member. Single-choice and multiple-choice rules come from that group's configuration.

The global module state is enforced at the core role-operation boundary as well as the interaction layer. When Role Selector is disabled, existing deployed controls cannot assign, remove or create selector roles.

Disabling the module edits the deployed Goliath-owned selector into an unavailable state with no member controls. Re-enabling restores the same deployment where possible. Moving the selector to another channel retires the old deployment first so only one live selector remains.

## Stats

Role Selector provides view-only usage analytics; it does not contain giveaways or random-draw logic.

Admins can view:

- members using at least one selector
- usage counts by selector group
- option popularity rankings
- current members under each option
- Colour popularity including custom HEX colours
- historical selections, switches and removals
- managed-role creation/deletion counts

Future `/user` work may reuse the canonical Role Selector data for personal profile/stat views, but that integration remains a separate build.

## Discord administration

Open:

```text
/admin → Role Studio → Role Selector
```

The panel includes:

- Enable / Disable
- Groups
- Add Group
- Single / Multiple selection mode
- Add / Replace options
- Member-clear toggle
- Delete custom group
- Built-in Colours palette
- Custom HEX toggle
- Role Style & Placement
- Guild style scan / explicit apply
- Member selector deployment/update
- Stats
- Health / Repair

Role Selector admin interactions are protected by Goliath's standard admin security boundary. Member-facing `roleSelector:*` and legacy `colourRoles:*` controls remain available only for self-service actions while the module is enabled.

No standalone slash command is registered.

## Dashboard

Dashboard route:

```text
/role-selector
```

Canonical API base:

```text
/api/role-selector/:guildId
```

Dashboard Role Selector routes require an authenticated Discord session. The authenticated user must be the Goliath bot owner or have guild-management permission for the target guild. Request-body actor IDs are not trusted as authorization.

Changing the deployment channel retires the previous Goliath-owned deployment, clears its stored message reference, then stores the new target channel for explicit deployment.

A temporary legacy HTTP alias at `/api/colour-roles/:guildId` may be retained during migration, but it routes to the same Role Selector implementation and does not restore the old `colourRoles` source-of-truth key.

## Health and repair

Health checks include:

- Manage Roles permission
- divider/anchor existence
- divider/anchor hierarchy safety
- stored managed-role existence
- role manageability/hierarchy
- unexpected permissions on self-service roles
- deployment-channel availability
- deployment-message existence and ownership
- stale managed-role references
- stale member selections

Repair can:

- clear missing managed-role references
- clear missing/unsafe anchor references
- clear missing deployment references
- prune stale member selections
- resynchronise managed role appearance and hierarchy
- resynchronise the deployed selector state
- preserve unrelated guild roles and externally owned selector roles

## Sentinel / maintenance

Role Selector registers an hourly maintenance scheduler with Sentinel. Its Sentinel contract is therefore `scheduled` and reports runtime, interaction, scheduler, persistence and Discord-write signals.

Maintenance skips guilds where Role Selector is disabled. Enabled guilds receive appearance sync, hierarchy sync and unused-role cleanup on startup and hourly thereafter.

## Acceptance

Role Selector should not be marked live-locked until real-guild testing covers:

- legacy Colour Roles migration
- built-in colour selection/switch/removal
- custom HEX reuse and colour-family placement
- custom single-choice group
- custom multiple-choice group
- on-demand option role creation
- switching without touching other groups
- deployment/update
- disable/re-enable deployment state
- moving deployment channels
- hierarchy placement
- cleanup
- safe group deletion with partial failure
- stats/member lists
- dashboard configuration and authorization
- restart recovery
- health/repair
