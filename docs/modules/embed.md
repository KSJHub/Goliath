# Embed Studio

Embed Studio is consolidated into eight canonical implementation files.

```text
src/modules/messageStudio/embed/
├── embed.js
├── embedPanel.js
├── embedInteractions.js
├── embedTemplates.js
├── embedDeployments.js
├── embedTracking.js
├── embedValidation.js
└── embedHealth.js
```

- `embed.js` — public API and module overview.
- `embedPanel.js` — all visible Discord UI, previews, buttons, menus and modals.
- `embedInteractions.js` — component and modal routing.
- `embedTemplates.js` — templates, presets, imports, exports and payload normalisation.
- `embedDeployments.js` — deployed message persistence and resolution.
- `embedTracking.js` — socket and deployment update events.
- `embedValidation.js` — Discord payload and URL validation.
- `embedHealth.js` — diagnostics and repair.

The HTTP configuration router lives at `src/server/routes/embeds.js` and is not a module implementation file.

No compatibility layers, wrappers, bridges or duplicate implementations are retained.
