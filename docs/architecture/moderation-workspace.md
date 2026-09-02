# Moderation Workspace

The Discord moderation UI uses one canonical selected-member workspace.

## Flow

1. Select a member from the user dropdown.
2. Apply direct moderation actions: Warn, Timeout, Kick, or Ban.
3. Use reversal controls only when state permits: Remove Warn or Clear Timeout.
4. Open Intelligence or Cases for deeper member context.
5. Back is always isolated on the final navigation row and exits to Administration.

## Selected-member panel

When a member is selected, the main Moderation panel carries the member context directly rather than routing through separate Member and Actions panels. It includes identity, account/server age, highest role, timeout state, warning/case counts, latest case, authority context, safety information, and the member avatar.

Legacy `member` and `overview` moderation routes normalize to the canonical `actions` workspace for compatibility. There is no separate Member navigation button.
