'use strict';

/**
 * DEV migration guard for member-facing lifecycle notices.
 * Keeps module semantics intact while routing member DMs through the shared
 * Goliath Member Notice design system. Remove once the source modules are
 * migrated natively.
 */
const Module = require('module');
const { buildMemberNotice, moderationNotice, COLORS } = require('../core/ui/memberNotice');

const KEY = Symbol.for('goliath.unified-member-notice-guard-v1');
if (!globalThis[KEY]) {
  globalThis[KEY] = { installed: true };
  const originalLoad = Module._load;

  const actor = (guild, id) => {
    if (!id) return 'Goliath System';
    if (String(id) === 'anti_nuke') return '🛡️ Goliath Security';
    return `<@${id}>`;
  };
  const durationText = (ms) => {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return null;
    const mins = Math.max(1, Math.round(n / 60000));
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
    const hours = Math.round(mins / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  };

  async function safeSend(user, payload) {
    try { if (user?.send) { await user.send(payload); return { sent: true, error: null }; } }
    catch (error) { return { sent: false, error: String(error?.message || error).slice(0, 300) }; }
    return { sent: false, error: 'Member DM target unavailable.' };
  }

  Module._load = function unifiedNoticeLoad(request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);
    let resolved = '';
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch {}

    // Quarantine application / escalation. Wrapping at module-load time means
    // destructuring consumers receive the wrapped function, not a stale copy.
    if (exported && /[\\/]security[\\/]protection[\\/]quarantine[\\/]memberLifecycle\.js$/.test(resolved)) {
      if (typeof exported.quarantineMember === 'function' && !exported.quarantineMember.__unifiedNotice) {
        const original = exported.quarantineMember;
        const wrapped = async function (guild, member, options = {}) {
          const result = await original.apply(this, arguments);
          if (result?.success && result?.executed !== false && member?.user) {
            const mode = result.mode || options.mode || 'investigation';
            const security = String(mode).toLowerCase() === 'security';
            const reference = options.caseId ? `Case #${options.caseId}` : (result.interviewChannelId ? `Investigation ${result.interviewChannelId}` : 'Security Review');
            const fields = [
              { name: '🔒 Restriction', value: security ? '**Full Security Isolation**' : '**Investigation Isolation**', inline: true },
              result.interviewChannelId ? { name: '💬 Investigation Room', value: `<#${result.interviewChannelId}>`, inline: true } : null,
              durationText(options.durationMs) ? { name: '⏱️ Duration', value: durationText(options.durationMs), inline: true } : null,
            ].filter(Boolean);
            const payload = moderationNotice(guild, { action: 'quarantine', caseId: options.caseId || null, reason: options.reason || 'No reason provided', status: 'Active', metadata: {} }, {
              reference,
              status: security ? '🔴 Security Isolation Active' : '🟣 Investigation Active',
              issuedBy: actor(guild, options.quarantinedBy),
              extraFields: fields,
              meaning: security
                ? 'Your access to the server has been restricted while Goliath Security completes a safety review.'
                : 'Your normal server access has been restricted while an investigation is completed. If an investigation room is shown above, use it for authorised communication.',
              nextSteps: 'Follow any instructions provided by Management. Do not attempt to bypass the restriction. You will receive another notice when the isolation is changed or released.',
            });
            result.memberNotice = await safeSend(member.user, payload);
          }
          return result;
        };
        Object.defineProperty(wrapped, '__unifiedNotice', { value: true });
        exported.quarantineMember = wrapped;
      }

      if (typeof exported.escalateInvestigationToSecurity === 'function' && !exported.escalateInvestigationToSecurity.__unifiedNotice) {
        const original = exported.escalateInvestigationToSecurity;
        const wrapped = async function (guild, member, existing, options = {}) {
          const result = await original.apply(this, arguments);
          if (result?.success && member?.user) {
            result.memberNotice = await safeSend(member.user, buildMemberNotice(guild, {
              module: 'Goliath Security', emoji: '🚨', title: 'Investigation Escalated to Security Isolation', color: COLORS.danger,
              reference: existing?.caseId ? `Case #${existing.caseId}` : 'Security Review', status: '🔴 Escalated',
              fields: [{ name: '🔒 Restriction', value: '**Full Security Isolation**', inline: true }],
              reason: options.reason || existing?.reason || 'Security isolation escalation', issuedBy: actor(guild, options.quarantinedBy),
              meaning: 'Your previous investigation hold has been escalated. Access to the investigation room and normal server areas may now be unavailable.',
              nextSteps: 'Management or Goliath Security will review the isolation. Do not attempt to bypass it. You will be notified when the restriction changes.',
            }));
          }
          return result;
        };
        Object.defineProperty(wrapped, '__unifiedNotice', { value: true });
        exported.escalateInvestigationToSecurity = wrapped;
      }
    }

    // Quarantine release / restoration.
    if (exported && /[\\/]security[\\/]protection[\\/]quarantine[\\/]releaseLifecycle\.js$/.test(resolved)
        && typeof exported.restoreQuarantinedMember === 'function' && !exported.restoreQuarantinedMember.__unifiedNotice) {
      const original = exported.restoreQuarantinedMember;
      const wrapped = async function (guild, member, options = {}) {
        let snapshot = null;
        try { snapshot = require('../core/security/protection/quarantine/state').getQuarantineState(guild.id)?.users?.[member.id] || null; } catch {}
        const result = await original.apply(this, arguments);
        if (result?.success && member?.user) {
          const payload = moderationNotice(guild, { action: 'unquarantine', caseId: snapshot?.caseId || null, reason: options.reason || 'Quarantine review completed', status: 'Resolved', metadata: {} }, {
            reference: snapshot?.caseId ? `Case #${snapshot.caseId}` : 'Security Review', status: '🟢 Restriction Released',
            issuedBy: actor(guild, options.restoredBy || options.closedBy),
            extraFields: [{ name: '♻️ Access Restoration', value: `${result.restoredRoles || 0} manageable role(s) restored`, inline: true }],
            meaning: 'Your Goliath quarantine restriction has been removed and your manageable pre-quarantine access has been restored.',
            nextSteps: result.cleanupPending ? 'Your access is restored. Goliath is still completing background investigation-room cleanup.' : 'You may use the server normally again. Any separate moderation restrictions remain in effect.',
          });
          result.memberNotice = await safeSend(member.user, payload);
        }
        return result;
      };
      Object.defineProperty(wrapped, '__unifiedNotice', { value: true });
      exported.restoreQuarantinedMember = wrapped;
    }

    // Goodbye/departure DM. This replaces only the member DM surface; public
    // departure templates remain fully configurable and untouched.
    if (exported && /[\\/]messageStudio[\\/]goodbye[\\/]goodbyeDeparture\.js$/.test(resolved)
        && typeof exported.sendDepartureDm === 'function' && !exported.sendDepartureDm.__unifiedNotice) {
      const original = exported.sendDepartureDm;
      const wrapped = async function (member, removal = {}, options = {}) {
        // Preserve module enablement/config/analytics through the canonical sender
        // when the DM is disabled. For enabled sends, use the shared renderer.
        const config = typeof exported.getConfig === 'function' ? exported.getConfig(member?.guild?.id) : null;
        const key = ['left', 'kicked', 'banned', 'pruned'].includes(removal?.key) ? removal.key : 'left';
        const enabledForEvent = config?.enabled === true && ({ left: config.sendOnLeave, kicked: config.sendOnKick, banned: config.sendOnBan, pruned: config.sendOnPrune })[key] === true;
        if (!options.force && !enabledForEvent) return original.apply(this, arguments);
        if (!member?.guild || !member?.user?.send || member.user.bot) return original.apply(this, arguments);

        const meta = {
          left: { emoji: '👋', title: 'You Left the Community', color: COLORS.info, status: 'Departed', meaning: 'Your membership of this server has ended because you left voluntarily.' },
          kicked: { emoji: '👢', title: 'You Were Removed from the Community', color: COLORS.danger, status: 'Removed', meaning: 'Your membership of this server ended because you were kicked.' },
          banned: { emoji: '🔨', title: 'You Were Banned from the Community', color: COLORS.danger, status: 'Banned', meaning: 'Your membership ended because a server ban was applied.' },
          pruned: { emoji: '🧹', title: 'You Were Removed During a Server Prune', color: COLORS.warning, status: 'Pruned', meaning: 'Your membership ended as part of a server prune or inactivity cleanup.' },
        }[key];
        const audit = removal.auditLog || null;
        const ref = removal.referenceId || audit?.id || null;
        const payload = buildMemberNotice(member.guild, {
          module: 'Goliath Membership', emoji: meta.emoji, title: meta.title, color: meta.color,
          description: 'This is an official membership-status notice from Goliath.', reference: ref ? `Departure ${ref}` : 'Membership Departure', status: meta.status,
          fields: [
            { name: '👤 Member', value: `${member.user.username || member.user.id}\n\`${member.user.id}\``, inline: true },
            { name: '📤 Departure Type', value: meta.status, inline: true },
          ],
          reason: config?.includeReason === false ? null : (audit?.reason || (key === 'pruned' ? 'Server prune' : key === 'left' ? 'Left voluntarily' : 'No reason provided')),
          issuedBy: config?.includeModerator === false ? null : (audit?.executor?.id ? `<@${audit.executor.id}>` : key === 'left' ? 'Member' : 'Goliath / Management'),
          meaning: meta.meaning,
          nextSteps: key === 'banned' ? 'You cannot rejoin while the ban remains active. If a separate moderation Case notice was issued, use that notice for appeal options.' : 'If you rejoin later, normal server onboarding and verification requirements may apply.',
          buttons: config?.includeAppealLink && /^https?:\/\//i.test(config.appealLink || '') ? [{ label: 'Appeal / Contact Management', emoji: '⚖️', url: config.appealLink }] : [],
        });
        const sent = await safeSend(member.user, payload);
        return { sent: sent.sent, failed: !sent.sent, skipped: false, error: sent.error, unified: true };
      };
      Object.defineProperty(wrapped, '__unifiedNotice', { value: true });
      exported.sendDepartureDm = wrapped;
    }

    return exported;
  };
}
