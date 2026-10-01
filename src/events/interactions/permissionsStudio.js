'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events } = require('discord.js');
const security = require('../../core/security/protection/core');
const studio = require('../../owner/dev/permissionsStudio');
const editor = require('../../owner/dev/permissionsStudio/editor');

const OWNER_SERVER_TOOLS = 'ownerpanel:server-tools';
const OWNER_PREFIX = 'ownerpanel:';
const GUILD_MARKER = ':guild:';

function guildIdFrom(customId, interaction) { return String(customId || '').match(/:guild:(\d{16,25})$/)?.[1] || interaction.guildId || null; }
function base(customId) { const id=String(customId||''); const i=id.lastIndexOf(GUILD_MARKER); return i<0?id:id.slice(0,i); }
function ownerAllowed(interaction) { return Boolean(interaction?.user?.id && security.isBotOwner(interaction.user.id)); }
function ownerId(action,guildId) { return guildId ? `${OWNER_PREFIX}${action}${GUILD_MARKER}${guildId}` : `${OWNER_PREFIX}${action}`; }

function serverToolsPayload(guildId) {
  const available=Boolean(guildId);
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🧰 Owner Server Tools').setDescription([
    'Developer-only server tools. Access is restricted to configured Goliath owner IDs.','',
    '**Server Duplicator**','📋 **Copy Structure** — selectively copy server structure, roles and permissions.','🔎 **Analyse Servers** — compare a source and destination before copying.','',
    '**Templates**','📤 **Export Template** — save a server as a reusable Duplicator template.','🏗️ **Build Template** — build from a saved/default template.','',
    '**Permissions Studio**','🛡️ **Permissions Studio** — audit, copy/paste, compare and undo.','🎚️ **Permission Editor** — Discord-style Allow / Inherit / Deny editing for role overrides.','',
    available?null:'⚠️ **Server context required.** Open `/owner` from a server channel to use these tools.',
  ].filter(Boolean).join('\n')).setFooter({text:'Owner only • Server tooling retains owner and safety checks'});
  const row1=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ownerId('server-copy',guildId)).setLabel('Copy Structure').setEmoji('📋').setStyle(ButtonStyle.Primary).setDisabled(!available),
    new ButtonBuilder().setCustomId(ownerId('server-analyse',guildId)).setLabel('Analyse Servers').setEmoji('🔎').setStyle(ButtonStyle.Secondary).setDisabled(!available),
    new ButtonBuilder().setCustomId(ownerId('server-export',guildId)).setLabel('Export Template').setEmoji('📤').setStyle(ButtonStyle.Secondary).setDisabled(!available));
  const row2=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ownerId('server-build',guildId)).setLabel('Build Template').setEmoji('🏗️').setStyle(ButtonStyle.Secondary).setDisabled(!available),
    new ButtonBuilder().setCustomId(`permstudio:home:guild:${guildId}`).setLabel('Permissions Studio').setEmoji('🛡️').setStyle(ButtonStyle.Primary).setDisabled(!available),
    new ButtonBuilder().setCustomId(`permedit:home:guild:${guildId}`).setLabel('Permission Editor').setEmoji('🎚️').setStyle(ButtonStyle.Primary).setDisabled(!available));
  const row3=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ownerId('home',guildId)).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
  return {embeds:[embed],components:[row1,row2,row3]};
}

module.exports={
  name:Events.InteractionCreate, once:false,
  async execute(interaction){
    const raw=String(interaction?.customId||''); if(!raw||!ownerAllowed(interaction))return;
    if(base(raw)===OWNER_SERVER_TOOLS){const gid=guildIdFrom(raw,interaction);setTimeout(()=>{if(interaction?.message?.edit)interaction.message.edit(serverToolsPayload(gid)).catch(()=>null);else if(interaction?.editReply)interaction.editReply(serverToolsPayload(gid)).catch(()=>null);},150);return;}
    if(raw.startsWith('permedit:')){await editor.handle(interaction);return;}
    if(!raw.startsWith('permstudio:'))return;
    const gid=guildIdFrom(raw,interaction);
    if(base(raw)==='permstudio:back-server-tools'){if(interaction.isMessageComponent?.())await interaction.update(serverToolsPayload(gid));return;}
    await studio.handle(interaction);
  },
};
