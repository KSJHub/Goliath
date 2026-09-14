'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const suggestions = require('./suggestions');
const tracking = require('./suggestionsTracking');
const embedTemplates = require('../../messageStudio/embed/embedTemplates');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const panelNavigation = require('../../../core/ui/panelNavigation');

const SUGGESTIONS_COLOR = 0xfee75c;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const formatChannel = (id) => id ? `<#${id}>` : '*Not set*';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '*None selected*';

function statusEmoji(status) {
  if (status === 'approved') return '✅';
  if (status === 'implemented') return '🚀';
  if (status === 'denied') return '❌';
  if (status === 'discussing') return '💬';
  return '💡';
}

function statusLabel(status, section = {}) {
  if (status === 'approved') return 'Approved';
  if (status === 'implemented') return 'Implemented';
  if (status === 'denied') return 'Declined';
  if (status === 'discussing') return 'Under discussion';
  return section.requireReview !== false ? 'Open for feedback' : 'Open';
}

function compactPreview(content, maxLength = 80) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function shortDate(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown date';
}

function discordTimestamp(value, style = 'F') {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function voteSummary(suggestion) {
  return `👍 **${suggestion.upVotes.length}** support   ·   👎 **${suggestion.downVotes.length}** not for me`;
}

function publicSuggestionAuthor(suggestion) {
  if (suggestion?.anonymous === true) return '🔒 Anonymous member';
  return suggestion?.authorId ? `<@${suggestion.authorId}>` : 'Community member';
}

function managementSuggestionAuthor(suggestion) {
  if (!suggestion?.authorId) return 'Unknown member';
  return suggestion.anonymous === true
    ? `<@${suggestion.authorId}> · 🔒 hidden publicly`
    : `<@${suggestion.authorId}>`;
}

function defaultTeamResponse(suggestion) {
  if (suggestion?.status === 'implemented') return suggestion.implementationNote || suggestion.reviewReason || 'This suggestion has now been implemented.';
  if (suggestion?.reviewReason) return suggestion.reviewReason;
  if (suggestion?.status === 'approved') return 'The team has approved this suggestion.';
  if (suggestion?.status === 'denied') return 'The team has decided not to move forward with this suggestion.';
  return '';
}

function templateVariables(guild, suggestion = null, section = {}) {
  const current = new Date();
  const icon = guild?.iconURL?.({ extension: 'png', size: 512 }) || '';
  const banner = guild?.bannerURL?.({ extension: 'png', size: 1024 }) || '';
  const enabled = guild?.id ? isModuleEnabled(guild.id, 'suggestions') : true;
  return {
    guild: guild?.name || 'Server', guildName: guild?.name || 'Server', server: guild?.name || 'Server', serverName: guild?.name || 'Server',
    guildId: guild?.id || '', guildIcon: icon, guildBanner: banner, memberCount: Number(guild?.memberCount || 0),
    createdAt: discordTimestamp(current, 'F'), timestamp: discordTimestamp(current, 'F'),
    suggestionTitle: suggestion?.title || '', suggestion: suggestion?.content || '',
    suggestionAuthor: suggestion ? publicSuggestionAuthor(suggestion) : '',
    suggestionStatus: suggestion ? statusLabel(suggestion.status, section) : '',
    upVotes: suggestion?.upVotes?.length || 0, downVotes: suggestion?.downVotes?.length || 0,
    teamResponse: suggestion ? defaultTeamResponse(suggestion) : '',
    submittedAt: suggestion?.createdAt ? discordTimestamp(suggestion.createdAt, 'F') : '',
    decisionAt: suggestion?.implementedAt || suggestion?.reviewedAt || suggestion?.updatedAt
      ? discordTimestamp(suggestion.implementedAt || suggestion.reviewedAt || suggestion.updatedAt, 'F') : '',
    suggestionsEnabled: enabled ? 'On' : 'Off', anonymousMode: section.anonymous === true ? 'On' : 'Off',
  };
}

function suggestionTemplateSlot(suggestion) {
  if (suggestion?.status === 'approved' || suggestion?.status === 'implemented') return 'suggestion_accepted';
  if (suggestion?.status === 'denied') return 'suggestion_denied';
  return 'suggestion_pending';
}

function renderSuggestionBinding(guild, slot, variables) {
  if (!guild?.id) return null;
  try { return embedTemplates.renderBinding(guild.id, 'suggestions', slot, variables); }
  catch (error) {
    console.warn(`[Suggestions] Embed Studio template ${slot} could not be rendered:`, error.message || error);
    return null;
  }
}

function applyTemplateEmbed(rendered, fallbackEmbed, timestampValue = null) {
  if (!rendered?.embed) return fallbackEmbed;
  const source = rendered.embed;
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR);
  if (source.title) embed.setTitle(source.title);
  if (source.description) embed.setDescription(source.description);
  if (Array.isArray(source.fields) && source.fields.length) embed.addFields(source.fields);
  if (source.author?.name) {
    const author = { name: source.author.name };
    if (source.author.iconURL) author.iconURL = source.author.iconURL;
    if (source.author.url) author.url = source.author.url;
    embed.setAuthor(author);
  }
  if (source.footer?.text) {
    const footer = { text: source.footer.text };
    if (source.footer.iconURL) footer.iconURL = source.footer.iconURL;
    embed.setFooter(footer);
  }
  if (source.thumbnailURL) embed.setThumbnail(source.thumbnailURL);
  if (source.imageURL) embed.setImage(source.imageURL);
  if (timestampValue) embed.setTimestamp(new Date(timestampValue));
  return embed;
}

function defaultSuggestionEmbed(guild, suggestion, section) {
  const enabled = guild?.id ? isModuleEnabled(guild.id, 'suggestions') : true;
  const fields = [
    { name: 'Shared by', value: publicSuggestionAuthor(suggestion), inline: true },
    { name: 'Status', value: `${statusEmoji(suggestion.status)} ${statusLabel(suggestion.status, section)}`, inline: true },
  ];
  if (section.voting !== false || suggestion.upVotes.length || suggestion.downVotes.length) fields.push({ name: 'Community feedback', value: voteSummary(suggestion), inline: false });
  if (suggestion.status === 'discussing') fields.push({ name: 'Voting paused', value: 'The management team is discussing this suggestion. Voting will stay paused until it is reopened or a decision is made.', inline: false });
  if (['approved', 'denied', 'implemented'].includes(suggestion.status)) {
    fields.push({ name: suggestion.status === 'implemented' ? 'Completed' : 'Decision made', value: discordTimestamp(suggestion.implementedAt || suggestion.reviewedAt || suggestion.updatedAt, 'R'), inline: true });
    fields.push({ name: 'Team response', value: defaultTeamResponse(suggestion), inline: false });
  }
  let footer = 'Thanks for helping improve the community.';
  if (suggestion.status === 'pending' && !enabled) footer = 'Suggestions are currently paused.';
  else if (suggestion.status === 'pending' && suggestion.votePaused) footer = 'Voting is paused for this suggestion.';
  else if (suggestion.status === 'pending' && section.voting !== false) footer = 'Use the buttons below to share your view.';
  else if (suggestion.status === 'discussing') footer = 'The team is currently discussing this suggestion.';
  else if (suggestion.status === 'approved') footer = 'Approved by the management team.';
  else if (suggestion.status === 'implemented') footer = 'Implemented by the management team.';
  else if (suggestion.status === 'denied') footer = 'Reviewed by the management team.';
  return new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle(`${statusEmoji(suggestion.status)} ${suggestion.title || 'Community Suggestion'}`).setDescription(suggestion.content || '_No suggestion details were provided._').addFields(fields).setFooter({ text: footer }).setTimestamp(new Date(suggestion.createdAt || Date.now()));
}

function buildSuggestionPresentation(guild, suggestion, section) {
  const fallbackEmbed = defaultSuggestionEmbed(guild, suggestion, section);
  const rendered = renderSuggestionBinding(guild, suggestionTemplateSlot(suggestion), templateVariables(guild, suggestion, section));
  return { content: rendered?.content || undefined, embed: applyTemplateEmbed(rendered, fallbackEmbed, suggestion.createdAt || Date.now()) };
}

function buildSuggestionEmbed(guild, suggestion, section) { return buildSuggestionPresentation(guild, suggestion, section).embed; }

function buildSuggestionRows(suggestion, section, enabled = true) {
  if (!enabled || suggestion.status !== 'pending' || suggestion.votePaused || section.voting === false) return [];
  return [row(
    button(`suggestions:vote:${suggestion.suggestionId}:up`, `👍 Support · ${suggestion.upVotes.length}`, ButtonStyle.Secondary),
    button(`suggestions:vote:${suggestion.suggestionId}:down`, `👎 Not for me · ${suggestion.downVotes.length}`, ButtonStyle.Secondary),
  )];
}

function buildSuggestionMessagePayload(guild, suggestion, section, enabled = true, includeComponents = true) {
  const presentation = buildSuggestionPresentation(guild, suggestion, section);
  return { content: presentation.content || null, embeds: [presentation.embed], components: includeComponents ? buildSuggestionRows(suggestion, section, enabled) : [] };
}

function messageLink(guildId, channelId, messageId) {
  return guildId && channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null;
}

function buildManagementPayload(guild, suggestion, section) {
  const publicLink = messageLink(guild.id, suggestion.channelId, suggestion.messageId);
  const threadLink = suggestion.discussionThreadId ? `https://discord.com/channels/${guild.id}/${suggestion.discussionThreadId}` : null;
  const fields = [
    { name: 'Reference', value: `\`${suggestion.reference}\``, inline: true },
    { name: 'Status', value: `${statusEmoji(suggestion.status)} ${statusLabel(suggestion.status, section)}`, inline: true },
    { name: 'Submitted by', value: managementSuggestionAuthor(suggestion), inline: false },
    { name: 'Community feedback', value: voteSummary(suggestion), inline: false },
  ];
  if (publicLink) fields.push({ name: 'Public suggestion', value: `[Open original message](${publicLink})`, inline: true });
  if (threadLink) fields.push({ name: 'Team discussion', value: `[Open discussion thread](${threadLink})`, inline: true });
  if (suggestion.status === 'discussing') fields.push({ name: 'Voting', value: '⏸️ Paused while the team discusses this suggestion.', inline: false });
  if (['approved', 'denied', 'implemented'].includes(suggestion.status)) fields.push({ name: 'Team response', value: defaultTeamResponse(suggestion), inline: false });
  const components = [];
  if (suggestion.status === 'pending') components.push(row(
    button(`suggestions:manage:${suggestion.suggestionId}:discuss`, '💬 Start Discussion', ButtonStyle.Primary),
    button(`suggestions:manage:${suggestion.suggestionId}:approve`, '✅ Approve', ButtonStyle.Success),
    button(`suggestions:manage:${suggestion.suggestionId}:deny`, '❌ Decline', ButtonStyle.Danger),
  ));
  else if (suggestion.status === 'discussing') components.push(row(
    button(`suggestions:manage:${suggestion.suggestionId}:resume`, '▶️ Resume Voting', ButtonStyle.Secondary),
    button(`suggestions:manage:${suggestion.suggestionId}:approve`, '✅ Approve', ButtonStyle.Success),
    button(`suggestions:manage:${suggestion.suggestionId}:deny`, '❌ Decline', ButtonStyle.Danger),
  ));
  else if (suggestion.status === 'approved') components.push(row(button(`suggestions:manage:${suggestion.suggestionId}:implemented`, '🚀 Mark Implemented', ButtonStyle.Success)));
  return { embeds: [new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle(`💡 ${suggestion.reference} · ${suggestion.title}`).setDescription(suggestion.content || '_No suggestion details were provided._').addFields(fields).setFooter({ text: 'Management view · actions here are logged' }).setTimestamp(new Date(suggestion.updatedAt || suggestion.createdAt || Date.now()))], components };
}

function buildAuditLogEmbed(guild, suggestion, event = {}) {
  const from = event.fromStatus ? `${statusEmoji(event.fromStatus)} ${statusLabel(event.fromStatus)}` : '—';
  const to = event.toStatus ? `${statusEmoji(event.toStatus)} ${statusLabel(event.toStatus)}` : statusLabel(suggestion.status);
  const actionLabels = { submitted: 'Suggestion submitted', discussion_started: 'Team discussion started', voting_resumed: 'Voting resumed', approved: 'Suggestion approved', denied: 'Suggestion declined', implemented: 'Suggestion implemented' };
  const publicLink = messageLink(guild.id, suggestion.channelId, suggestion.messageId);
  const threadLink = suggestion.discussionThreadId ? `https://discord.com/channels/${guild.id}/${suggestion.discussionThreadId}` : null;
  const fields = [
    { name: 'Reference', value: `\`${suggestion.reference}\``, inline: true },
    { name: 'Action', value: actionLabels[event.type] || event.type || 'Updated', inline: true },
    { name: 'By', value: event.actorId ? `<@${event.actorId}>` : 'System', inline: true },
    { name: 'Suggestion', value: suggestion.title, inline: false },
    { name: 'Member', value: managementSuggestionAuthor(suggestion), inline: false },
  ];
  if (event.fromStatus || event.toStatus) fields.push({ name: 'Status change', value: `${from} → ${to}`, inline: false });
  if (event.note) fields.push({ name: 'Note / reason', value: event.note, inline: false });
  const links = [];
  if (publicLink) links.push(`[Public message](${publicLink})`);
  if (threadLink) links.push(`[Team discussion](${threadLink})`);
  if (links.length) fields.push({ name: 'Links', value: links.join(' · '), inline: false });
  return new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle(`💡 Suggestions Log · ${suggestion.reference}`).addFields(fields).setFooter({ text: 'Suggestions management audit log' }).setTimestamp(new Date(event.at || Date.now()));
}

function defaultSubmitPanelEmbed(section, enabled) {
  const privacyNote = section.anonymous === true ? '\n\n🔒 **Anonymous suggestions are on.** Your name is hidden from the public suggestion card. The management team can still identify submissions for moderation and follow-up.' : '';
  const description = enabled
    ? `Got an idea that could make the server better? Give it a short name, explain the idea, and share it with the community.\n\nYou can open **My Suggestions** at any time to follow its progress.${privacyNote}`
    : 'Suggestions are paused right now. You can still open **My Suggestions** to view ideas you have already shared.';
  return new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions').setDescription(description).setFooter({ text: enabled ? 'Every idea can be tracked from submission to final outcome.' : 'Please check back later.' }).setTimestamp();
}

function buildSubmitPanelPayload(guildOrId) {
  const guild = guildOrId && typeof guildOrId === 'object' ? guildOrId : null;
  const guildId = guild?.id || String(guildOrId || '');
  const section = suggestions.getSection(guildId);
  const enabled = isModuleEnabled(guildId, 'suggestions');
  const fallbackEmbed = defaultSubmitPanelEmbed(section, enabled);
  const rendered = renderSuggestionBinding(guild, 'suggestion_panel', templateVariables(guild, null, section));
  const submitButton = button('suggestions:submit', section.anonymous ? 'Share Anonymously' : 'Share a Suggestion').setDisabled(!enabled);
  return { content: rendered?.content || null, embeds: [applyTemplateEmbed(rendered, fallbackEmbed, Date.now())], components: [row(submitButton, button('suggestions:mine:page:0', 'My Suggestions', ButtonStyle.Secondary))] };
}

function memberSuggestions(guildId, userId) {
  return Object.values(suggestions.getSection(guildId).suggestions || {}).filter((item) => String(item.authorId || '') === String(userId || '')).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function buildMySuggestionsPayload(guildId, userId, page = 0) {
  const section = suggestions.getSection(guildId);
  const records = memberSuggestions(guildId, userId);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const pageRecords = records.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const counts = records.reduce((out, item) => { out[item.status] = Number(out[item.status] || 0) + 1; return out; }, { pending: 0, discussing: 0, approved: 0, implemented: 0, denied: 0 });
  const lines = pageRecords.length ? pageRecords.map((item) => {
    const privacy = item.anonymous === true ? ' · 🔒 Anonymous' : '';
    return `${statusEmoji(item.status)} **${item.title}** · ${statusLabel(item.status, section)} · ${shortDate(item.createdAt)}${privacy}`;
  }) : ['You have not shared any suggestions yet.'];
  const components = [];
  if (pageRecords.length) components.push(row(new StringSelectMenuBuilder().setCustomId('suggestions:mine:select').setPlaceholder('Open one of your suggestions').setMinValues(1).setMaxValues(1).addOptions(pageRecords.map((item) => ({
    label: `${statusEmoji(item.status)} ${compactPreview(item.title, 80) || 'Suggestion'}`.slice(0, 100),
    description: `${statusLabel(item.status, section)} · ${item.anonymous === true ? 'Anonymous · ' : ''}${shortDate(item.createdAt)}`.slice(0, 100),
    value: `${item.suggestionId}|${safePage}`,
  })))));
  components.push(row(
    button(`suggestions:mine:page:${Math.max(0, safePage - 1)}`, '⬅️ Previous', ButtonStyle.Secondary).setDisabled(safePage === 0),
    button(`suggestions:mine:page:${Math.min(totalPages - 1, safePage + 1)}`, 'Next ➡️', ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    button('suggestions:mine:close', 'Close', ButtonStyle.Secondary),
  ));
  return {
    embeds: [new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 My Suggestions').setDescription([
      'Follow the progress of ideas you have shared.', '',
      `💡 Open: **${counts.pending}** · 💬 Discussing: **${counts.discussing}** · ✅ Approved: **${counts.approved}**`,
      `🚀 Implemented: **${counts.implemented}** · ❌ Declined: **${counts.denied}**`, '', ...lines, '',
      `Page **${safePage + 1} of ${totalPages}** · **${records.length}** total`,
    ].join('\n')).setFooter({ text: 'Only you can see this.' }).setTimestamp()],
    components, flags: MessageFlags.Ephemeral,
  };
}

function buildMySuggestionDetail(guildId, userId, suggestionId, page = 0) {
  const section = suggestions.getSection(guildId);
  const item = suggestions.getSuggestion(guildId, suggestionId);
  if (!item || String(item.authorId || '') !== String(userId || '')) throw new Error('That suggestion could not be found in your history.');
  const fields = [
    { name: 'Status', value: `${statusEmoji(item.status)} ${statusLabel(item.status, section)}`, inline: true },
    { name: 'Shared', value: item.anonymous === true ? '🔒 Anonymously' : 'With your name', inline: true },
    { name: 'Submitted', value: discordTimestamp(item.createdAt, 'F'), inline: false },
  ];
  if (section.voting !== false || item.upVotes.length || item.downVotes.length) fields.push({ name: 'Community feedback', value: voteSummary(item), inline: false });
  if (item.status === 'pending') fields.push({ name: 'What happens next?', value: 'Your suggestion is open for community feedback and management review.', inline: false });
  else if (item.status === 'discussing') fields.push({ name: 'What happens next?', value: 'The management team is discussing your suggestion. Community voting is paused while they do this.', inline: false });
  else {
    fields.push({ name: item.status === 'implemented' ? 'Completed' : 'Decision made', value: discordTimestamp(item.implementedAt || item.reviewedAt || item.updatedAt, 'F'), inline: false });
    fields.push({ name: 'Team response', value: defaultTeamResponse(item), inline: false });
  }
  return { embeds: [new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle(`${statusEmoji(item.status)} ${item.title}`).setDescription(item.content || '_No suggestion details were provided._').addFields(fields).setFooter({ text: 'Only you can see this.' }).setTimestamp(new Date(item.updatedAt || item.createdAt || Date.now()))], components: [row(button(`suggestions:mine:page:${Math.max(0, Number(page) || 0)}`, '⬅️ My Suggestions', ButtonStyle.Secondary), button('suggestions:mine:close', 'Close', ButtonStyle.Secondary))], flags: MessageFlags.Ephemeral };
}

function buildReviewerDecisionPayload(guild, suggestionId) {
  const section = suggestions.getSection(guild.id);
  const item = suggestions.getSuggestion(guild.id, suggestionId);
  if (!item) throw new Error('That suggestion could not be found.');
  return { ...buildManagementPayload(guild, item, section), flags: MessageFlags.Ephemeral };
}

function buildSubmitModal() {
  return new ModalBuilder().setCustomId('suggestions:modal:submit').setTitle('Share a Suggestion').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Give your suggestion a short name').setPlaceholder('Example: Add a weekly community game night').setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(100).setRequired(true)),
    row(new TextInputBuilder().setCustomId('content').setLabel('Tell us more about your idea').setPlaceholder('Explain the idea and how it could help the community.').setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(1800).setRequired(true)),
  );
}

function buildReviewModal(suggestionId, action) {
  const labels = {
    approve: { title: 'Approve Suggestion', label: 'Team response (optional)', placeholder: 'Explain why the team is approving this suggestion.', required: false },
    deny: { title: 'Decline Suggestion', label: 'Reason for declining', placeholder: 'Explain clearly why the team is not moving forward with this suggestion.', required: true },
    implemented: { title: 'Mark as Implemented', label: 'What was implemented?', placeholder: 'Tell the member what was changed or completed.', required: true },
  };
  const config = labels[action] || labels.approve;
  return new ModalBuilder().setCustomId(`suggestions:reviewModal:${suggestionId}:${action}`).setTitle(config.title).addComponents(row(
    new TextInputBuilder().setCustomId('reason').setLabel(config.label).setPlaceholder(config.placeholder).setStyle(TextInputStyle.Paragraph).setMinLength(config.required ? 3 : 0).setMaxLength(500).setRequired(config.required),
  ));
}

function overviewDescription(section, enabled) {
  return [
    'Manage how ideas are submitted, discussed, decided and logged.', '',
    `**Suggestions:** ${enabled ? 'On ✅' : 'Off ❌'}`, '',
    '**Channels**', `• Public suggestions: ${formatChannel(section.submitChannelId)}`, `• Team discussion: ${formatChannel(section.reviewChannelId)}`, `• Audit log: ${formatChannel(section.logChannelId)}`, '',
    '**Management team**', `• ${formatRoles(section.reviewerRoleIds)}`, '',
    '**Member options**', `• Community voting: ${section.voting !== false ? 'On ✅' : 'Off ❌'}`, `• Management review: ${section.requireReview !== false ? 'On ✅' : 'Off ❌'}`, `• Hide member names publicly: ${section.anonymous === true ? 'On ✅' : 'Off ❌'}`, '',
    '**Activity**', `• ${section.analytics.submitted} submitted · ${section.analytics.discussing} discussing · ${section.analytics.approved} approved`, `• ${section.analytics.implemented} implemented · ${section.analytics.denied} declined`,
  ].join('\n');
}

function buildReviewerRolesPanel(guild, memberDisplayName = 'Unknown User', page = 0) {
  const section = suggestions.getSection(guild.id);
  const picker = panelNavigation.buildRolePicker(guild, { customId: 'admin:suggestions:reviewerRoles', placeholder: 'Choose management roles', selectedIds: section.reviewerRoleIds, minValues: 0, maxValues: 25, page, pagination: true, showManaged: true });
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions · Management Team').setDescription([
    'Choose which roles can discuss, approve, decline and mark suggestions as implemented.', '',
    'Roles are shown from **highest to lowest** in the server hierarchy. You can select roles across multiple pages.', '',
    `**Selected roles:** ${formatRoles(section.reviewerRoleIds)}`, '',
    'Members with **Manage Server** or **Administrator** can always manage suggestions.',
  ].join('\n')).setFooter({ text: `Opened by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [...picker.rows, row(button('admin:suggestions:overview', '⬅️ Back to Suggestions', ButtonStyle.Secondary))] };
}

function buildSuggestionsAdminPanel(guild, memberDisplayName = 'Unknown User', page = 'overview') {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  if (page === 'reviewers') return buildReviewerRolesPanel(guild, memberDisplayName, 0);
  if (page === 'destinations') {
    const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions · Outcome & Log Channels').setDescription([
      'Choose where final outcomes and management audit logs are posted.', '',
      `**Approved suggestions:** ${formatChannel(section.approvedChannelId)}`,
      `**Declined suggestions:** ${formatChannel(section.deniedChannelId)}`,
      `**Audit log:** ${formatChannel(section.logChannelId)}`, '',
      'The original public suggestion is always updated with its latest status and team response.',
    ].join('\n')).setFooter({ text: `Opened by ${memberDisplayName}` }).setTimestamp();
    return { embeds: [embed], components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:approvedChannel').setPlaceholder('Approved suggestions channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:deniedChannel').setPlaceholder('Declined suggestions channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:logChannel').setPlaceholder('Suggestions audit log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(button('admin:suggestions:overview', '⬅️ Back to Suggestions', ButtonStyle.Secondary)),
    ] };
  }
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions').setDescription(overviewDescription(section, enabled)).setFooter({ text: `Opened by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:submitChannel').setPlaceholder('Public suggestions channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:reviewChannel').setPlaceholder('Private team discussion channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(button('admin:suggestions:reviewers', '👥 Management Team', ButtonStyle.Primary), button('admin:suggestions:destinations', '📬 Outcomes & Logs', ButtonStyle.Primary)),
    row(
      button('admin:suggestions:deploy', '🚀 Publish Panel', ButtonStyle.Success),
      button(enabled ? 'admin:suggestions:disable' : 'admin:suggestions:enable', enabled ? '⏸️ Turn Off' : '▶️ Turn On', ButtonStyle.Secondary),
      button('admin:suggestions:toggleVoting', section.voting !== false ? '🗳️ Voting On' : '🗳️ Voting Off', ButtonStyle.Secondary),
      button('admin:suggestions:toggleReview', section.requireReview !== false ? '🔎 Review On' : '🔎 Review Off', ButtonStyle.Secondary),
      button('admin:suggestions:toggleAnonymous', section.anonymous === true ? '👤 Public Anonymous' : '👤 Public Named', ButtonStyle.Secondary),
    ),
    row(button('admin:modules', '⬅️ Back to Modules', ButtonStyle.Secondary)),
  ] };
}

async function fetchDeploymentMessage(guild, deployment) {
  if (!deployment?.channelId || !deployment?.messageId) return null;
  const channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(deployment.messageId).catch(() => null);
}

async function refreshDeployedPanel(guild) {
  if (!guild?.id) return null;
  const section = suggestions.getSection(guild.id);
  const existing = await fetchDeploymentMessage(guild, section.deployment);
  if (!existing?.editable) return null;
  await existing.edit(buildSubmitPanelPayload(guild));
  return existing;
}

async function deploySubmitPanel(guild) {
  const section = tracking.assertEnabled(guild?.id);
  if (!section.submitChannelId) throw new Error('Choose the public suggestions channel first.');
  if (section.requireReview !== false && !section.reviewChannelId) throw new Error('Choose a private team discussion channel before publishing the panel.');
  if (section.requireReview !== false && section.reviewChannelId === section.submitChannelId) throw new Error('The team discussion channel must be different from the public suggestions channel.');
  const channel = await tracking.resolveSendableChannel(guild, section.submitChannelId, 'public suggestions channel', { requireHistory: true });
  const payload = buildSubmitPanelPayload(guild);
  const existing = await fetchDeploymentMessage(guild, section.deployment);
  if (existing?.editable && existing.channelId === channel.id) {
    await existing.edit(payload);
    suggestions.saveDeployment(guild.id, { channelId: existing.channelId, messageId: existing.id, deployedAt: section.deployment.deployedAt || suggestions.now() }, guild);
    return existing;
  }
  const message = await channel.send(payload);
  try { suggestions.saveDeployment(guild.id, { channelId: message.channelId, messageId: message.id, deployedAt: suggestions.now() }, guild); }
  catch (error) { await message.delete().catch(() => null); throw error; }
  if (existing?.deletable && existing.id !== message.id) await existing.delete().catch(() => null);
  return message;
}

module.exports = {
  SUGGESTIONS_COLOR, statusEmoji, statusLabel, templateVariables,
  buildSuggestionEmbed, buildSuggestionRows, buildSuggestionMessagePayload,
  buildManagementPayload, buildAuditLogEmbed, buildSubmitPanelPayload,
  buildMySuggestionsPayload, buildMySuggestionDetail, buildReviewerDecisionPayload,
  buildSubmitModal, buildReviewModal, buildReviewerRolesPanel, buildSuggestionsAdminPanel,
  refreshDeployedPanel, deploySubmitPanel,
};
