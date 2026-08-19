# Goodbye

Goodbye is consolidated into four canonical implementation files.

```text
src/modules/messageStudio/goodbye/
├── goodbye.js
├── goodbyePanel.js
├── goodbyeDeparture.js
└── goodbyeRoute.js
```

- `goodbye.js` — configuration, template assignment, public API, analytics and health.
- `goodbyePanel.js` — every visible embed, button, menu and Goodbye interaction.
- `goodbyeDeparture.js` — departure classification, public departure messages and member DMs.
- `goodbyeRoute.js` — the Goodbye HTTP API router.

No compatibility layers, wrappers, bridges or duplicate Goodbye implementations are retained.
