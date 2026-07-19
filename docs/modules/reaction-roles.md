# Reaction Roles

Reaction Roles lets guild members self-assign roles by reacting to managed Discord messages.

## Canonical module

```text
src/modules/reactionroles/
├── reactionRoles.js
├── reactionRoleMessageFinder.js
├── reactionRolesPanel.js
├── reactionRolesRoute.js
└── reactionRolesLegacyButtons.js
```

`reactionRoles.js` is the source of truth for storage, deployments, mappings, runtime role assignment, health, repair, analytics and startup recovery.

`reactionRoleMessageFinder.js` discovers existing messages and embeds across accessible guild channels so administrators can attach reaction roles without copying message links or replacing message content.

`reactionRolesLegacyButtons.js` exists only to preserve previously deployed `role_toggle:*` button messages after the obsolete generic Roles module was removed.

## Deployment sources

Reaction Roles supports two canonical deployment paths:

1. **Attach an existing Discord message or embed**
2. **Create from an Embed Studio template**

Existing-message attachment is the primary workflow. It does not recreate the selected message. Goliath adds configured reactions and tracking while preserving unrelated content, embeds, components and reactions.

## Guild message finder

The dashboard can search one channel or all accessible text channels using:

- Recent messages
- Exact message ID
- Author ID
- Text contained in message or embed content
- Embeds only
- Bot messages only
- Pinned messages only

Search results include a message preview, channel, author, timestamp, embed status and reaction count. Selecting a result passes its channel and message IDs directly into the canonical attachment transaction.

API endpoint:

```text
GET /api/reaction-roles/:guildId/messages/search
```

Supported query parameters:

```text
channelId
messageId
authorId
query
botsOnly
embedsOnly
pinnedOnly
scanLimit
resultLimit
```

## Mapping modes

Each emoji mapping can use one of these modes:

- `toggle` — add the role on reaction and remove it when the reaction is removed.
- `add` — add the role and keep it until another process removes it.
- `remove` — remove the role when the member reacts.

Mappings validate:

- Role existence
- `Manage Roles` permission
- Discord role hierarchy
- Managed integration roles
- Duplicate emoji conflicts

Multiple mappings can be attached in one deployment transaction.

## Discord administration

Open **Admin → Modules → Reaction Roles**.

Discord administration supports:

- Persistent setup drafts
- Embed Studio template selection
- Existing-message attachment
- Native channel and role selectors
- Multiple emoji-to-role mappings
- Deployment management
- Enable and disable
- Health
- Repair
- Redeploy template
- Detach
- Delete Goliath-created deployment messages
- Export and reset

Typing is limited to values Discord cannot provide through native selectors, such as a message ID or Unicode/custom emoji.

## Dashboard

Dashboard page:

```text
/reaction-roles
```

API base:

```text
/api/reaction-roles
```

The dashboard supports:

- Guild-wide or channel-specific message discovery
- Existing message and embed previews
- Native channel and role selectors
- Multiple mappings in one attachment transaction
- Editing mappings on an active deployment
- Adding, disabling and removing individual mappings
- Immediate reaction synchronisation after saving
- Enabling and disabling deployments
- Duplicating a deployment's mappings into the attachment builder
- Opening the tracked message directly in Discord
- Repairing one deployment or all deployments
- Safe detach without changing the message
- Detach with removal of Goliath-owned reactions
- Deletion of Goliath-created deployment messages only
- Health, analytics and JSON export

Duplicating a deployment copies its mapping configuration only. The administrator must select a destination message before attaching the copy, preventing accidental reuse of the original message.

## Lifecycle operations

Canonical deployment operations live in `reactionRoles.js`:

```js
setPanelEnabled()
repairPanel()
redeployPanel()
applyTemplateToPanel()
updatePanelMappings()
detachPanel()
deleteDeploymentMessage()
```

Discord and dashboard callers must use these functions instead of implementing lifecycle behaviour independently.

## Transaction safety

Initial deployment, mapping changes, template application and redeployment are transactional.

When an operation fails, Goliath restores the previous deployment state where possible, including:

- Stored mappings
- Template link
- Message content
- Embeds
- Components
- Required reactions

Template-created messages are deleted when initial deployment cannot complete. Existing attached messages are restored rather than deleted.

## Runtime behaviour

Reaction add and remove events are processed through the canonical runtime.

The runtime:

- Ignores bot users
- Handles partial Discord objects safely
- Revalidates the deployment and mapping before acting
- Serialises rapid operations for the same member and mapping
- Handles deleted members and roles without crashing the event process
- Records failures in deployment health
- Avoids inflating successful analytics for duplicate or no-op events

## Analytics

Reaction Roles records:

- Attached deployments
- Template-created deployments
- Roles assigned
- Roles removed
- No-op events
- Failed operations
- Repairs
- Last action time

## Health and repair

Health verifies:

- Deployment message accessibility
- Mapping availability
- Emoji conflicts
- Role existence and hierarchy
- Missing reactions
- Linked Embed Studio template existence
- Disabled deployment state

Repair restores missing reactions and refreshes the deployment health state. Redeploy additionally reapplies the linked Embed Studio template.

## Startup

The canonical startup operation is:

```js
require('./src/modules/reactionroles/reactionRoles').startup(client)
```

Startup repairs enabled deployments across cached guilds. There must not be a second Reaction Roles scheduler or startup implementation.

## Doctor

```text
npm run audit:reactionroles
```

The doctor verifies the canonical runtime, API route, guild message finder, dashboard attachment and deployment-management workflows, and reaction event registrations.

## Legacy migration

The former `modules.roles` storage section is migrated once at startup.

- Legacy timed rules move to `timedRoles.rules`.
- Legacy join roles move to `autoRoles.joinRoles`.
- Legacy button panels move to `reactionRoles.legacyButtonPanels`.
- Legacy button analytics move to `reactionRoles.legacyButtonAnalytics`.

Migration completion is recorded at:

```text
modules._migrations.legacyRolesV1
```

The obsolete `modules.roles` section is removed after a successful migration.
