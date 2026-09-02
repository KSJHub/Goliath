'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const emojis = require('./emojis');
const emojiStore = require('./emojisStore');

const PANEL_COLOR = 0x5865F2;
const CATEGORY_ORDER = ['Gaming', 'Social', 'Reaction', 'Events', 'Seasonal', 'Moderation', 'General'];
const CORE_SEARCH_TERMS = Object.freeze({
  activision: ['activision', 'cod', 'callofduty', 'call of duty'],
  blizzard: ['blizzard', 'battle.net', 'battlenet'],
  discord: ['discord', 'chat', 'community', 'server'],
  epic: ['epic', 'epicgames', 'fortnite'],
  facebook: ['facebook', 'fb', 'meta'],
  instagram: ['instagram', 'insta', 'ig'],
  kick: ['kick', 'kickstreaming', 'stream'],
  nintendo: ['nintendo', 'switch'],
  pc: ['pc', 'computer', 'desktop'],
  playstation: ['playstation', 'ps', 'ps4', 'ps5'],
  snapchat: ['snapchat', 'snap'],
  steam: ['steam', 'valve'],
  tiktok: ['tiktok', 'tik tok', 'tt'],
  twitch: ['twitch', 'stream', 'streaming'],
  whatsapp: ['whatsapp', 'whats app', 'wa'],
  x: ['x', 'twitter', 'tweet'],
  xbox: ['xbox', 'xboxone', 'seriesx', 'seriess'],
  youtube: ['youtube', 'yt', 'video', 'videos', 'stream'],
});

const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, label, style = ButtonStyle.Secondary, emoji = null) => {
  const item = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) item.setEmoji(emoji);
  return item;
};

function userId(interaction) { return String(interaction?.user?.id || '').trim(); }
function guildId(interaction) { return String(interaction?.guildId || interaction?.guild?.id || '').trim(); }
function displayName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }

async function availableCatalog(interaction) {
  const overview = await emojis.overview(interaction.client, guildId(interaction));
  return (overview.catalog || []).filter((emoji) => emoji.core || (overview.enabled && emoji.selected));
}

function emojiShortcode(emoji) {
  return emoji.core ? emoji.alias : (emoji.aliases?.[0] || emoji.name);
}

function searchTerms(emoji) {
  const shortcode = emojiShortcode(emoji);
  return [emoji.name, emoji.alias, emoji.category, shortcode, ...(emoji.aliases || []), ...(emoji.tags || []), ...(emoji.core ? (CORE_SEARCH_TERMS[shortcode] || []) : [])]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function searchEmoji(catalog, query = '') {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return catalog;
  return catalog.filter((emoji) => searchTerms(emoji).some((value) => value.includes(clean)));
}

function matchScore(emoji, query) {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return 0;
  const shortcode = String(emojiShortcode(emoji) || '').toLowerCase();
  const terms = searchTerms(emoji);
  if (shortcode === clean) return 100;
  if (terms.some((term) => term === clean)) return 80;
  if (shortcode.startsWith(clean)) return 60;
  if (terms.some((term) => term.startsWith(clean))) return 40;
  return 10;
}

function sortAlphabetically(items) {
  return [...items].sort((a, b) => String(emojiShortcode(a) || '').localeCompare(String(emojiShortcode(b) || ''), undefined, { sensitivity: 'base' }));
}

function categoryName(emoji) {
  const name = String(emoji?.category || 'General').trim();
  return name || 'General';
}

function orderedCategories(catalog) {
  const names = [...new Set(catalog.map(categoryName))];
  return names.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function chunk(items, size = 25) {
  const pages = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}

function browserPages(catalog) {
  const pages = [];
  const all = sortAlphabetically(catalog);
  for (const [index, items] of chunk(all).entries()) {
    pages.push({ key: `all:${index}`, label: `All Emojis${all.length > 25 ? ` • ${index + 1}/${Math.ceil(all.length / 25)}` : ''}`, items });
  }
  for (const category of orderedCategories(catalog)) {
    const categoryItems = sortAlphabetically(catalog.filter((emoji) => categoryName(emoji) === category));
    const categoryPages = chunk(categoryItems);
    for (const [index, items] of categoryPages.entries()) {
      pages.push({
        key: `cat:${encodeURIComponent(category)}:${index}`,
        label: `${category}${categoryPages.length > 1 ? ` • ${index + 1}/${categoryPages.length}` : ''}`,
        items,
      });
    }
  }
  return pages.slice(0, 25);
}

function emojiOption(emoji) {
  const shortcode = emojiShortcode(emoji);
  return {
    label: `:${shortcode}:`.slice(0, 100),
    value: String(emoji.id),
    description: categoryName(emoji).slice(0, 100),
    emoji: emoji.component || undefined,
  };
}

function recordMemberUse(interaction, emoji, context) {
  emojiStore.recordUsage(guildId(interaction), emoji.id, context);
}

function buildLauncher() {
  return {
    content: 'Looking for an emoji? Search with `/e find`, or open the full emoji list below.',
    components: [row(button('user:emojis:browse', 'Browse Emojis', ButtonStyle.Primary, '😀'))],
  };
}

async function buildPanel(interaction, selectedPage = 'all:0') {
  const catalog = sortAlphabetically(await availableCatalog(interaction));
  const pages = browserPages(catalog);
  const active = pages.find((page) => page.key === selectedPage) || pages[0] || { key: 'all:0', label: 'All Emojis', items: [] };

  const sections = orderedCategories(catalog).map((category) => {
    const items = sortAlphabetically(catalog.filter((emoji) => categoryName(emoji) === category));
    const names = items.map((emoji) => `${emoji.mention} \`:${emojiShortcode(emoji)}:\``).join('  ');
    return `**${category}** (${items.length})\n${names || 'None'}`;
  });

  const description = [
    `**${catalog.length} emojis ready to use.**`,
    'Choose a category below, then pick the emoji you want to post.',
    '',
    ...sections,
  ].join('\n\n').slice(0, 4096);

  const components = [];
  if (pages.length) {
    components.push(row(new StringSelectMenuBuilder()
      .setCustomId('user:emojis:browse-category')
      .setPlaceholder(active.label.slice(0, 150))
      .addOptions(pages.map((page) => ({
        label: page.label.slice(0, 100),
        value: page.key,
        description: `${page.items.length} emoji${page.items.length === 1 ? '' : 's'}`,
        default: page.key === active.key,
      })))));
  }
  if (active.items.length) {
    components.push(row(new StringSelectMenuBuilder()
      .setCustomId('user:emojis:browse-pick')
      .setPlaceholder('Pick an emoji')
      .addOptions(active.items.map(emojiOption))));
  }

  return {
    content: null,
    embeds: [new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle('😀 Emoji Browser')
      .setDescription(description)
      .setFooter({ text: `Requested by ${displayName(interaction)}` })
      .setTimestamp()],
    components,
  };
}

async function autocomplete(interaction) {
  if (!interaction?.guildId || !interaction?.client) return interaction.respond([]).catch(() => null);
  const focused = String(interaction.options.getFocused?.() || '').trim();
  const catalog = await availableCatalog(interaction);
  const matches = searchEmoji(catalog, focused)
    .sort((a, b) => matchScore(b, focused) - matchScore(a, focused)
      || Number(b.usage?.count || 0) - Number(a.usage?.count || 0)
      || String(emojiShortcode(a)).localeCompare(String(emojiShortcode(b))))
    .slice(0, 25);
  return interaction.respond(matches.map((emoji) => {
    const shortcode = emojiShortcode(emoji);
    return { name: `:${shortcode}: · ${categoryName(emoji)}`.slice(0, 100), value: String(emoji.id) };
  })).catch(() => null);
}

async function commandSelection(interaction, reference) {
  const raw = String(reference || '').trim();
  if (!raw) return null;

  const catalog = await availableCatalog(interaction);
  let emoji = null;

  if (raw.toLowerCase().startsWith('core:')) {
    const alias = raw.slice(5).trim().toLowerCase();
    if (!emojis.isApprovedCoreAlias(alias)) return null;
    emoji = catalog.find((entry) => (
      entry.core
      && String(entry.alias || '').toLowerCase() === alias
      && String(entry.name || '').toLowerCase() === `${emojis.CORE_EMOJI_PREFIX}${alias}`
    )) || null;
  } else if (/^\d{16,20}$/.test(raw)) {
    emoji = catalog.find((entry) => String(entry.id) === raw) || null;
  } else {
    const clean = raw.replace(/^:+|:+$/g, '').toLowerCase();
    const exact = catalog.find((entry) => String(emojiShortcode(entry) || '').toLowerCase() === clean)
      || catalog.find((entry) => searchTerms(entry).some((term) => term === clean));
    emoji = exact || searchEmoji(catalog, clean)
      .sort((a, b) => matchScore(b, clean) - matchScore(a, clean))[0] || null;
  }

  if (!emoji) return null;
  recordMemberUse(interaction, emoji, 'member_command');
  return { content: emoji.mention, allowedMentions: { parse: [] } };
}

async function resolveMessageText(interaction, content) {
  const source = String(content || '');
  if (!source.trim()) return { source, resolved: source, changed: false };
  const resolved = await emojis.resolveText(interaction.client, guildId(interaction), source, 'member_message_convert');
  return { source, resolved, changed: resolved !== source };
}

async function buildMessageConversionPreview(interaction, message) {
  if (!message?.id || !message?.channelId) throw new Error('That message could not be read.');
  if (String(message.author?.id || '') !== userId(interaction)) {
    return { content: 'You can only convert emoji shortcodes in your own messages.', components: [] };
  }
  const result = await resolveMessageText(interaction, message.content);
  if (!result.changed) {
    return { content: 'No available Emoji Studio shortcodes were found in that message. Try something like `:youtube:` or `:twitch:`.', components: [] };
  }
  return {
    embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('😀 Convert Emoji Shortcodes').setDescription([
      '**Preview**',
      result.resolved.slice(0, 3500),
      '',
      'Your original message will stay in place. Press **Post Converted** and Goliath will reply to it with the converted version.',
    ].join('\n'))],
    components: [row(button(`user:emojis:convert-post:${message.channelId}:${message.id}`, 'Post Converted', ButtonStyle.Primary, '😀'))],
  };
}

async function postSelectedEmoji(interaction, emojiId) {
  const catalog = await availableCatalog(interaction);
  const emoji = catalog.find((entry) => String(entry.id) === String(emojiId));
  if (!emoji) throw new Error('That emoji is no longer available here.');
  recordMemberUse(interaction, emoji, 'member_browser');
  const payload = { content: emoji.mention, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleInteraction(interaction, updatePanel) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('user:emojis:')) return false;

  if (id === 'user:emojis:browse' && interaction.isButton?.()) {
    await updatePanel(interaction, await buildPanel(interaction));
    return true;
  }

  if (id === 'user:emojis:browse-category' && interaction.isStringSelectMenu?.()) {
    await updatePanel(interaction, await buildPanel(interaction, interaction.values?.[0] || 'all:0'));
    return true;
  }

  if (id === 'user:emojis:browse-pick' && interaction.isStringSelectMenu?.()) {
    await postSelectedEmoji(interaction, interaction.values?.[0]);
    return true;
  }

  if (id.startsWith('user:emojis:convert-post:') && interaction.isButton?.()) {
    const [, , , channelId, messageId] = id.split(':');
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (!message) throw new Error('That message is no longer available.');
    if (String(message.author?.id || '') !== userId(interaction)) throw new Error('You can only convert your own messages.');
    const result = await resolveMessageText(interaction, message.content);
    if (!result.changed) throw new Error('That message no longer contains available Emoji Studio shortcodes.');
    await message.reply({ content: result.resolved, allowedMentions: { parse: [] } });
    await interaction.update({ content: 'Posted the converted version as a reply to your message.', embeds: [], components: [] });
    return true;
  }

  return false;
}

module.exports = {
  autocomplete,
  buildLauncher,
  buildMessageConversionPreview,
  buildPanel,
  commandSelection,
  handleInteraction,
  resolveMessageText,
};
