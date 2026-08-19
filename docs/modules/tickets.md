# Tickets

Tickets is a flagship Goliath module. Its implementation is consolidated into eight canonical files, with one source of truth for each responsibility.

## Canonical structure

```text
src/modules/feedbackStudio/tickets/
├── tickets.js
├── ticketsPanel.js
├── ticketsInteractions.js
├── ticketsLifecycle.js
├── ticketsChannels.js
├── ticketsTranscripts.js
├── ticketsTracking.js
└── ticketsHealth.js
```

- `tickets.js` — defaults, persistence, normalisation, public API and module overview.
- `ticketsPanel.js` — embeds, buttons, menus, modals, setup UI and panel deployment.
- `ticketsInteractions.js` — Discord interaction routing and ticket actions.
- `ticketsLifecycle.js` — create, claim, assign, close, reopen, archive and delete workflows.
- `ticketsChannels.js` — channel creation, naming, Discord permissions and ticket guards.
- `ticketsTranscripts.js` — transcript creation, storage, reading and upload.
- `ticketsTracking.js` — socket events, timeline, analytics, recovery and startup recovery.
- `ticketsHealth.js` — diagnostics and repair operations.

The dashboard/API router lives at `src/server/routes/tickets.js`; it is not a module implementation file.

## Architecture rules

- External consumers import the canonical file that owns the required responsibility.
- Visible Discord UI belongs in `ticketsPanel.js`.
- No compatibility layers, bridge files or duplicate ticket implementations.
- Guild configuration remains in the established guild data store.
- Discord and dashboard behaviour must remain aligned.
- Doctor and Audit must pass before Tickets is considered complete.
