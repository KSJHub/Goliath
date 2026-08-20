# Role Selector

Role Selector is Goliath's universal self-service role system inside Role Studio. Colours remain the built-in special selector, while administrators can create additional selector groups for platforms, regions, interests, games, notifications or other community identity/categories.

The canonical source of truth remains the environment-aware guild JSON section:

```text
guild.modules.roleSelector
```

The same implementation is used in dev, beta and production. Runtime mode selects the correct guild JSON. Role Selector does not use a standalone JSON file or database.

## Canonical module files

```text
src/modules/roleStudio/roleSelector/
├── roleSelector.js
├── roleSelectorService.js
├── roleSelectorHealth.js
├── roleSelectorLocks.js
└── roleSelectorPanel.js
```

- `roleSelector.js` owns the base persisted model, role creation primitives, role naming, usage data and base cleanup.
- `roleSelectorService.js` is the hardening/coordinator layer. It owns stable identities, mutation convergence, lifecycle reconciliation, cleanup coordination, anchor ownership and maintenance coordination.
- `roleSelectorHealth.js` owns diagnostics and base repair. Runtime hardening extends Repair with Discord/member reconciliation.
- `roleSelectorLocks.js` owns process-local keyed queues and installs the hardening service onto the canonical Role Selector runtime surface.
- `roleSelectorPanel.js` owns Discord admin and member-facing UI plus the Discord deployment lifecycle.

## Migration from Colour Roles

Existing `guild.modules.colourRoles` data is migrated the first time Role Selector is loaded for that guild. Migration preserves module state, palette settings, custom HEX settings, managed colour-role IDs, member colour selections, style/placement, deployment state, cleanup settings and analytics. The old `modules.colourRoles` section is removed only after `modules.roleSelector` exists successfully.

Legacy `colourRoles:*` member interactions remain accepted during the migration window so an already-deployed picker does not instantly break before admins redeploy Role Selector.

## Selector groups and stable identity

Every guild starts with the protected built-in group:

```text
🌈 Colours
```

Custom groups support names, emoji/icons, descriptions, single- or multiple-choice mode, optional member clearing, up to 25 options, external safe-role references, and on-demand Goliath-managed roles.

Role Selector IDs are internal identities, not presentation labels. Existing group IDs and option IDs are preserved when names/labels are edited. Removed identities are retired and are not deliberately reused. New group IDs are collision-safe, and `colours` is permanently reserved for the built-in Colours selector.

A Discord role may be bound to only one active Role Selector option/reference. Duplicate role bindings are rejected to preserve group isolation.

Discord exposes a maximum of 25 menu options. Role Selector therefore allows at most 25 total categories including Colours, and at most 25 options per standard group. Palette input is capped to 25 unique IDs/HEX values.

## Member-visible usability

The public launcher only displays groups that can actually be used:

- standard group: enabled and has at least one enabled option;
- Colours: enabled and has at least one enabled preset or Custom HEX enabled.

Empty/incomplete admin configuration remains visible to admins but is not exposed as a dead-end category to members.

## Dynamic role lifecycle

For a Goliath-managed selector option:

1. The option can exist without a physical Discord role.
2. A member selects it.
3. Goliath creates the role on demand if required.
4. Goliath applies the desired role set for that group.
5. Goliath refreshes the member and verifies that Discord reached the requested final state.
6. If the first pass does not converge, one corrective pass is attempted.
7. Persisted `memberSelections` and selection analytics are written only after confirmed convergence.

Member/group mutations are serialized. Role creation remains separately keyed, while cleanup/group deletion and member-state mutations also participate in a guild mutation lane so cleanup cannot delete a role while it is being assigned.

If a managed option is rebound or removed, its old Goliath-owned role is retired. Members are drained from retired Goliath roles before those roles are deleted. Externally owned roles are never deleted by Role Selector.

## Colours

Colours remains a special single-choice selector because Discord role colour depends on hierarchy. Default presets remain Red, Orange, Yellow, Green, Blue, Purple, Pink, Black and White, with optional Custom HEX.

Custom HEX values are normalized to `#RRGGBB`, classified by HSL family, and matched into the managed colour hierarchy. Only one Role Selector colour is retained per member.

## Manual Discord reconciliation

Role Selector listens for relevant Discord changes outside its own buttons:

- `guildMemberUpdate` reconciles manual moderator adds/removes of selector roles.
- `guildMemberRemove` removes departed-user selection state and refreshes unused-role timers.
- `roleDelete` clears deleted selector-role/anchor references immediately.
- `roleUpdate` re-applies safety/appearance/hierarchy rules to Goliath-managed roles.

Manual/admin reconciliation does not count as an organic member selection in usage analytics.

## Cleanup

Unused Goliath-managed roles can be deleted after the configured grace period; default is seven days. Maintenance runs at startup and hourly.

`unusedSince` is refreshed from actual Discord membership. Malformed timestamps are reset rather than becoming permanently undeletable. Cleanup checks real role membership and manageability before deletion.

Retired managed roles use their own lifecycle path and can be removed as soon as they are no longer referenced/assigned.

## Role styling and hierarchy

Default format:

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

`{colour}` remains a migration-compatible alias for `{role}`.

Style input is bounded, and a format missing both `{role}` and `{colour}` is automatically made role-bearing so all managed roles cannot collapse to the same generated name.

Managed roles are kept permissionless, unhoisted and non-mentionable. Appearance synchronization restores managed-role names/colours and safety properties if they drift.

Admins can select an external anchor or ask Goliath to create a divider. Anchor ownership is tracked: replacing a Goliath-created divider may retire/delete that divider, while externally owned anchors are never deleted. Anchors must be manageable and below Goliath.

## Deployment lifecycle

Discord admin and dashboard deployment operations share a per-guild deployment lock.

A stored message is edited only when it is owned by Goliath. Missing/foreign message IDs are treated as stale and a fresh selector message is created instead of overwriting another author's message. Moving channels retires the previous Goliath-owned deployment first. Disable/re-enable updates the tracked deployment to unavailable/active state.

## Dashboard security and parity

Dashboard base:

```text
/api/role-selector/:guildId
```

Routes require an authenticated Discord session. The user must be Goliath's owner or have Administrator/Manage Server permission for the target guild. Request-body actor IDs are not trusted.

Dashboard group, Colours, anchor and deployment changes use the same hardened lifecycle/validation rules as Discord administration.

## Health and Repair

Health checks include Manage Roles, anchor validity, referenced-role existence/manageability, unexpected permissions, deployment availability/ownership, stale references and acceptance readiness.

The hardened Health result counts only Goliath-managed Role Selector roles as managed. Warnings affect the displayed health state instead of producing a green result with known problems.

Repair additionally reconciles stored member selections against actual Discord roles, removes departed/missing member state, drains retired managed roles, refreshes cleanup state, and resynchronizes managed appearance/hierarchy.

## Analytics

Usage/member lists are calculated from actual Discord role membership. Historical counters include member selections, switches, removals, managed roles created/deleted and failed member mutations. No-op selections do not increment selection/switch counters.

## Sentinel / maintenance

Role Selector registers an hourly Sentinel scheduler. Startup/hourly maintenance goes through the hardened coordinator, which serializes appearance/hierarchy work and then runs mutation-safe cleanup.

## Acceptance

Role Selector should not be marked live-locked until final real-guild testing covers:

- legacy Colour Roles migration;
- built-in preset selection/switch/removal;
- custom HEX reuse and hierarchy placement;
- custom single-choice and multi-choice groups;
- option rename/reorder identity preservation;
- on-demand role creation;
- managed ↔ external role rebinding;
- manual moderator role changes;
- member departure cleanup;
- role deletion/update reconciliation;
- concurrent selection/cleanup/deploy scenarios;
- deployment ownership and channel moves;
- divider ownership/replacement;
- cleanup grace behavior;
- safe group deletion with partial failure;
- stats/member lists;
- dashboard authorization/configuration;
- restart recovery;
- Health/Repair.
