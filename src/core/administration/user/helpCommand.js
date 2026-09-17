'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const { showHelp } = require('./utilities');

const FAQ = Object.freeze([
  { keys: ['help', 'commands', 'features'], q: 'How do I find Goliath commands and features?', a: 'Run `/help` without a question to see the commands and features available to you. The list respects your current permissions.' },
  { keys: ['admin', 'setup', 'configure', 'configuration'], q: 'Where do administrators configure Goliath?', a: 'Use `/admin` to open the server administration panel. Only controls you are authorised to use are available.' },
  { keys: ['mod', 'moderation', 'case', 'cases'], q: 'Where are moderation tools?', a: 'Use `/mod` for moderation workflows, member actions and investigation tools available to your staff role.' },
  { keys: ['quarantine', 'investigation', 'isolation'], q: 'How does member quarantine work?', a: 'Investigation Isolation is available through the moderation workflow for a selected member. Full Security Isolation is restricted to the server owner through `/admin`. Goliath records isolation and restoration activity.' },
  { keys: ['security', 'lockdown', 'automod'], q: 'Where are security controls?', a: 'Security and AutoMod controls are managed from `/admin`. Emergency or destructive controls remain permission-gated.' },
  { keys: ['ticket', 'tickets', 'support'], q: 'How do I use tickets?', a: 'Open the ticket feature exposed by your server. Ticket availability and routing depend on how administrators configured the Tickets module.' },
  { keys: ['role', 'roles', 'autorole', 'reaction role', 'timed role'], q: 'How are roles managed?', a: 'Goliath supports server role tools including Auto Roles, Timed Roles, Reaction Roles and Role Studio when those modules are enabled by the server.' },
  { keys: ['social', 'twitch', 'youtube', 'kick', 'alerts'], q: 'Where are social and stream alerts configured?', a: 'Administrators configure supported social feeds and live alerts through Social Studio in `/admin`.' },
  { keys: ['translation', 'translate', 'language'], q: 'How do I translate text?', a: 'Use the Translation feature when it is enabled for the server. The user panel can open the manual translator and administrators control provider/settings availability.' },
  { keys: ['ping', 'status', 'online', 'latency'], q: 'How do I check whether Goliath is healthy?', a: 'Use the Ping/Status utility in the user panel to see bot latency, Discord API latency and process uptime.' },
  { keys: ['maintenance', 'restart', 'offline'], q: 'What does a Goliath maintenance notice mean?', a: 'A maintenance notice means Goliath may temporarily stop responding while the service is restarted or maintained. The status notice is updated when service is restored.' },
  { keys: ['privacy', 'audit', 'logging', 'logs', 'sentinel'], q: 'Does Goliath record actions?', a: 'Goliath uses its audit and security systems to record supported interactions, moderation/security activity and Discord-side changes for accountability and diagnostics.' },
]);

function faqMatches(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const words = needle.split(/\s+/).filter(Boolean);
  return FAQ.map((item) => {
    const haystack = `${item.q} ${item.a} ${item.keys.join(' ')}`.toLowerCase();
    const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
    return { item, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map((entry) => entry.item);
}

async function showFaq(interaction, query) {
  const matches = faqMatches(query);
  const embed = new EmbedBuilder()
    .setColor(matches.length ? 0x5865F2 : 0xFEE75C)
    .setTitle(matches.length ? '❓ Goliath Help • FAQ' : '🔎 Goliath Help • No Match')
    .setDescription(matches.length
      ? matches.map((item) => `**${item.q}**\n${item.a}`).join('\n\n').slice(0, 4096)
      : `I couldn't find a FAQ entry for **${String(query).slice(0, 200)}**.\n\nRun \`/help\` without a question to browse the features and commands available to you.`)
    .setFooter({ text: `FAQ search • ${matches.length} result${matches.length === 1 ? '' : 's'}` })
    .setTimestamp();
  return interaction.reply({ embeds: [embed], flags: 64 });
}

module.exports = {
  category: 'Utility',
  help: {
    name: 'help',
    description: 'Find Goliath features, commands and answers.',
    usage: '/help [question]',
  },
  access: { ownerOnly: false },
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Find Goliath features, commands and answers')
    .addStringOption((option) => option
      .setName('question')
      .setDescription('Search Goliath help and frequently asked questions')
      .setRequired(false)
      .setMaxLength(200))
    .setDMPermission(false),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;
    const question = interaction.options?.getString?.('question')?.trim();
    if (question) return showFaq(interaction, question);
    return showHelp(interaction, { standalone: true });
  },
};
