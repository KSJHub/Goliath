# Embed Studio

Embed Studio is implemented as a set of focused services under `src/modules/messageStudio/embed/`. The runtime entry point is `embed.js`; supporting files own UI, interaction routing, media, rendering, persistence, validation, deployments and shared delivery behaviour.

Core runtime responsibilities include:

- `embed.js` — public API, runtime composition, delivery locking and canonical deployed-message updates.
- `embedPanel.js` — Discord UI, previews, buttons, menus and modals.
- `embedInteractions.js` — component and modal routing.
- `embedTemplates.js` — templates, presets, imports, exports and payload normalisation.
- `embedDeployments.js` — deployed-message persistence and resolution.
- `embedValidation.js` — Discord payload, readiness and media validation.
- `embedHealth.js` — diagnostics and repair.
- `embedState.js` — session state and durable session persistence.
- `embedMedia.js` — canonical media model, Media Manager UI/runtime behaviour, alignment controls and media session compatibility.
- `embedImageAlignment.js` — selected media alignment, preview behaviour and alignment interaction handling.
- `embedRenderer.js` — canonical Discord delivery rendering, including aligned media.
- `embedInteractions.js` — graphic-header cycling, media placement/alignment and component interaction routing.
- `embedTemplateDelivery.js` — shared template delivery used by other Message Studio features such as Welcome Studio.
- `embedBindingRegistry.js` — template binding registry used by server-side module routes.

There is no separate `embedTracking.js` implementation. Deployment tracking is owned by the deployment/runtime services.

Some compatibility and normalisation layers are intentionally retained because persisted Embed Studio data and existing deployed messages can originate from earlier schema/runtime versions. They must not be removed solely because they look redundant without first proving that persisted-state migration and deployment compatibility remain safe.

The media-alignment path is regression-sensitive. Changes to media normalisation, alignment state, preview generation or renderer delivery must preserve parity between the selected Media Manager alignment, Builder preview and deployed Discord message.
