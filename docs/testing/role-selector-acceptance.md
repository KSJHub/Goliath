# Role Selector — Dev Guild Acceptance Checklist

Run this checklist against a disposable/development Discord guild before Role Selector is considered live-locked.

## Preconditions

- Goliath is running in `dev` mode.
- The test guild is using the dev environment guild data.
- Goliath has `Manage Roles`.
- Goliath's highest role is above every selector-managed role and the chosen Role Selector anchor/divider.
- Use a non-production text channel for deployment tests.
- Have at least one ordinary member/test account available in addition to the admin account.

Record the commit SHA used for the test run before starting.

## 1. Module state

- [ ] Open `/admin → Role Studio → Role Selector`.
- [ ] Confirm Role Selector opens for an authorised admin.
- [ ] Confirm a normal member cannot use `admin:roleSelector*` controls.
- [ ] Disable Role Selector.
- [ ] Confirm an already-deployed member panel becomes unavailable and has no interactive controls.
- [ ] Attempt an old/stale member interaction while disabled and confirm the operation is rejected.
- [ ] Re-enable Role Selector.
- [ ] Confirm the existing deployed panel becomes active again where possible.

Pass criteria: no role assignment, removal, or creation succeeds while the module is disabled.

## 2. Built-in Colours

- [ ] Select one default colour as a normal member.
- [ ] Confirm the role is created on demand if it did not already exist.
- [ ] Confirm the created role has zero permissions, is not hoisted, and is not mentionable.
- [ ] Change to a second colour.
- [ ] Confirm the first colour role is removed from the member and the second is added.
- [ ] Clear the colour selection.
- [ ] Confirm only Role Selector colour roles are removed.
- [ ] Enter a valid custom HEX value.
- [ ] Re-select the same custom HEX and confirm the existing managed role is reused rather than duplicated.
- [ ] Confirm colour roles remain grouped around the configured anchor.

Pass criteria: exactly one colour is retained per member and unrelated roles are untouched.

## 3. Custom single-choice group

Create a test group such as `Gaming Platform` with at least three options.

- [ ] Select option A as a normal member.
- [ ] Confirm its role is created on first use when no role ID exists.
- [ ] Select option B.
- [ ] Confirm option A is removed and option B is added.
- [ ] Confirm Colour and unrelated Discord roles remain untouched.
- [ ] Clear the group.
- [ ] Confirm only roles belonging to that selector group are removed.

Pass criteria: selection replacement is isolated to the selected group.

## 4. Custom multiple-choice group

Create a test group such as `Interests` in multiple-choice mode.

- [ ] Select two or more options simultaneously.
- [ ] Confirm all selected roles are retained.
- [ ] Deselect one option.
- [ ] Confirm only that group's deselected role is removed.
- [ ] Clear the group and confirm all roles from that group are removed.

Pass criteria: multiple-choice state mirrors the member's current selection without affecting other groups.

## 5. Existing Discord role option

- [ ] Create or choose an existing Discord role with zero permissions below Goliath.
- [ ] Attach it to a selector option as an existing role.
- [ ] Confirm members can self-assign and remove it.
- [ ] Delete the selector group.
- [ ] Confirm the existing external role is NOT deleted from Discord.

Negative checks:

- [ ] Attempt to attach a role with Discord permissions and confirm it is rejected.
- [ ] Attempt to attach a role at/above Goliath and confirm it is rejected.

Pass criteria: external roles are usable only when safe and are never treated as Goliath-owned deletion targets.

## 6. Anchor and hierarchy

- [ ] Select a valid divider/anchor below Goliath.
- [ ] Test `below` placement.
- [ ] Test `above` placement.
- [ ] Confirm managed selector roles remain grouped and cannot be moved above Goliath.
- [ ] Move the anchor above Goliath or otherwise make it unsafe.
- [ ] Run Health / Repair.
- [ ] Confirm the unsafe anchor is reported and cleared/rejected safely.

Pass criteria: unsafe anchors never cause selector roles to cross Goliath's hierarchy boundary.

## 7. Deployment lifecycle

- [ ] Deploy the selector to test channel A.
- [ ] Confirm the stored channel/message IDs match the deployed message.
- [ ] Disable and re-enable the module and confirm the same deployment transitions unavailable/active.
- [ ] Change the configured deployment channel to test channel B.
- [ ] Confirm the old panel in channel A is retired before the new channel is stored.
- [ ] Confirm the stored message ID is cleared after the channel move until a new deployment occurs.
- [ ] Deploy to channel B.
- [ ] Confirm only the channel B selector remains active.
- [ ] Manually delete the deployed message.
- [ ] Run Health / Repair.
- [ ] Confirm the stale message reference is detected and cleared.

Pass criteria: no active duplicate selector panel is left behind during channel moves.

## 8. Group deletion and orphan protection

For a custom group containing Goliath-managed roles:

- [ ] Delete the group while all managed roles are manageable.
- [ ] Confirm managed roles are deleted and the group is removed.
- [ ] Recreate a test group and move one managed role above Goliath so it cannot be deleted.
- [ ] Attempt to delete the group from Discord admin UI.
- [ ] Confirm the group remains configured and the unresolved role is reported.
- [ ] Repeat from the dashboard and confirm the API/UI reports the conflict rather than deleting the group.
- [ ] Move the blocking role back below Goliath and retry deletion.
- [ ] Confirm deletion succeeds and no orphaned Goliath-managed role remains.

Pass criteria: configuration is never removed while a Goliath-owned role remains unresolved.

## 9. Health and repair

Create controlled faults one at a time:

- [ ] Delete a managed selector role directly in Discord.
- [ ] Confirm Health reports the missing reference.
- [ ] Run Repair and confirm the stale reference is removed.
- [ ] Delete the anchor role and confirm Health / Repair clears it.
- [ ] Delete the deployment channel or deployment message and confirm stale deployment state is cleared.
- [ ] Remove an option that a member previously selected and confirm stale member-selection state is pruned.
- [ ] Confirm unrelated guild roles are never deleted or modified by Repair.

Pass criteria: Repair reconciles Role Selector-owned state without destructive action against unrelated guild resources.

## 10. Cleanup maintenance

- [ ] Create a managed selector role with no non-bot members.
- [ ] Confirm first cleanup marks it unused rather than deleting immediately.
- [ ] Confirm a used role clears `unusedSince` when usage returns.
- [ ] For a test-only configuration with an expired grace period, confirm cleanup deletes the unused managed role and clears its stored reference.
- [ ] Delete a managed role directly in Discord and confirm cleanup removes the stale stored reference without waiting for the grace period.

Pass criteria: cleanup deletes only Goliath-managed unused roles and leaves external roles untouched.

## 11. Dashboard

- [ ] Confirm unauthenticated access is rejected.
- [ ] Confirm a guild member without `Administrator` or `Manage Server` is rejected.
- [ ] Confirm an authorised manager can load Role Selector.
- [ ] Toggle module enabled state.
- [ ] Edit role format and anchor.
- [ ] Create, edit and delete a custom group.
- [ ] Change between groups using both Selector Groups and Selector Stats and confirm the editor always shows the selected group's own draft.
- [ ] Trigger a blocked group deletion and confirm unresolved role details are displayed.
- [ ] Change deployment channel and confirm the old deployment is retired as described above.

Pass criteria: dashboard state remains aligned with server state after every action.

## 12. Legacy Colour Roles migration

Use a disposable dev guild or fixture containing a legacy `modules.colourRoles` section.

- [ ] Load Role Selector for the first time.
- [ ] Confirm legacy module state migrates into `modules.roleSelector`.
- [ ] Confirm palette, custom HEX setting, managed role IDs, member selections, style, deployment, cleanup and analytics are preserved where present.
- [ ] Confirm the legacy `modules.colourRoles` section is removed only after `modules.roleSelector` exists.
- [ ] Confirm legacy deployed `colourRoles:*` member controls remain accepted during the migration window.
- [ ] Redeploy the universal Role Selector panel.

Pass criteria: migration is lossless for supported legacy fields and does not restore `colourRoles` as a separate source of truth.

## 13. Restart recovery and maintenance

- [ ] Restart the dev bot with Role Selector enabled.
- [ ] Confirm startup maintenance runs without corrupting selector state.
- [ ] Confirm managed role appearance/hierarchy is resynchronised.
- [ ] Confirm cleanup executes only for enabled guilds.
- [ ] Restart with Role Selector disabled and confirm the maintenance pass skips that guild.

Pass criteria: stored configuration survives restart and disabled modules remain inactive.

## 14. Final acceptance

Before live-locking Role Selector:

- [ ] `npm run verify` passes, including `role-selector-hardening.test.js`.
- [ ] `npm run doctor` passes locally on the tested commit.
- [ ] Every section above has passed on a dev guild.
- [ ] No unrelated guild roles, channels, or messages were altered.
- [ ] No duplicate active selector deployment remains.
- [ ] No unresolved Goliath-managed role remains after successful group deletion.
- [ ] Record any intentionally deferred/non-blocking limitations.

Only after all items pass should Role Selector be marked **LIVE-LOCKED** and considered ready for promotion beyond dev.
